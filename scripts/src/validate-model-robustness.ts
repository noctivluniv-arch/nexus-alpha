/**
 * validate-model-robustness.ts
 *
 * Dua uji ketahanan model, keduanya WAJIB sebelum model dipertimbangkan
 * untuk production:
 *
 * 1. WALK-FORWARD MULTI-FOLD — ulangi split train/test kronologis di
 *    beberapa potongan waktu berbeda (bukan cuma 1 split 70/30 seperti
 *    sebelumnya). Kalau pola desil cuma bagus di 1 fold tapi jelek di
 *    fold lain -> kemungkinan cuma kebetulan cocok di periode tertentu.
 *
 * 2. LEAVE-ONE-PAIR-OUT — latih pakai 5 pair, test di pair ke-6 yang
 *    TIDAK PERNAH dilihat model sama sekali. Ulangi bergilir untuk semua
 *    pair. Ini jawaban langsung untuk pertanyaan: "kalau nanti nambah
 *    pair baru, apa modelnya masih relevan?" Kalau hasil per-pair
 *    konsisten (desil tinggi tetap lebih baik dari desil rendah), model
 *    kemungkinan besar general. Kalau berantakan di pair tertentu,
 *    berarti model belajar karakteristik spesifik pair itu, bukan pola
 *    universal -> HATI-HATI pakai ke pair baru tanpa retrain+revalidasi.
 *
 * Jalankan:
 *   tsx scripts/src/validate-model-robustness.ts
 */

import * as fs from "fs";

const IN_PATH = "scripts/output/ml-dataset.csv";
const EPOCHS = 3000;
const LR = 0.1;
const L2_LAMBDA = 0.01;
const N_FOLDS = 8; // dinaikkan dari 4, dataset sekarang 2x lebih besar // walk-forward: 4 potongan waktu berurutan

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
  const cut = Math.floor(n / 5); // bottom 20% vs top 20% (lebih stabil dari desil kalau N kecil)
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

// ─── TEST 1: Walk-forward multi-fold ────────────────────────────────────────
function walkForwardMultiFold(rows: Row[], side: "buy" | "sell") {
  const sorted = [...rows].sort((a, b) => a.dateMs - b.dateMs);
  const n = sorted.length;
  console.log(`\n${"=".repeat(78)}`);
  console.log(`WALK-FORWARD MULTI-FOLD — ${side.toUpperCase()} (${N_FOLDS} fold berurutan)`);
  console.log("=".repeat(78));

  // Fold k: train di [0, splitPoint_k), test di [splitPoint_k, splitPoint_k + testSize)
  const testSize = Math.floor(n / (N_FOLDS + 1)); // sisakan porsi awal untuk train fold pertama
  let allConsistent = true;

  for (let fold = 0; fold < N_FOLDS; fold++) {
    const trainEnd = testSize * (fold + 1);
    const testStart = trainEnd;
    const testEnd = Math.min(testStart + testSize, n);
    if (testEnd - testStart < 30 || trainEnd < 100) continue;

    const trainRows = sorted.slice(0, trainEnd);
    const testRows = sorted.slice(testStart, testEnd);

    const Xtrain = trainRows.map(r => r.features);
    const Xtest = testRows.map(r => r.features);
    const ytrain = trainRows.map(r => (side === "buy" ? r.label_buy : r.label_sell));
    const ytest = testRows.map(r => (side === "buy" ? r.label_buy : r.label_sell));
    const pnlTest = testRows.map(r => (side === "buy" ? r.pnl_buy : r.pnl_sell));

    const { trainS, testS } = standardize(Xtrain, Xtest);
    const { weights, bias } = trainLogReg(trainS, ytrain, EPOCHS, LR, L2_LAMBDA);
    const testProbs = predict(testS, weights, bias);

    const { bottom, top } = summarizeTopBottom(testProbs, pnlTest, ytest);
    const improved = top.avgPnl > bottom.avgPnl && top.pf > bottom.pf;
    if (!improved) allConsistent = false;

    const dateFrom = new Date(testRows[0].dateMs).toISOString().slice(0, 10);
    const dateTo = new Date(testRows[testRows.length - 1].dateMs).toISOString().slice(0, 10);
    console.log(`\nFold ${fold + 1} — test period ${dateFrom} s/d ${dateTo} (train ${trainRows.length} baris, test ${testRows.length} baris)`);
    console.log(`  Bottom 20% (low prob): ${fmtStat(bottom)}`);
    console.log(`  Top 20%    (high prob): ${fmtStat(top)}`);
    console.log(`  ${improved ? "✅ Top lebih baik dari Bottom" : "❌ Top TIDAK jelas lebih baik — mencurigakan"}`);
  }

  console.log(`\n${side.toUpperCase()} — Kesimpulan walk-forward: ${allConsistent ? "✅ KONSISTEN di semua fold" : "⚠️ TIDAK konsisten di semua fold — model mungkin cuma cocok di periode tertentu"}`);
}

