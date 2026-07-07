/**
 * investigate-buy-instability.ts
 *
 * Diagnosa KENAPA model BUY gagal di fold 1 & 3 (walk-forward sebelumnya),
 * sebelum menyerah atau lanjut ke shadow-test cuma dengan SELL.
 *
 * 3 pengecekan:
 * 1. REGIME MARKET per fold — apakah fold yang gagal itu memang periode
 *    downtrend/sideways market secara keseluruhan (BUY realistis rugi di situ,
 *    bukan salah model)?
 * 2. BASELINE WIN RATE per fold — % hari yang seharusnya menang kalau asal BUY
 *    tanpa model sama sekali, independen dari model manapun.
 * 3. SENSITIVITAS HYPERPARAMETER — apakah ganti regularisasi/epoch bikin
 *    fold yang gagal jadi lebih stabil, atau memang mentok di situ?
 *
 * Jalankan:
 *   tsx scripts/src/investigate-buy-instability.ts
 */

import * as fs from "fs";

const IN_PATH = "scripts/output/ml-dataset.csv";
const N_FOLDS = 4;

interface Row {
  pair: string;
  dateMs: number;
  features: number[];
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
    rows.push({
      pair: parts[0],
      dateMs: parseInt(parts[1], 10),
      features: featureNames.map((_, idx) => parseFloat(parts[2 + idx])),
      label_buy: parseInt(parts[2 + featureNames.length], 10),
      pnl_buy: parseFloat(parts[3 + featureNames.length]),
      label_sell: parseInt(parts[4 + featureNames.length], 10),
      pnl_sell: parseFloat(parts[5 + featureNames.length]),
    });
  }
  return { rows, featureNames };
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

function summarizeTopBottom(probs: number[], pnls: number[], wins: number[]) {
  const idx = probs.map((_, i) => i).sort((a, b) => probs[a] - probs[b]);
  const n = idx.length;
  const cut = Math.max(1, Math.floor(n / 5));
  const bottom = idx.slice(0, cut);
  const top = idx.slice(n - cut);
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
  const { rows } = loadCsv(IN_PATH);
  const sorted = [...rows].sort((a, b) => a.dateMs - b.dateMs);
  const n = sorted.length;
  const testSize = Math.floor(n / (N_FOLDS + 1));

  console.log("=".repeat(95));
  console.log("DIAGNOSA 1: REGIME MARKET + BASELINE WIN RATE per fold (independen dari model)");
  console.log("=".repeat(95));

  const foldInfo: Array<{ fold: number; trainEnd: number; testStart: number; testEnd: number }> = [];

  for (let fold = 0; fold < N_FOLDS; fold++) {
    const trainEnd = testSize * (fold + 1);
    const testStart = trainEnd;
    const testEnd = Math.min(testStart + testSize, n);
    if (testEnd - testStart < 30 || trainEnd < 100) continue;
    foldInfo.push({ fold, trainEnd, testStart, testEnd });

    const testRows = sorted.slice(testStart, testEnd);
    const dateFrom = new Date(testRows[0].dateMs).toISOString().slice(0, 10);
    const dateTo = new Date(testRows[testRows.length - 1].dateMs).toISOString().slice(0, 10);

    // Regime: rata-rata pnl_buy dan pnl_sell TANPA model (asal BUY/SELL semua hari) -> proxy arah dominan pasar
    const avgPnlBuyRaw = testRows.reduce((s, r) => s + r.pnl_buy, 0) / testRows.length;
    const avgPnlSellRaw = testRows.reduce((s, r) => s + r.pnl_sell, 0) / testRows.length;
    const buyWinRateRaw = (testRows.reduce((s, r) => s + r.label_buy, 0) / testRows.length) * 100;
    const sellWinRateRaw = (testRows.reduce((s, r) => s + r.label_sell, 0) / testRows.length) * 100;
    const regime = avgPnlBuyRaw > avgPnlSellRaw ? "cenderung UPTREND" : avgPnlSellRaw > avgPnlBuyRaw ? "cenderung DOWNTREND" : "netral";

    console.log(`\nFold ${fold + 1} — ${dateFrom} s/d ${dateTo} (${testRows.length} baris)`);
    console.log(`  Regime pasar (asal BUY vs asal SELL semua hari, TANPA model): ${regime}`);
    console.log(`  Asal BUY semua hari  -> WinRate ${buyWinRateRaw.toFixed(1)}%, AvgPnL ${avgPnlBuyRaw.toFixed(2)}%`);
    console.log(`  Asal SELL semua hari -> WinRate ${sellWinRateRaw.toFixed(1)}%, AvgPnL ${avgPnlSellRaw.toFixed(2)}%`);
  }

  console.log(`\n${"=".repeat(95)}`);
  console.log("DIAGNOSA 2: SENSITIVITAS HYPERPARAMETER — BUY, tiap fold, beberapa kombinasi lambda/epoch");
  console.log("=".repeat(95));

  const configs = [
    { epochs: 1000, lambda: 0.001, label: "epoch1000_lambda0.001" },
    { epochs: 3000, lambda: 0.01, label: "epoch3000_lambda0.01 (baseline)" },
    { epochs: 3000, lambda: 0.1, label: "epoch3000_lambda0.1" },
    { epochs: 6000, lambda: 0.05, label: "epoch6000_lambda0.05" },
  ];

  for (const fi of foldInfo) {
    const trainRows = sorted.slice(0, fi.trainEnd);
    const testRows = sorted.slice(fi.testStart, fi.testEnd);
    const Xtrain = trainRows.map(r => r.features);
    const Xtest = testRows.map(r => r.features);
    const ytrain = trainRows.map(r => r.label_buy);
    const ytest = testRows.map(r => r.label_buy);
    const pnlTest = testRows.map(r => r.pnl_buy);

    console.log(`\nFold ${fi.fold + 1}:`);
    for (const cfg of configs) {
      const { trainS, testS } = standardize(Xtrain, Xtest);
      const { weights, bias } = trainLogReg(trainS, ytrain, cfg.epochs, 0.1, cfg.lambda);
      const testProbs = predict(testS, weights, bias);
      const { bottom, top } = summarizeTopBottom(testProbs, pnlTest, ytest);
      const improved = top.avgPnl > bottom.avgPnl;
      console.log(`  [${cfg.label}] Bottom: ${fmtStat(bottom)} | Top: ${fmtStat(top)} | ${improved ? "✅" : "❌"}`);
    }
  }

  console.log(`\n${"=".repeat(95)}`);
  console.log("Interpretasi:");
  console.log("- Kalau Diagnosa 1 nunjukkin fold gagal = downtrend/sideways (SELL raw menang, BUY raw kalah)");
  console.log("  -> BUY memang WAJAR gagal di situ, solusinya bukan benerin model, tapi REGIME FILTER");
  console.log("     (nyalakan BUY cuma pas kondisi mendukung, sama seperti SELL sudah pakai trend1d filter)");
  console.log("- Kalau Diagnosa 2 nunjukkin SEMUA kombinasi hyperparameter tetap gagal di fold yang sama");
  console.log("  -> bukan soal tuning, kemungkinan besar memang keterbatasan fitur/data di periode itu");
  console.log("=".repeat(95));
}

main().catch(console.error);
