/**
 * compare-perpair-vs-general.ts
 *
 * Perbandingan adil: model GENERAL (dilatih dari semua pair) vs model
 * PER-PAIR (dilatih hanya dari pair itu sendiri), diuji di baris TEST
 * YANG SAMA PERSIS untuk tiap pair (split kronologis 70/30 global).
 *
 * Tujuan: jawab pertanyaan apakah personalisasi per-pair worth it, atau
 * sample size per-pair (814 baris -> ~570 training) terlalu kecil sehingga
 * per-pair model malah overfitting dan lebih jelek dari model general.
 *
 * Jalankan:
 *   tsx scripts/src/compare-perpair-vs-general.ts
 */

import * as fs from "fs";

const IN_PATH = "scripts/output/ml-dataset.csv";
const TRAIN_RATIO = 0.7;
const EPOCHS = 3000;
const LR = 0.1;
const L2_LAMBDA = 0.01;

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
  const cut = Math.max(1, Math.floor(n / 3)); // top/bottom 33% - sample per-pair test lebih kecil, biar stabil
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

function runComparison(rows: Row[], side: "buy" | "sell") {
  const sorted = [...rows].sort((a, b) => a.dateMs - b.dateMs);
  const splitIdx = Math.floor(sorted.length * TRAIN_RATIO);
  const globalCutoffDate = sorted[splitIdx].dateMs;

  const pairs = [...new Set(rows.map(r => r.pair))];

  // Model GENERAL: train dari semua pair sebelum cutoff
  const generalTrainRows = rows.filter(r => r.dateMs < globalCutoffDate);
  const Xg = generalTrainRows.map(r => r.features);
  const yg = generalTrainRows.map(r => (side === "buy" ? r.label_buy : r.label_sell));

  console.log(`\n${"=".repeat(90)}`);
  console.log(`PERBANDINGAN GENERAL vs PER-PAIR — ${side.toUpperCase()}`);
  console.log(`Cutoff waktu: ${new Date(globalCutoffDate).toISOString().slice(0, 10)} (sama untuk semua pair)`);
  console.log("=".repeat(90));
  console.log(`\n${"Pair".padEnd(10)} | ${"GENERAL Bottom33%".padEnd(28)} | ${"GENERAL Top33%".padEnd(28)}`);
  console.log("-".repeat(90));

  let generalWins = 0;
  let perPairWins = 0;
  const summary: Array<{ pair: string; genImprove: number; ppImprove: number }> = [];

  for (const pair of pairs) {
    const testRows = rows.filter(r => r.pair === pair && r.dateMs >= globalCutoffDate);
    if (testRows.length < 15) continue;

    // Evaluasi model GENERAL di test rows pair ini
    const { trainS: trainSg, testS: testSg } = standardize(Xg, testRows.map(r => r.features));
    const { weights: wg, bias: bg } = trainLogReg(trainSg, yg, EPOCHS, LR, L2_LAMBDA);
    const testProbsG = predict(testSg, wg, bg);
    const ytestPair = testRows.map(r => (side === "buy" ? r.label_buy : r.label_sell));
    const pnlTestPair = testRows.map(r => (side === "buy" ? r.pnl_buy : r.pnl_sell));
    const generalResult = summarizeTopBottom(testProbsG, pnlTestPair, ytestPair);

    // Model PER-PAIR: train HANYA dari pair ini, sebelum cutoff yang sama
    const perPairTrainRows = rows.filter(r => r.pair === pair && r.dateMs < globalCutoffDate);
    const Xp = perPairTrainRows.map(r => r.features);
    const yp = perPairTrainRows.map(r => (side === "buy" ? r.label_buy : r.label_sell));
    const { trainS: trainSp, testS: testSp } = standardize(Xp, testRows.map(r => r.features));
    const { weights: wp, bias: bp } = trainLogReg(trainSp, yp, EPOCHS, LR, L2_LAMBDA);
    const testProbsP = predict(testSp, wp, bp);
    const perPairResult = summarizeTopBottom(testProbsP, pnlTestPair, ytestPair);

    const genImprove = generalResult.top.avgPnl - generalResult.bottom.avgPnl;
    const ppImprove = perPairResult.top.avgPnl - perPairResult.bottom.avgPnl;
    summary.push({ pair, genImprove, ppImprove });

    if (genImprove > ppImprove) generalWins++;
    else perPairWins++;

    console.log(`\n${pair} (train per-pair: ${perPairTrainRows.length} baris, train general: ${generalTrainRows.length} baris, test: ${testRows.length} baris)`);
    console.log(`  GENERAL   -> Bottom33%: ${fmtStat(generalResult.bottom)}  |  Top33%: ${fmtStat(generalResult.top)}  |  Selisih AvgPnL: ${genImprove.toFixed(2)}%`);
    console.log(`  PER-PAIR  -> Bottom33%: ${fmtStat(perPairResult.bottom)}  |  Top33%: ${fmtStat(perPairResult.top)}  |  Selisih AvgPnL: ${ppImprove.toFixed(2)}%`);
    console.log(`  ${genImprove > ppImprove ? "-> GENERAL lebih baik untuk pair ini" : "-> PER-PAIR lebih baik untuk pair ini"}`);
  }

  console.log(`\n${"-".repeat(90)}`);
  console.log(`RINGKASAN ${side.toUpperCase()}: GENERAL menang di ${generalWins}/${summary.length} pair, PER-PAIR menang di ${perPairWins}/${summary.length} pair`);
  const avgGenImprove = summary.reduce((s, x) => s + x.genImprove, 0) / summary.length;
  const avgPpImprove = summary.reduce((s, x) => s + x.ppImprove, 0) / summary.length;
  console.log(`Rata-rata selisih AvgPnL (Top-Bottom) — GENERAL: ${avgGenImprove.toFixed(2)}%, PER-PAIR: ${avgPpImprove.toFixed(2)}%`);
}

async function main() {
  const { rows } = loadCsv(IN_PATH);
  runComparison(rows, "buy");
  runComparison(rows, "sell");
}

main().catch(console.error);
