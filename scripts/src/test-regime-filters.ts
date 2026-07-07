/**
 * test-regime-filters.ts
 *
 * Uji filter regime (trend + volatilitas) untuk BUY dan SELL, berdasarkan
 * riset: Palazzi (2025, J. Futures Markets) - suppress signal saat volatilitas
 * >1.5x rata-rata; QuantMonitor - strategi hanya aktif saat trend + volatilitas
 * mendukung, mati total saat kondisi tidak mendukung.
 *
 * PENTING: volatilitas dihitung RELATIF PER-PAIR (persentil dalam histori
 * pair itu sendiri), bukan angka absolut sama untuk semua pair - karena
 * BTC dan DOGE punya skala volatilitas yang beda jauh.
 *
 * Proxy volatilitas: bb_bandwidth (Bollinger Bandwidth) yang sudah ada di
 * dataset - lebar band relatif terhadap harga, indikator volatilitas umum.
 *
 * CATATAN METODOLOGI: percentile volatilitas di sini dihitung dari SELURUH
 * histori pair (bukan rolling/expanding window) - ini eksploratif, ada
 * sedikit lookahead bias (persentil "tahu" masa depan). Untuk implementasi
 * production nanti HARUS pakai rolling window (misal percentile dari 90 hari
 * terakhir saja). Hasil di sini untuk lihat POLA dulu, bukan angka final.
 *
 * Jalankan:
 *   tsx scripts/src/test-regime-filters.ts
 */

import * as fs from "fs";

const IN_PATH = "scripts/output/ml-dataset.csv";

interface Row {
  pair: string;
  dateMs: number;
  features: Record<string, number>;
  label_buy: number;
  pnl_buy: number;
  label_sell: number;
  pnl_sell: number;
}

function loadCsv(path: string): Row[] {
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
      pair: parts[0],
      dateMs: parseInt(parts[1], 10),
      features,
      label_buy: parseInt(parts[2 + featureNames.length], 10),
      pnl_buy: parseFloat(parts[3 + featureNames.length]),
      label_sell: parseInt(parts[4 + featureNames.length], 10),
      pnl_sell: parseFloat(parts[5 + featureNames.length]),
    });
  }
  return rows;
}

function percentileRank(value: number, sorted: number[]): number {
  let count = 0;
  for (const v of sorted) if (v <= value) count++;
  return count / sorted.length;
}

function stat(rows: Row[], labelKey: "label_buy" | "label_sell", pnlKey: "pnl_buy" | "pnl_sell") {
  if (rows.length === 0) return { n: 0, wr: 0, avgPnl: 0, pf: 0 };
  const wins = rows.filter(r => r[labelKey] === 1).length;
  const wr = (wins / rows.length) * 100;
  const avgPnl = rows.reduce((s, r) => s + r[pnlKey], 0) / rows.length;
  const gp = rows.filter(r => r[labelKey] === 1).reduce((s, r) => s + r[pnlKey], 0);
  const gl = Math.abs(rows.filter(r => r[labelKey] === 0).reduce((s, r) => s + r[pnlKey], 0));
  const pf = gl > 0 ? gp / gl : gp > 0 ? 999 : 0;
  return { n: rows.length, wr, avgPnl, pf };
}

function fmtStat(s: { n: number; wr: number; avgPnl: number; pf: number }): string {
  const mark = s.wr >= 50 && s.avgPnl > 0 ? "✅" : s.wr < 40 || s.avgPnl < -1 ? "❌" : "⚠️";
  return `N=${String(s.n).padEnd(5)} WR=${(s.wr.toFixed(1) + "%").padEnd(8)} AvgPnL=${(s.avgPnl.toFixed(2) + "%").padEnd(9)} PF=${s.pf.toFixed(2).padEnd(6)} ${mark}`;
}

