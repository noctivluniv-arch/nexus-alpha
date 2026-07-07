/**
 * retrain-with-breadth.ts
 *
 * Tambah fitur MARKET BREADTH: persentase pair LAIN (bukan pair itu sendiri,
 * supaya tidak leak & tetap valid untuk leave-one-pair-out) yang trend1d-nya
 * BEARISH / BULLISH pada hari yang sama. Ini sinyal kondisi pasar-wide,
 * berbeda dari trend1d per-pair yang sudah ada.
 *
 * Motivasi: fold 8 (BUY gagal) terbukti karena downtrend SERENTAK di semua
 * 6 pair (lihat investigate-fold8), bukan noise 1 pair. Model belum punya
 * cara "melihat" kondisi market-wide ini secara eksplisit.
 *
 * Digabung dengan rolling_vol_pct (sudah terbukti membantu sebelumnya) jadi
 * total 40 fitur (37 asli + rolling_vol_pct + breadth_bearish_pct + breadth_bullish_pct).
 *
 * Jalankan:
 *   tsx scripts/src/retrain-with-breadth.ts
 */

import * as fs from "fs";

const IN_PATH = "scripts/output/ml-dataset.csv";
const ROLLING_WINDOW = 90;
const N_FOLDS = 8;
const EPOCHS = 3000;
const LR = 0.1;
const L2_LAMBDA = 0.01;

interface Row {
  pair: string; dateMs: number; features: Record<string, number>;
  label_buy: number; pnl_buy: number; label_sell: number; pnl_sell: number;
}

function loadCsv(path: string): { rows: Row[]; featureNames: string[] } {
  const text = fs.readFileSync(path, "utf-8").trim();
  const lines = text.split("\n");
  const header = lines[0].split(",");
  const featureNames = header.slice(2, header.length - 4);
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    const features: Record<string, number> = {};
    featureNames.forEach((fn, idx) => { features[fn] = parseFloat(parts[2 + idx]); });
    rows.push({
      pair: parts[0], dateMs: parseInt(parts[1], 10), features,
      label_buy: parseInt(parts[2 + featureNames.length], 10),
      pnl_buy: parseFloat(parts[3 + featureNames.length]),
      label_sell: parseInt(parts[4 + featureNames.length], 10),
      pnl_sell: parseFloat(parts[5 + featureNames.length]),
    });
  }
  return { rows, featureNames };
}

function rollingPercentile(values: number[], window: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window);
    const windowVals = values.slice(start, i);
    if (windowVals.length < 10) { result.push(0.5); continue; }
    const sorted = [...windowVals].sort((a, b) => a - b);
    let count = 0;
    for (const v of sorted) if (v <= values[i]) count++;
    result.push(count / sorted.length);
  }
  return result;
}

function enrichWithVolatility(rows: Row[]): Row[] {
  const pairs = [...new Set(rows.map(r => r.pair))];
  const enriched: Row[] = [];
  for (const pair of pairs) {
    const pairRows = rows.filter(r => r.pair === pair).sort((a, b) => a.dateMs - b.dateMs);
    const bbVals = pairRows.map(r => r.features.bb_bandwidth);
    const rollingPct = rollingPercentile(bbVals, ROLLING_WINDOW);
    pairRows.forEach((r, idx) => enriched.push({ ...r, features: { ...r.features, rolling_vol_pct: rollingPct[idx] } }));
  }
  return enriched;
}

function enrichWithBreadth(rows: Row[]): Row[] {
  // Group by dateMs -> map pair -> trend1d_bull
  const byDate: Record<number, Record<string, number>> = {};
  for (const r of rows) {
    if (!byDate[r.dateMs]) byDate[r.dateMs] = {};
    byDate[r.dateMs][r.pair] = r.features.trend1d_bull;
  }
  return rows.map(r => {
    const dayData = byDate[r.dateMs];
    const otherPairs = Object.keys(dayData).filter(p => p !== r.pair);
    if (otherPairs.length === 0) {
      return { ...r, features: { ...r.features, breadth_bearish_pct: 0.5, breadth_bullish_pct: 0.5 } };
    }
    const bearishCount = otherPairs.filter(p => dayData[p] === -1).length;
    const bullishCount = otherPairs.filter(p => dayData[p] === 1).length;
    return {
      ...r,
      features: {
        ...r.features,
        breadth_bearish_pct: bearishCount / otherPairs.length,
        breadth_bullish_pct: bullishCount / otherPairs.length,
      },
    };
  });
}

