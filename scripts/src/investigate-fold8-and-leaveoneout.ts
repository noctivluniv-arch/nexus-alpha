/**
 * investigate-fold8-and-leaveoneout.ts
 *
 * Bagian A: Leave-one-pair-out ULANG dengan 38 fitur (37 lama + rolling_vol_pct)
 *           -> pastikan fitur volatilitas baru tidak merusak generalisasi lintas pair
 *
 * Bagian B: Bedah KHUSUS fold 8 (2026-01-04 s/d 2026-06-23) - periode PALING BARU
 *           yang masih gagal untuk BUY meski sudah pakai fitur volatilitas. Ini
 *           periode yang tumpang tindih dengan kondisi live production sekarang.
 *
 * Jalankan:
 *   tsx scripts/src/investigate-fold8-and-leaveoneout.ts
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

function enrichWithVolatility(rows: Row[], featureNames: string[]): { rows: Row[]; featureNames: string[] } {
  const pairs = [...new Set(rows.map(r => r.pair))];
  const enriched: Row[] = [];
  for (const pair of pairs) {
    const pairRows = rows.filter(r => r.pair === pair).sort((a, b) => a.dateMs - b.dateMs);
    const bbVals = pairRows.map(r => r.features.bb_bandwidth);
    const rollingPct = rollingPercentile(bbVals, ROLLING_WINDOW);
    pairRows.forEach((r, idx) => enriched.push({ ...r, features: { ...r.features, rolling_vol_pct: rollingPct[idx] } }));
  }
  return { rows: enriched, featureNames: [...featureNames, "rolling_vol_pct"] };
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

async function main() {
  const { rows: baseRows, featureNames: baseFeatureNames } = loadCsv(IN_PATH);
  const { rows, featureNames } = enrichWithVolatility(baseRows, baseFeatureNames);
  const pairs = [...new Set(rows.map(r => r.pair))];

  // ═══════════════ BAGIAN A: LEAVE-ONE-PAIR-OUT (38 fitur) ═══════════════
  console.log("=".repeat(95));
  console.log("BAGIAN A: LEAVE-ONE-PAIR-OUT ULANG DENGAN 38 FITUR (37 lama + rolling_vol_pct)");
  console.log("=".repeat(95));

  for (const side of ["buy", "sell"] as const) {
    console.log(`\n--- ${side.toUpperCase()} ---`);
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
    console.log(`  Kesimpulan ${side.toUpperCase()}: ${allConsistent ? "✅ KONSISTEN semua pair" : "⚠️ TIDAK konsisten semua pair"}`);
  }

  // ═══════════════ BAGIAN B: BEDAH FOLD 8 ═══════════════
  console.log(`\n${"=".repeat(95)}`);
  console.log("BAGIAN B: BEDAH FOLD 8 (periode 2026-01-04 s/d 2026-06-23) — kenapa BUY masih gagal?");
  console.log("=".repeat(95));

  const sorted = [...rows].sort((a, b) => a.dateMs - b.dateMs);
  const n = sorted.length;
  const testSize = Math.floor(n / (N_FOLDS + 1));
  const fold8Start = testSize * 8;
  const fold8End = Math.min(fold8Start + testSize, n);
  const fold8Test = sorted.slice(fold8Start, fold8End);
  const fold8Train = sorted.slice(0, fold8Start);

  // B1: Regime & baseline raw (tanpa model)
  const avgPnlBuyRaw = fold8Test.reduce((s, r) => s + r.pnl_buy, 0) / fold8Test.length;
  const avgPnlSellRaw = fold8Test.reduce((s, r) => s + r.pnl_sell, 0) / fold8Test.length;
  const buyWinRateRaw = (fold8Test.reduce((s, r) => s + r.label_buy, 0) / fold8Test.length) * 100;
  const sellWinRateRaw = (fold8Test.reduce((s, r) => s + r.label_sell, 0) / fold8Test.length) * 100;

  console.log(`\nB1. Regime fold 8 (${fold8Test.length} baris, TANPA model):`);
  console.log(`  Asal BUY semua hari  -> WinRate ${buyWinRateRaw.toFixed(1)}%, AvgPnL ${avgPnlBuyRaw.toFixed(2)}%`);
  console.log(`  Asal SELL semua hari -> WinRate ${sellWinRateRaw.toFixed(1)}%, AvgPnL ${avgPnlSellRaw.toFixed(2)}%`);
  console.log(`  Regime: ${avgPnlBuyRaw > avgPnlSellRaw ? "cenderung UPTREND (BUY unggul)" : "cenderung DOWNTREND (SELL unggul)"}`);

  // B2: Distribusi volatilitas fold 8 vs fold-fold lain yang berhasil (misal fold 1)
  const fold1Start = 0, fold1End = testSize;
  const fold1Test = sorted.slice(fold1Start, fold1End);
  const avgVolFold8 = fold8Test.reduce((s, r) => s + r.features.rolling_vol_pct, 0) / fold8Test.length;
  const avgVolFold1 = fold1Test.reduce((s, r) => s + r.features.rolling_vol_pct, 0) / fold1Test.length;

  console.log(`\nB2. Perbandingan rata-rata rolling_vol_pct:`);
  console.log(`  Fold 8 (gagal): ${avgVolFold8.toFixed(3)}`);
  console.log(`  Fold 1 (berhasil): ${avgVolFold1.toFixed(3)}`);

  // B3: Per-pair breakdown di fold 8 - apakah semua pair sama-sama jelek, atau cuma sebagian?
  console.log(`\nB3. Breakdown per pair di fold 8 (asal BUY, tanpa model):`);
  for (const pair of pairs) {
    const pairFold8 = fold8Test.filter(r => r.pair === pair);
    if (pairFold8.length === 0) continue;
    const wr = (pairFold8.reduce((s, r) => s + r.label_buy, 0) / pairFold8.length) * 100;
    const avgPnl = pairFold8.reduce((s, r) => s + r.pnl_buy, 0) / pairFold8.length;
    console.log(`  ${pair.padEnd(10)} N=${pairFold8.length} WR=${wr.toFixed(1)}% AvgPnL=${avgPnl.toFixed(2)}%`);
  }

  // B4: Sensitivitas hyperparameter khusus fold 8
  console.log(`\nB4. Sensitivitas hyperparameter untuk BUY di fold 8:`);
  const configs = [
    { epochs: 1000, lambda: 0.001 }, { epochs: 3000, lambda: 0.01 },
    { epochs: 3000, lambda: 0.1 }, { epochs: 3000, lambda: 0.3 }, { epochs: 6000, lambda: 0.05 },
  ];
  const Xtrain8 = fold8Train.map(r => featureNames.map(fn => r.features[fn]));
  const Xtest8 = fold8Test.map(r => featureNames.map(fn => r.features[fn]));
  const ytrain8 = fold8Train.map(r => r.label_buy);
  const ytest8 = fold8Test.map(r => r.label_buy);
  const pnlTest8 = fold8Test.map(r => r.pnl_buy);
  for (const cfg of configs) {
    const { trainS, testS } = standardize(Xtrain8, Xtest8);
    const { weights, bias } = trainLogReg(trainS, ytrain8, cfg.epochs, LR, cfg.lambda);
    const testProbs = predict(testS, weights, bias);
    const { bottom, top } = summarizeTopBottom(testProbs, pnlTest8, ytest8);
    const improved = top.avgPnl > bottom.avgPnl;
    console.log(`  [epoch${cfg.epochs}_lambda${cfg.lambda}] Bottom: ${fmtStat(bottom)} | Top: ${fmtStat(top)} | ${improved ? "✅" : "❌"}`);
  }

  console.log(`\n${"=".repeat(95)}`);
}

main().catch(console.error);
