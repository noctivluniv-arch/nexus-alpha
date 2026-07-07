/**
 * backtest-ml-threshold.ts
 *
 * Backtest ML BUY/SELL di THRESHOLD PRODUCTION (prob >= 0.52), bukan top/bottom
 * percentile — supaya hasilnya bisa dibandingkan head-to-head secara adil dengan
 * backtest-breakout-walkforward.ts (yang mengukur "kalau strategi ini benar-benar
 * dijalankan apa adanya", bukan cuma sinyal paling percaya diri).
 *
 * Reuse training pipeline dari retrain-with-volatility.ts (38 fitur: 37 asli +
 * rolling_vol_pct), 8-fold walk-forward yang sama.
 *
 * Jalankan:
 *   tsx scripts/src/backtest-ml-threshold.ts
 */

import * as fs from "fs";

const IN_PATH = "scripts/output/ml-dataset.csv";
const ROLLING_WINDOW = 90;
const N_FOLDS = 8;
const EPOCHS = 3000;
const LR = 0.1;
const L2_LAMBDA = 0.01;
const THRESHOLD = 0.52; // sama persis dengan threshold production shadow ML

interface Row {
  pair: string;
  dateMs: number;
  features: Record<string, number>;
  label_buy: number;
  pnl_buy: number;
  label_sell: number;
  pnl_sell: number;
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
    pairRows.forEach((r, idx) => {
      enriched.push({ ...r, features: { ...r.features, rolling_vol_pct: rollingPct[idx] } });
    });
  }
  return { rows: enriched, featureNames: [...featureNames, "rolling_vol_pct"] };
}

function standardize(train: number[][], test: number[][]) {
  const nFeat = train[0].length;
  const mean = new Array(nFeat).fill(0);
  const std = new Array(nFeat).fill(1);
  for (let j = 0; j < nFeat; j++) {
    let s = 0;
    for (const row of train) s += row[j];
    mean[j] = s / train.length;
  }
  for (let j = 0; j < nFeat; j++) {
    let s = 0;
    for (const row of train) s += (row[j] - mean[j]) ** 2;
    std[j] = Math.sqrt(s / train.length) || 1;
  }
  const apply = (data: number[][]) => data.map(row => row.map((v, j) => (v - mean[j]) / std[j]));
  return { trainS: apply(train), testS: apply(test) };
}

function sigmoid(z: number): number {
  if (z > 30) return 1;
  if (z < -30) return 0;
  return 1 / (1 + Math.exp(-z));
}

function trainLogReg(X: number[][], y: number[], epochs: number, lr: number, lambda: number) {
  const n = X.length;
  const nFeat = X[0].length;
  let weights = new Array(nFeat).fill(0);
  let bias = 0;
  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW = new Array(nFeat).fill(0);
    let gradB = 0;
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
  return X.map(row => {
    let z = bias;
    for (let j = 0; j < weights.length; j++) z += weights[j] * row[j];
    return sigmoid(z);
  });
}

function statAt(probs: number[], pnls: number[], wins: number[], threshold: number) {
  const idx = probs.map((_, i) => i).filter(i => probs[i] >= threshold);
  if (idx.length === 0) return { n: 0, wr: 0, avgPnl: 0, pf: 0 };
  const wr = (idx.reduce((s, i) => s + wins[i], 0) / idx.length) * 100;
  const avgPnl = idx.reduce((s, i) => s + pnls[i], 0) / idx.length;
  const gp = idx.filter(i => wins[i] === 1).reduce((s, i) => s + pnls[i], 0);
  const gl = Math.abs(idx.filter(i => wins[i] === 0).reduce((s, i) => s + pnls[i], 0));
  const pf = gl > 0 ? gp / gl : gp > 0 ? 999 : 0;
  return { n: idx.length, wr, avgPnl, pf };
}

function fmtStat(s: { n: number; wr: number; avgPnl: number; pf: number }): string {
  return `N=${s.n} WR=${s.wr.toFixed(1)}% AvgPnL=${s.avgPnl.toFixed(2)}% PF=${s.pf.toFixed(2)}`;
}

