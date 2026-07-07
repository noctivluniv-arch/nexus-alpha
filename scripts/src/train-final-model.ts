/**
 * train-final-model.ts
 *
 * Latih model FINAL (38 fitur: 37 asli + rolling_vol_pct) pakai SELURUH
 * dataset (9204 baris), TANPA split train/test - karena validasi (walk-forward
 * 8-fold + leave-one-pair-out) SUDAH selesai di script sebelumnya dan terbukti
 * stabil. Model final ini pakai semua data historis supaya paling update,
 * siap dipakai untuk shadow forward-test.
 *
 * Output: scripts/output/model-buy-final.json, model-sell-final.json
 * Format: { weights, bias, featureNames, mean, std } - mean/std WAJIB disimpan
 * karena standardisasi fitur di live signal harus pakai mean/std yang SAMA
 * persis dengan saat training, bukan dihitung ulang dari data live.
 *
 * Jalankan:
 *   tsx scripts/src/train-final-model.ts
 */

import * as fs from "fs";

const IN_PATH = "scripts/output/ml-dataset.csv";
const ROLLING_WINDOW = 90;
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

function computeMeanStd(data: number[][]): { mean: number[]; std: number[] } {
  const nFeat = data[0].length;
  const mean = new Array(nFeat).fill(0), std = new Array(nFeat).fill(1);
  for (let j = 0; j < nFeat; j++) { let s = 0; for (const row of data) s += row[j]; mean[j] = s / data.length; }
  for (let j = 0; j < nFeat; j++) { let s = 0; for (const row of data) s += (row[j] - mean[j]) ** 2; std[j] = Math.sqrt(s / data.length) || 1; }
  return { mean, std };
}

function standardizeWith(data: number[][], mean: number[], std: number[]): number[][] {
  return data.map(row => row.map((v, j) => (v - mean[j]) / std[j]));
}

function predict(X: number[][], weights: number[], bias: number): number[] {
  return X.map(row => { let z = bias; for (let j = 0; j < weights.length; j++) z += weights[j] * row[j]; return sigmoid(z); });
}

function printDeciles(probs: number[], pnls: number[], wins: number[], label: string) {
  const idx = probs.map((_, i) => i).sort((a, b) => probs[a] - probs[b]);
  const n = idx.length;
  const decileSize = Math.floor(n / 10);
  console.log(`\n${label} — Desil probabilitas (IN-SAMPLE, cuma untuk lihat sebaran, bukan validasi)`);
  console.log(`${"Desil".padEnd(6)} ${"N".padEnd(7)} ${"AvgProb".padEnd(10)} ${"WinRate".padEnd(10)} ${"AvgPnL".padEnd(10)} PF`);
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
    console.log(`D${String(d + 1).padEnd(5)} ${String(sliceIdx.length).padEnd(7)} ${avgProb.toFixed(3).padEnd(10)} ${(wr.toFixed(1) + "%").padEnd(10)} ${(avgPnl.toFixed(2) + "%").padEnd(10)} ${pf.toFixed(2)}`);
  }
}

async function main() {
  const { rows: baseRows, featureNames: baseFeatureNames } = loadCsv(IN_PATH);
  const rows = enrichWithVolatility(baseRows);
  const featureNames = [...baseFeatureNames, "rolling_vol_pct"];

  console.log(`Training model FINAL dengan ${featureNames.length} fitur, ${rows.length} baris (SEMUA data, tanpa split)`);

  for (const side of ["buy", "sell"] as const) {
    const X = rows.map(r => featureNames.map(fn => r.features[fn]));
    const y = rows.map(r => (side === "buy" ? r.label_buy : r.label_sell));
    const pnl = rows.map(r => (side === "buy" ? r.pnl_buy : r.pnl_sell));

    const { mean, std } = computeMeanStd(X);
    const Xstd = standardizeWith(X, mean, std);
    const { weights, bias } = trainLogReg(Xstd, y, EPOCHS, LR, L2_LAMBDA);
    const probs = predict(Xstd, weights, bias);

    printDeciles(probs, pnl, y, side.toUpperCase());

    const model = { weights, bias, featureNames, mean, std, trainedOn: new Date().toISOString(), nRows: rows.length };
    const outPath = `scripts/output/model-${side}-final.json`;
    fs.writeFileSync(outPath, JSON.stringify(model, null, 2));
    console.log(`\n✅ Model ${side.toUpperCase()} final tersimpan di ${outPath}`);
  }

  console.log(`\nPENTING: mean/std di file model WAJIB dipakai persis saat live inference nanti,`);
  console.log(`JANGAN dihitung ulang dari data live - itu akan bikin standardisasi tidak konsisten.`);
}

main().catch(console.error);