function standardize(train: number[][], test: number[][]) {
  const nFeat = train[0].length;
  const mean = new Array(nFeat).fill(0), std = new Array(nFeat).fill(1);
  for (let j = 0; j < nFeat; j++) { let s = 0; for (const row of train) s += row[j]; mean[j] = s / train.length; }
  for (let j = 0; j < nFeat; j++) { let s = 0; for (const row of train) s += (row[j] - mean[j]) ** 2; std[j] = Math.sqrt(s / train.length) || 1; }
  const apply = (data: number[][]) => data.map(row => row.map((v, j) => (v - mean[j]) / std[j]));
  return { trainS: apply(train), testS: apply(test) };
}

function sigmoid(z: number): number { if (z > 30) return 1; if (z < -30) return 0; return 1 / (1 + Math.exp(-z)); }

function trainLogReg(X: number[][], y: number[], epochs: number, lr: number, lambda: number) {
  const n = X.length, nFeat = X[0].length;
  let weights = new Array(nFeat).fill(0), bias = 0;
  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW = new Array(nFeat).fill(0); let gradB = 0;
    for (let i = 0; i < n; i++) {
      let z = bias;
      for (let j = 0; j < nFeat; j++) z += weights[j] * X[i][j];
      const err = sigmoid(z) - y[i];
      for (let j = 0; j < nFeat; j++) gradW[j] += err * X[i][j];
      gradB += err;
    }
    for (let j = 0; j < nFeat; j++) weights[j] -= lr * (gradW[j] / n + lambda * weights[j]);
    bias -= lr * (gradB / n);
  }
  return { weights, bias };
}

function predict(X: number[][], weights: number[], bias: number): number[] {
  return X.map(row => { let z = bias; for (let j = 0; j < weights.length; j++) z += weights[j] * row[j]; return sigmoid(z); });
}

function summarizeTopBottom(probs: number[], pnls: number[], wins: number[]) {
  const idx = probs.map((_, i) => i).sort((a, b) => probs[a] - probs[b]);
  const n = idx.length;
  const cut = Math.max(1, Math.floor(n / 5));
  const bottom = idx.slice(0, cut), top = idx.slice(n - cut);
  const stat = (subset: number[]) => {
    if (subset.length === 0) return { n: 0, wr: 0, avgPnl: 0, pf: 0 };
    const wr = (subset.reduce((s, i) => s + wins[i], 0) / subset.length) * 100;
    const avgPnl = subset.reduce((s, i) => s + pnls[i], 0) / subset.length;
    const gp = subset.filter(i => wins[i] === 1).reduce((s, i) => s + pnls[i], 0);
    const gl = Math.abs(subset.filter(i => wins[i] === 0).reduce((s, i) => s + pnls[i], 0));
    const pf = gl > 0 ? gp / gl : gp > 0 ? 999 : 0;
    return { n: subset.length, wr, avgPnl, pf };
  };
  return { bottom: stat(bottom), top: stat(top) };
}

function fmtStat(s: { n: number; wr: number; avgPnl: number; pf: number }): string {
  return `N=${s.n} WR=${s.wr.toFixed(1)}% AvgPnL=${s.avgPnl.toFixed(2)}% PF=${s.pf.toFixed(2)}`;
}

function walkForward(rows: Row[], featureNames: string[], side: "buy" | "sell") {
  const sorted = [...rows].sort((a, b) => a.dateMs - b.dateMs);
  const n = sorted.length;
  const testSize = Math.floor(n / (N_FOLDS + 1));
  console.log(`\n${"=".repeat(90)}`);
  console.log(`WALK-FORWARD (${featureNames.length} fitur: +rolling_vol_pct +breadth) — ${side.toUpperCase()}`);
  console.log("=".repeat(90));
  let successCount = 0, foldCount = 0;
  for (let fold = 0; fold < N_FOLDS; fold++) {
    const trainEnd = testSize * (fold + 1);
    const testStart = trainEnd;
    const testEnd = Math.min(testStart + testSize, n);
    if (testEnd - testStart < 30 || trainEnd < 100) continue;
    foldCount++;
    const trainRows = sorted.slice(0, trainEnd);
    const testRows = sorted.slice(testStart, testEnd);
    const Xtrain = trainRows.map(r => featureNames.map(fn => r.features[fn]));
    const Xtest = testRows.map(r => featureNames.map(fn => r.features[fn]));
    const ytrain = trainRows.map(r => (side === "buy" ? r.label_buy : r.label_sell));
    const ytest = testRows.map(r => (side === "buy" ? r.label_buy : r.label_sell));
    const pnlTest = testRows.map(r => (side === "buy" ? r.pnl_buy : r.pnl_sell));
    const { trainS, testS } = standardize(Xtrain, Xtest);
    const { weights, bias } = trainLogReg(trainS, ytrain, EPOCHS, LR, L2_LAMBDA);
    const testProbs = predict(testS, weights, bias);
    const { bottom, top } = summarizeTopBottom(testProbs, pnlTest, ytest);
    const improved = top.avgPnl > bottom.avgPnl && top.pf > bottom.pf;
    if (improved) successCount++;
    const dateFrom = new Date(testRows[0].dateMs).toISOString().slice(0, 10);
    const dateTo = new Date(testRows[testRows.length - 1].dateMs).toISOString().slice(0, 10);
    console.log(`\nFold ${fold + 1} — ${dateFrom} s/d ${dateTo}`);
    console.log(`  Bottom 20%: ${fmtStat(bottom)}`);
    console.log(`  Top 20%   : ${fmtStat(top)}`);
    console.log(`  ${improved ? "✅" : "❌"}`);
  }
  console.log(`\n${side.toUpperCase()} — ${successCount}/${foldCount} fold berhasil`);
  return { successCount, foldCount };
}

