/**
 * train-logistic-model.ts
 *
 * Latih logistic regression dari scripts/output/ml-dataset.csv, terpisah
 * untuk BUY dan SELL. Split KRONOLOGIS (70% lama = train, 30% baru = test)
 * karena dataset TIDAK anti-overlap -> baris berdekatan waktu berkorelasi,
 * random split akan menghasilkan angka yang menyesatkan (data leakage).
 *
 * Validasi utama: analisis per-desil probabilitas di data TEST. Kalau model
 * beneran berguna, desil probabilitas tertinggi harus punya WR & AvgPnL yang
 * jelas lebih baik dari desil terendah, DI DATA YANG TIDAK PERNAH DILIHAT
 * saat training. Kalau tidak ada pola jelas -> model tidak lebih baik dari
 * bobot manual lama, JANGAN dipakai ke production.
 *
 * Jalankan:
 *   tsx scripts/src/train-logistic-model.ts
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
    const pair = parts[0];
    const dateMs = parseInt(parts[1], 10);
    const features = featureNames.map((_, idx) => parseFloat(parts[2 + idx]));
    const label_buy = parseInt(parts[2 + featureNames.length], 10);
    const pnl_buy = parseFloat(parts[3 + featureNames.length]);
    const label_sell = parseInt(parts[4 + featureNames.length], 10);
    const pnl_sell = parseFloat(parts[5 + featureNames.length]);
    rows.push({ pair, dateMs, features, label_buy, pnl_buy, label_sell, pnl_sell });
  }
  return { rows, featureNames };
}

function standardize(train: number[][], test: number[][]): { trainS: number[][]; testS: number[][]; mean: number[]; std: number[] } {
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
  return { trainS: apply(train), testS: apply(test), mean, std };
}

function sigmoid(z: number): number {
  if (z > 30) return 1;
  if (z < -30) return 0;
  return 1 / (1 + Math.exp(-z));
}

function trainLogReg(X: number[][], y: number[], epochs: number, lr: number, lambda: number): { weights: number[]; bias: number } {
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
      const pred = sigmoid(z);
      const err = pred - y[i];
      for (let j = 0; j < nFeat; j++) gradW[j] += err * X[i][j];
      gradB += err;
    }
    for (let j = 0; j < nFeat; j++) {
      weights[j] -= lr * (gradW[j] / n + lambda * weights[j]);
    }
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

function evaluateDeciles(probs: number[], pnls: number[], wins: number[], label: string) {
  const idx = probs.map((p, i) => i).sort((a, b) => probs[a] - probs[b]);
  const n = idx.length;
  const decileSize = Math.floor(n / 10);
  console.log(`\n${label} — Analisis Per-Desil Probabilitas (data TEST, belum pernah dilihat model)`);
  console.log("-".repeat(78));
  console.log(`${"Desil".padEnd(10)} ${"N".padEnd(6)} ${"AvgProb".padEnd(10)} ${"WinRate".padEnd(10)} ${"AvgPnL".padEnd(10)} ${"PF"}`);
  console.log("-".repeat(78));
  for (let d = 0; d < 10; d++) {
    const start = d * decileSize;
    const end = d === 9 ? n : start + decileSize;
    const sliceIdx = idx.slice(start, end);
    if (sliceIdx.length === 0) continue;
    const avgProb = sliceIdx.reduce((s, i) => s + probs[i], 0) / sliceIdx.length;
    const wr = (sliceIdx.reduce((s, i) => s + wins[i], 0) / sliceIdx.length) * 100;
    const avgPnl = sliceIdx.reduce((s, i) => s + pnls[i], 0) / sliceIdx.length;
    const gp = sliceIdx.filter(i => wins[i] === 1).reduce((s, i) => s + pnls[i], 0);
    const gl = Math.abs(sliceIdx.filter(i => wins[i] === 0).reduce((s, i) => s + pnls[i], 0));
    const pf = gl > 0 ? gp / gl : gp > 0 ? 999 : 0;
    console.log(`D${d + 1} (${d === 9 ? "tertinggi" : d === 0 ? "terendah" : "  "}).padEnd(4) ${String(sliceIdx.length).padEnd(6)} ${avgProb.toFixed(3).padEnd(10)} ${(wr.toFixed(1) + "%").padEnd(10)} ${(avgPnl.toFixed(2) + "%").padEnd(10)} ${pf.toFixed(2)}`);
  }
}

function printTopFeatures(weights: number[], featureNames: string[], label: string) {
  const ranked = featureNames.map((name, i) => ({ name, w: weights[i] })).sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
  console.log(`\n${label} — Top 15 fitur paling berpengaruh (bobot standardized, +/- = arah pengaruh ke WIN)`);
  console.log("-".repeat(60));
  for (const r of ranked.slice(0, 15)) {
    console.log(`  ${r.w >= 0 ? "+" : ""}${r.w.toFixed(4).padEnd(10)} ${r.name}`);
  }
}

function runForSide(rows: Row[], featureNames: string[], side: "buy" | "sell") {
  const sorted = [...rows].sort((a, b) => a.dateMs - b.dateMs);
  const splitIdx = Math.floor(sorted.length * TRAIN_RATIO);
  const trainRows = sorted.slice(0, splitIdx);
  const testRows = sorted.slice(splitIdx);

  const Xtrain = trainRows.map(r => r.features);
  const Xtest = testRows.map(r => r.features);
  const ytrain = trainRows.map(r => (side === "buy" ? r.label_buy : r.label_sell));
  const ytest = testRows.map(r => (side === "buy" ? r.label_buy : r.label_sell));
  const pnlTest = testRows.map(r => (side === "buy" ? r.pnl_buy : r.pnl_sell));

  const { trainS, testS } = standardize(Xtrain, Xtest);

  console.log(`\n${"=".repeat(78)}`);
  console.log(`MODEL: ${side.toUpperCase()} — train ${trainRows.length} baris (${new Date(trainRows[0].dateMs).toISOString().slice(0,10)} s/d ${new Date(trainRows[trainRows.length-1].dateMs).toISOString().slice(0,10)}), test ${testRows.length} baris (${new Date(testRows[0].dateMs).toISOString().slice(0,10)} s/d ${new Date(testRows[testRows.length-1].dateMs).toISOString().slice(0,10)})`);
  console.log("=".repeat(78));

  const { weights, bias } = trainLogReg(trainS, ytrain, EPOCHS, LR, L2_LAMBDA);

  const trainProbs = predict(trainS, weights, bias);
  const testProbs = predict(testS, weights, bias);

  const trainAcc = trainProbs.filter((p, i) => (p >= 0.5 ? 1 : 0) === ytrain[i]).length / trainProbs.length;
  const testAcc = testProbs.filter((p, i) => (p >= 0.5 ? 1 : 0) === ytest[i]).length / testProbs.length;
  console.log(`Train accuracy: ${(trainAcc * 100).toFixed(1)}% | Test accuracy: ${(testAcc * 100).toFixed(1)}%`);
  console.log(`(Baseline kalau nebak "menang" terus: train ${(ytrain.reduce((a,b)=>a+b,0)/ytrain.length*100).toFixed(1)}%, test ${(ytest.reduce((a,b)=>a+b,0)/ytest.length*100).toFixed(1)}%)`);

  printTopFeatures(weights, featureNames, side.toUpperCase());
  evaluateDeciles(testProbs, pnlTest, ytest, side.toUpperCase());

  // Simpan model (weights + mean/std) untuk dipakai nanti kalau hasilnya bagus
  return { weights, bias, featureNames };
}

async function main() {
  const { rows, featureNames } = loadCsv(IN_PATH);
  console.log(`Loaded ${rows.length} baris, ${featureNames.length} fitur dari ${IN_PATH}`);

  const buyModel = runForSide(rows, featureNames, "buy");
  const sellModel = runForSide(rows, featureNames, "sell");

  fs.writeFileSync("scripts/output/model-buy.json", JSON.stringify(buyModel, null, 2));
  fs.writeFileSync("scripts/output/model-sell.json", JSON.stringify(sellModel, null, 2));
  console.log(`\n✅ Model tersimpan di scripts/output/model-buy.json dan model-sell.json`);
  console.log(`\nPENTING: Model ini BARU HASIL RISET. JANGAN dipasang ke production dulu.`);
  console.log(`Lihat dulu tabel per-desil di atas — kalau desil tertinggi (D10) tidak jelas`);
  console.log(`lebih baik dari desil terendah (D1) di data TEST, berarti model ini TIDAK`);
  console.log(`lebih baik dari bobot manual lama, dan tidak layak dipakai.`);
}

main().catch(console.error);