// ─── TEST 2: Leave-one-pair-out ─────────────────────────────────────────────
function leaveOnePairOut(rows: Row[], featureNames: string[], side: "buy" | "sell") {
  const pairs = [...new Set(rows.map(r => r.pair))];
  console.log(`\n${"=".repeat(78)}`);
  console.log(`LEAVE-ONE-PAIR-OUT — ${side.toUpperCase()} (test di pair yang TIDAK PERNAH dilihat model)`);
  console.log("=".repeat(78));

  let allConsistent = true;

  for (const heldOutPair of pairs) {
    const trainRows = rows.filter(r => r.pair !== heldOutPair);
    const testRows = rows.filter(r => r.pair === heldOutPair);
    if (testRows.length < 30) continue;

    const Xtrain = trainRows.map(r => r.features);
    const Xtest = testRows.map(r => r.features);
    const ytrain = trainRows.map(r => (side === "buy" ? r.label_buy : r.label_sell));
    const ytest = testRows.map(r => (side === "buy" ? r.label_buy : r.label_sell));
    const pnlTest = testRows.map(r => (side === "buy" ? r.pnl_buy : r.pnl_sell));

    const { trainS, testS } = standardize(Xtrain, Xtest);
    const { weights, bias } = trainLogReg(trainS, ytrain, EPOCHS, LR, L2_LAMBDA);
    const testProbs = predict(testS, weights, bias);

    const { bottom, top } = summarizeTopBottom(testProbs, pnlTest, ytest);
    const improved = top.avgPnl > bottom.avgPnl && top.pf > bottom.pf;
    if (!improved) allConsistent = false;

    console.log(`\nHeld-out pair: ${heldOutPair} (dilatih dari ${trainRows.length} baris pair lain, test di ${testRows.length} baris pair ini)`);
    console.log(`  Bottom 20% (low prob): ${fmtStat(bottom)}`);
    console.log(`  Top 20%    (high prob): ${fmtStat(top)}`);
    console.log(`  ${improved ? "✅ Top lebih baik dari Bottom" : "❌ Top TIDAK jelas lebih baik di pair ini"}`);
  }

  console.log(`\n${side.toUpperCase()} — Kesimpulan leave-one-pair-out: ${allConsistent ? "✅ KONSISTEN di semua pair — model kemungkinan besar general, cukup aman untuk pair baru" : "⚠️ TIDAK konsisten di semua pair — model mungkin belajar karakteristik pair tertentu, HATI-HATI kalau mau pakai ke pair baru tanpa uji ulang"}`);
}

async function main() {
  const { rows, featureNames } = loadCsv(IN_PATH);
  console.log(`Loaded ${rows.length} baris dari ${[...new Set(rows.map(r => r.pair))].join(", ")}`);

  walkForwardMultiFold(rows, "buy");
  walkForwardMultiFold(rows, "sell");
  leaveOnePairOut(rows, featureNames, "buy");
  leaveOnePairOut(rows, featureNames, "sell");

  console.log(`\n${"=".repeat(78)}`);
  console.log("CATATAN: kedua uji ini pakai split top/bottom 20% (bukan 10 desil) karena");
  console.log("ukuran sample per fold/per-pair lebih kecil — supaya angka tetap stabil.");
  console.log("=".repeat(78));
}

main().catch(console.error);