function leaveOnePairOut(rows: Row[], featureNames: string[], side: "buy" | "sell") {
  const pairs = [...new Set(rows.map(r => r.pair))];
  console.log(`\n--- LEAVE-ONE-PAIR-OUT ${side.toUpperCase()} (${featureNames.length} fitur) ---`);
  let allConsistent = true;
  for (const heldOutPair of pairs) {
    const trainRows = rows.filter(r => r.pair !== heldOutPair);
    const testRows = rows.filter(r => r.pair === heldOutPair);
    if (testRows.length < 30) continue;
    const Xtrain = trainRows.map(r => featureNames.map(fn => r.features[fn]));
    const Xtest = testRows.map(r => featureNames.map(fn => r.features[fn]));
    const ytrain = trainRows.map(r => (side === "buy" ? r.label_buy : r.label_sell));
    const ytest = testRows.map(r => (side === "buy" ? r.label_buy : r.label_sell));
    const pnlTest = testRows.map(r => (side === "buy" ? r.pnl_buy : r.pnl_sell));
    const { trainS, testS } = standardize(Xtrain, Xtest);
    const { weights, bias } = trainLogReg(trainS, ytrain, EPOCHS, LR, L2_LAMBDA);
    const testProbs = predict(testS, weights, bias);
    const { bottom, top } = summarizeTopBottom(testProbs, pnlTest, ytest);
    const improved = top.avgPnl > bottom.avgPnl && top.pf > bottom.pf;
    if (!improved) allConsistent = false;
    console.log(`  ${heldOutPair.padEnd(10)} Bottom: ${fmtStat(bottom)} | Top: ${fmtStat(top)} | ${improved ? "✅" : "❌"}`);
  }
  console.log(`  Kesimpulan: ${allConsistent ? "✅ KONSISTEN semua pair" : "⚠️ TIDAK konsisten semua pair"}`);
}

async function main() {
  const { rows: baseRows, featureNames: baseFeatureNames } = loadCsv(IN_PATH);
  let rows = enrichWithVolatility(baseRows);
  rows = enrichWithBreadth(rows);
  const featureNames = [...baseFeatureNames, "rolling_vol_pct", "breadth_bearish_pct", "breadth_bullish_pct"];

  console.log(`Total fitur: ${featureNames.length} (37 asli + rolling_vol_pct + breadth_bearish_pct + breadth_bullish_pct)`);

  const buyResult = walkForward(rows, featureNames, "buy");
  const sellResult = walkForward(rows, featureNames, "sell");

  console.log(`\n${"=".repeat(90)}`);
  console.log("LEAVE-ONE-PAIR-OUT (dengan fitur breadth)");
  console.log("=".repeat(90));
  leaveOnePairOut(rows, featureNames, "buy");
  leaveOnePairOut(rows, featureNames, "sell");

  console.log(`\n${"=".repeat(90)}`);
  console.log(`RINGKASAN AKHIR:`);
  console.log(`BUY  walk-forward: ${buyResult.successCount}/${buyResult.foldCount} (sebelumnya 7/8 tanpa breadth)`);
  console.log(`SELL walk-forward: ${sellResult.successCount}/${sellResult.foldCount} (sebelumnya 8/8 tanpa breadth)`);
  console.log("=".repeat(90));
}

main().catch(console.error);
