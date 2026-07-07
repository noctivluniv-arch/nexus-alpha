/**
 * check-feature-correlation.ts
 *
 * Cek MURAH sebelum retrain: apakah fitur volatilitas rolling (kandidat baru)
 * kemungkinan cuma menduplikasi informasi yang sudah ada di 37 fitur lama,
 * atau benar-benar membawa informasi baru.
 *
 * Tidak fetch API, tidak training model - cuma olah data dari CSV yang sudah
 * ada. Cepat.
 *
 * Fitur kandidat: rolling percentile bb_bandwidth (90 hari trailing per pair,
 * TANPA lookahead - percentile hari ke-i cuma pakai data sampai hari ke-i).
 *
 * Jalankan:
 *   tsx scripts/src/check-feature-correlation.ts
 */

import * as fs from "fs";

const IN_PATH = "scripts/output/ml-dataset.csv";
const ROLLING_WINDOW = 90;

interface Row {
  pair: string;
  dateMs: number;
  features: Record<string, number>;
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
    rows.push({ pair: parts[0], dateMs: parseInt(parts[1], 10), features });
  }
  return { rows, featureNames };
}

function pearsonCorr(x: number[], y: number[]): number {
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

function rollingPercentile(values: number[], window: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window);
    const windowVals = values.slice(start, i); // TIDAK termasuk hari ini sendiri -> no lookahead
    if (windowVals.length < 10) { result.push(NaN); continue; }
    const sorted = [...windowVals].sort((a, b) => a - b);
    let count = 0;
    for (const v of sorted) if (v <= values[i]) count++;
    result.push(count / sorted.length);
  }
  return result;
}

async function main() {
  const { rows, featureNames } = loadCsv(IN_PATH);
  const pairs = [...new Set(rows.map(r => r.pair))];

  // Hitung rolling percentile per pair, gabung kembali
  const rollingVolPctByPair: Record<string, number[]> = {};
  for (const pair of pairs) {
    const pairRows = rows.filter(r => r.pair === pair).sort((a, b) => a.dateMs - b.dateMs);
    const bbVals = pairRows.map(r => r.features.bb_bandwidth);
    rollingVolPctByPair[pair] = rollingPercentile(bbVals, ROLLING_WINDOW);
  }

  // Rebuild aligned array: rolling_vol_pct sejajar dengan `rows` asli (perlu re-sort per pair lagi)
  const enrichedRows: Array<Row & { rolling_vol_pct: number }> = [];
  for (const pair of pairs) {
    const pairRows = rows.filter(r => r.pair === pair).sort((a, b) => a.dateMs - b.dateMs);
    const rp = rollingVolPctByPair[pair];
    pairRows.forEach((r, idx) => {
      enrichedRows.push({ ...r, rolling_vol_pct: rp[idx] });
    });
  }

  const validRows = enrichedRows.filter(r => !isNaN(r.rolling_vol_pct));
  console.log(`Total baris: ${enrichedRows.length}, valid (setelah warm-up ${ROLLING_WINDOW} hari): ${validRows.length}`);
  console.log(`Baris hilang karena warm-up rolling window: ${enrichedRows.length - validRows.length} (${(((enrichedRows.length - validRows.length) / enrichedRows.length) * 100).toFixed(1)}%)`);

  console.log(`\n${"=".repeat(80)}`);
  console.log("KORELASI rolling_vol_pct (fitur kandidat baru) terhadap 37 fitur yang sudah ada");
  console.log("=".repeat(80));
  console.log(`${"Fitur".padEnd(25)} ${"Korelasi".padEnd(12)} Interpretasi`);
  console.log("-".repeat(80));

  const rollingVolArr = validRows.map(r => r.rolling_vol_pct);
  const correlations: Array<{ name: string; corr: number }> = [];

  for (const fn of featureNames) {
    const featArr = validRows.map(r => r.features[fn]);
    const corr = pearsonCorr(rollingVolArr, featArr);
    correlations.push({ name: fn, corr });
  }

  correlations.sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr));

  for (const c of correlations) {
    const absCorr = Math.abs(c.corr);
    const interp = absCorr >= 0.7 ? "❌ SANGAT MIRIP - kemungkinan redundant"
      : absCorr >= 0.4 ? "⚠️ Cukup mirip - ada overlap"
      : absCorr >= 0.15 ? "✅ Overlap ringan - masih ada info baru"
      : "✅ Hampir tidak berkorelasi - info baru";
    console.log(`${c.name.padEnd(25)} ${c.corr.toFixed(3).padEnd(12)} ${interp}`);
  }

  const maxAbsCorr = Math.max(...correlations.map(c => Math.abs(c.corr)));
  console.log(`\n${"=".repeat(80)}`);
  console.log(`Korelasi absolut TERTINGGI dengan fitur manapun: ${maxAbsCorr.toFixed(3)}`);
  if (maxAbsCorr >= 0.7) {
    console.log("KESIMPULAN: fitur rolling_vol_pct kemungkinan besar REDUNDANT dengan fitur yang sudah");
    console.log("ada. Menambahkannya ke model kemungkinan TIDAK akan banyak membantu.");
  } else if (maxAbsCorr >= 0.4) {
    console.log("KESIMPULAN: ada overlap sedang, tapi fitur ini masih membawa informasi yang cukup");
    console.log("berbeda dari yang sudah ada. Cukup masuk akal untuk dicoba ditambahkan ke model.");
  } else {
    console.log("KESIMPULAN: fitur ini membawa informasi yang LARGELY BARU, tidak tertangkap oleh");
    console.log("37 fitur lama. Layak dicoba ditambahkan ke model - potensi memperbaiki BUY.");
  }
  console.log("=".repeat(80));
}

main().catch(console.error);