function walkForwardThreshold(rows: Row[], featureNames: string[], side: "buy" | "sell") {
  const sorted = [...rows].sort((a, b) => a.dateMs - b.dateMs);
  const n = sorted.length;
  const testSize = Math.floor(n / (N_FOLDS + 1));

  console.log(`\n${"=".repeat(90)}`);
  console.log(`BACKTEST THRESHOLD PRODUCTION (prob >= ${THRESHOLD}) — ${side.toUpperCase()}`);
  console.log("=".repeat(90));

  const allTraded: { pnl: number; win: number; dateMs: number }[] = [];

  for (let fold = 0; fold < N_FOLDS; fold++) {
    const trainEnd = testSize * (fold + 1);
    const testStart = trainEnd;
    const testEnd = Math.min(testStart + testSize, n);
    if (testEnd - testStart < 30 || trainEnd < 100) continue;

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
    const stat = statAt(testProbs, pnlTest, ytest, THRESHOLD);

    testRows.forEach((r, i) => {
      if (testProbs[i] >= THRESHOLD) {
        allTraded.push({ pnl: pnlTest[i], win: ytest[i], dateMs: r.dateMs });
      }
    });

    const dateFrom = new Date(testRows[0].dateMs).toISOString().slice(0, 10);
    const dateTo = new Date(testRows[testRows.length - 1].dateMs).toISOString().slice(0, 10);
    console.log(`Fold ${fold + 1} (${dateFrom} s/d ${dateTo}): ${fmtStat(stat)}`);
  }

  // Agregat keseluruhan (semua fold digabung) — untuk dibandingkan langsung dengan breakout
  if (allTraded.length > 0) {
    const wr = (allTraded.reduce((s, r) => s + r.win, 0) / allTraded.length) * 100;
    const avgPnl = allTraded.reduce((s, r) => s + r.pnl, 0) / allTraded.length;
    const gp = allTraded.filter(r => r.win === 1).reduce((s, r) => s + r.pnl, 0);
    const gl = Math.abs(allTraded.filter(r => r.win === 0).reduce((s, r) => s + r.pnl, 0));
    const pf = gl > 0 ? gp / gl : gp > 0 ? 999 : 0;
    console.log(`\n>>> AGREGAT SEMUA FOLD: N=${allTraded.length} WR=${wr.toFixed(1)}% AvgPnL=${avgPnl.toFixed(2)}% PF=${pf.toFixed(2)}`);

    // Split jadi 2 periode (mirip breakout: separuh awal vs separuh akhir) untuk deteksi overfitting
    const half = Math.floor(allTraded.length / 2);
    const p1 = allTraded.slice(0, half);
    const p2 = allTraded.slice(half);
    const statPeriod = (arr: typeof allTraded) => {
      if (arr.length === 0) return { n: 0, wr: 0, avgPnl: 0, pf: 0 };
      const wr = (arr.reduce((s, r) => s + r.win, 0) / arr.length) * 100;
      const avgPnl = arr.reduce((s, r) => s + r.pnl, 0) / arr.length;
      const gp = arr.filter(r => r.win === 1).reduce((s, r) => s + r.pnl, 0);
      const gl = Math.abs(arr.filter(r => r.win === 0).reduce((s, r) => s + r.pnl, 0));
      const pf = gl > 0 ? gp / gl : gp > 0 ? 999 : 0;
      return { n: arr.length, wr, avgPnl, pf };
    };
    console.log(`>>> Periode 1 (lebih lama): ${fmtStat(statPeriod(p1))}`);
    console.log(`>>> Periode 2 (lebih baru): ${fmtStat(statPeriod(p2))}`);
  } else {
    console.log(`\n>>> Tidak ada trade yang lolos threshold ${THRESHOLD} di data ini.`);
  }
}

async function main() {
  const { rows, featureNames: baseFeatures } = loadCsv(IN_PATH);
  const { rows: enrichedRows, featureNames } = enrichWithVolatility(rows, baseFeatures);
  console.log(`Fitur: ${featureNames.length} (termasuk rolling_vol_pct)`);
  console.log(`Threshold production: prob >= ${THRESHOLD}`);

  walkForwardThreshold(enrichedRows, featureNames, "buy");
  walkForwardThreshold(enrichedRows, featureNames, "sell");
}

main().catch(console.error);