async function main() {
  const rows = loadCsv(IN_PATH);
  const pairs = [...new Set(rows.map(r => r.pair))];

  // Hitung volatility percentile PER PAIR (relatif ke histori pair itu sendiri)
  const volByPair: Record<string, number[]> = {};
  for (const pair of pairs) {
    volByPair[pair] = rows.filter(r => r.pair === pair).map(r => r.features.bb_bandwidth).sort((a, b) => a - b);
  }
  const rowsWithVolPct = rows.map(r => ({
    ...r,
    volPct: percentileRank(r.features.bb_bandwidth, volByPair[r.pair]),
  }));

  console.log("=".repeat(100));
  console.log("UJI 1: TREND1D FILTER SAJA (BUY hanya saat trend1d BULLISH, SELL hanya saat trend1d BEARISH)");
  console.log("=".repeat(100));

  const buyUnfiltered = rows;
  const buyTrendFiltered = rows.filter(r => r.features.trend1d_bull === 1);
  const sellUnfiltered = rows;
  const sellTrendFiltered = rows.filter(r => r.features.trend1d_bull === -1);

  console.log(`\nBUY  — Tanpa filter:      ${fmtStat(stat(buyUnfiltered, "label_buy", "pnl_buy"))}`);
  console.log(`BUY  — trend1d BULLISH:   ${fmtStat(stat(buyTrendFiltered, "label_buy", "pnl_buy"))}`);
  console.log(`\nSELL — Tanpa filter:      ${fmtStat(stat(sellUnfiltered, "label_sell", "pnl_sell"))}`);
  console.log(`SELL — trend1d BEARISH:   ${fmtStat(stat(sellTrendFiltered, "label_sell", "pnl_sell"))}`);

  console.log(`\n${"=".repeat(100)}`);
  console.log("UJI 2: TREND1D + VOLATILITY REGIME (per-pair percentile bb_bandwidth: Low/Mid/High tertile)");
  console.log("=".repeat(100));

  const volBuckets: Array<{ label: string; test: (v: number) => boolean }> = [
    { label: "Low Vol (0-33%)", test: v => v < 0.333 },
    { label: "Mid Vol (33-66%)", test: v => v >= 0.333 && v < 0.667 },
    { label: "High Vol (66-100%)", test: v => v >= 0.667 },
  ];

  console.log("\n--- BUY (trend1d BULLISH + volatility bucket) — GABUNGAN SEMUA PAIR ---");
  for (const vb of volBuckets) {
    const subset = rowsWithVolPct.filter(r => r.features.trend1d_bull === 1 && vb.test(r.volPct));
    console.log(`  ${vb.label.padEnd(20)} ${fmtStat(stat(subset, "label_buy", "pnl_buy"))}`);
  }

  console.log("\n--- SELL (trend1d BEARISH + volatility bucket) — GABUNGAN SEMUA PAIR ---");
  for (const vb of volBuckets) {
    const subset = rowsWithVolPct.filter(r => r.features.trend1d_bull === -1 && vb.test(r.volPct));
    console.log(`  ${vb.label.padEnd(20)} ${fmtStat(stat(subset, "label_sell", "pnl_sell"))}`);
  }

  console.log(`\n${"=".repeat(100)}`);
  console.log("UJI 3: BREAKDOWN PER PAIR (trend1d filter + Low/Mid volatility saja, high vol sering terlalu liar)");
  console.log("=".repeat(100));

  console.log("\n--- BUY per pair (trend1d BULLISH, volatilitas Low+Mid) ---");
  for (const pair of pairs) {
    const subset = rowsWithVolPct.filter(r => r.pair === pair && r.features.trend1d_bull === 1 && r.volPct < 0.667);
    console.log(`  ${pair.padEnd(10)} ${fmtStat(stat(subset, "label_buy", "pnl_buy"))}`);
  }

  console.log("\n--- SELL per pair (trend1d BEARISH, volatilitas Low+Mid) ---");
  for (const pair of pairs) {
    const subset = rowsWithVolPct.filter(r => r.pair === pair && r.features.trend1d_bull === -1 && r.volPct < 0.667);
    console.log(`  ${pair.padEnd(10)} ${fmtStat(stat(subset, "label_sell", "pnl_sell"))}`);
  }

  console.log(`\n${"=".repeat(100)}`);
  console.log("CATATAN: hasil UJI 2 & 3 pakai percentile volatilitas FULL-HISTORY per pair (ada lookahead");
  console.log("bias ringan, untuk eksplorasi pola dulu). Kalau ada pola jelas & konsisten, langkah");
  console.log("berikutnya adalah ulangi dengan ROLLING percentile (window 90 hari) sebelum masuk ke model.");
  console.log("=".repeat(100));
}

main().catch(console.error);
