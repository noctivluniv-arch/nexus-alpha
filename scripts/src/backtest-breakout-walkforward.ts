/**
 * backtest-breakout-walkforward.ts
 *
 * Walk-forward validation untuk 2 kandidat breakout yang lolos di backtest awal:
 *   - Lookback 10 hari + Volume filter ON + Exit ketat
 *   - Lookback 20 hari + Volume filter ON + Exit ketat
 *
 * Data dibagi 2 secara KRONOLOGIS (bukan acak):
 *   - Periode 1 (60% pertama, lebih lama)
 *   - Periode 2 (40% terakhir, lebih baru)
 *
 * Kalau edge asli, KEDUA periode harusnya sama-sama positif.
 * Kalau cuma 1 periode positif (dan yang lain negatif), kemungkinan itu overfitting/kebetulan.
 *
 * Jalankan:
 *   npx tsx scripts/src/backtest-breakout-walkforward.ts
 */

import { atr } from "../../artifacts/api-server/src/lib/indicators.js";

const PAIRS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "LINKUSDT", "DOGEUSDT"];
const DAILY_BATCHES = 4;
const SPLIT_RATIO = 0.6; // 60% pertama = periode 1, 40% sisanya = periode 2

interface Candles {
  opens: number[]; highs: number[]; lows: number[];
  closes: number[]; volumes: number[]; times: number[];
}

interface Result { pair: string; period: string; pnlPct: number; win: boolean }

async function fetchKlinesAll(symbol: string, interval: string, maxBatches: number): Promise<Candles> {
  const bybitInterval = interval === "1d" ? "D" : interval;
  const LIMIT = 1000;
  const batches: any[][] = [];
  let endTime: number | undefined = undefined;

  for (let b = 0; b < maxBatches; b++) {
    const params: Record<string, string> = {
      category: "spot", symbol, interval: bybitInterval, limit: String(LIMIT),
    };
    if (endTime !== undefined) params.end = String(endTime);
    const url = `https://api.bybit.com/v5/market/kline?${new URLSearchParams(params)}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const json = (await res.json()) as any;
    if (json.retCode !== 0) break;
    const raw: any[] = [...(json.result?.list ?? [])];
    if (raw.length === 0) break;
    raw.reverse();
    batches.unshift(raw);
    const oldestTs = parseInt(raw[0][0], 10);
    endTime = oldestTs - 1;
    if (raw.length < LIMIT) break;
    await new Promise((r) => setTimeout(r, 400));
  }

  const c: Candles = { opens: [], highs: [], lows: [], closes: [], volumes: [], times: [] };
  for (const batch of batches) {
    for (const k of batch) {
      c.opens.push(parseFloat(k[1]));
      c.highs.push(parseFloat(k[2]));
      c.lows.push(parseFloat(k[3]));
      c.closes.push(parseFloat(k[4]));
      c.volumes.push(parseFloat(k[5]));
      c.times.push(parseInt(k[0], 10));
    }
  }
  return c;
}

function rollingMax(arr: number[], end: number, window: number): number {
  const start = Math.max(0, end - window);
  let max = -Infinity;
  for (let i = start; i < end; i++) if (arr[i] > max) max = arr[i];
  return max;
}

function rollingAvg(arr: number[], end: number, window: number): number {
  const start = Math.max(0, end - window);
  let sum = 0, n = 0;
  for (let i = start; i < end; i++) { sum += arr[i]; n++; }
  return n > 0 ? sum / n : 0;
}

function simulateTrade(
  daily: Candles, entryIdx: number, atr14: number
): { pnlPct: number; win: boolean; barsHeld: number } {
  const entry = daily.closes[entryIdx];
  const riskAmt = atr14 * 1.5;
  const sl = entry - riskAmt;
  const tp = entry + riskAmt * 1.5; // exit "ketat"
  const maxBars = 10;

  for (let b = 1; b <= maxBars; b++) {
    const idx = entryIdx + b;
    if (idx >= daily.closes.length) break;
    const high = daily.highs[idx];
    const low = daily.lows[idx];
    if (low <= sl) return { pnlPct: ((sl - entry) / entry) * 100, win: false, barsHeld: b };
    if (high >= tp) return { pnlPct: ((tp - entry) / entry) * 100, win: true, barsHeld: b };
  }
  const exitIdx = Math.min(entryIdx + maxBars, daily.closes.length - 1);
  const exitPrice = daily.closes[exitIdx];
  const pnlPct = ((exitPrice - entry) / entry) * 100;
  return { pnlPct, win: pnlPct > 0, barsHeld: maxBars };
}

function runOnSlice(pair: string, daily: Candles, lookback: number, periodLabel: string): Result[] {
  const results: Result[] = [];
  const MIN_HISTORY = Math.min(60, Math.floor(daily.closes.length / 4));
  let i = MIN_HISTORY;
  while (i < daily.closes.length - 20 - 1) {
    const prevHigh = rollingMax(daily.highs, i, lookback);
    if (daily.closes[i] <= prevHigh) { i++; continue; }

    const avgVol = rollingAvg(daily.volumes, i, lookback);
    if (daily.volumes[i] < avgVol * 1.5) { i++; continue; }

    const atr14 = atr(
      daily.highs.slice(0, i + 1), daily.lows.slice(0, i + 1), daily.closes.slice(0, i + 1), 14
    );
    if (!atr14) { i++; continue; }

    const sim = simulateTrade(daily, i, atr14);
    results.push({ pair, period: periodLabel, pnlPct: sim.pnlPct, win: sim.win });
    i += sim.barsHeld;
  }
  return results;
}

function printSummary(title: string, results: Result[]) {
  console.log(`\n${title}`);
  console.log("-".repeat(72));
  if (results.length === 0) { console.log("  (tidak ada trade)"); return; }
  const wins = results.filter((r) => r.win).length;
  const wr = (wins / results.length) * 100;
  const avgPnl = results.reduce((s, r) => s + r.pnlPct, 0) / results.length;
  const gp = results.filter((r) => r.win).reduce((s, r) => s + r.pnlPct, 0);
  const gl = Math.abs(results.filter((r) => !r.win).reduce((s, r) => s + r.pnlPct, 0));
  const pf = gl > 0 ? gp / gl : gp > 0 ? 999 : 0;
  const mark = wr >= 50 && avgPnl > 0 ? " ✅" : wr < 40 || avgPnl < -1 ? " ❌" : " ⚠️";
  console.log(
    `  Trades: ${results.length} | WinRate: ${wr.toFixed(1)}% | AvgPnL: ${avgPnl.toFixed(2)}% | PF: ${pf.toFixed(2)}${mark}`
  );
}

async function main() {
  console.log("=".repeat(72));
  console.log("WALK-FORWARD VALIDATION — Breakout Momentum");
  console.log("=".repeat(72));

  const allDaily: Record<string, Candles> = {};
  for (const pair of PAIRS) {
    process.stdout.write(`[${pair}] Fetching... `);
    allDaily[pair] = await fetchKlinesAll(pair, "1d", DAILY_BATCHES);
    console.log(`${allDaily[pair].closes.length} candles`);
  }

  for (const lookback of [10, 20]) {
    console.log(`\n${"=".repeat(72)}`);
    console.log(`KANDIDAT: Lookback ${lookback} hari + Volume filter ON + Exit ketat`);
    console.log("=".repeat(72));

    let period1All: Result[] = [];
    let period2All: Result[] = [];

    for (const pair of PAIRS) {
      const daily = allDaily[pair];
      const splitIdx = Math.floor(daily.closes.length * SPLIT_RATIO);

      const period1: Candles = {
        opens: daily.opens.slice(0, splitIdx), highs: daily.highs.slice(0, splitIdx),
        lows: daily.lows.slice(0, splitIdx), closes: daily.closes.slice(0, splitIdx),
        volumes: daily.volumes.slice(0, splitIdx), times: daily.times.slice(0, splitIdx),
      };
      const period2: Candles = {
        opens: daily.opens.slice(splitIdx), highs: daily.highs.slice(splitIdx),
        lows: daily.lows.slice(splitIdx), closes: daily.closes.slice(splitIdx),
        volumes: daily.volumes.slice(splitIdx), times: daily.times.slice(splitIdx),
      };

      period1All.push(...runOnSlice(pair, period1, lookback, "P1"));
      period2All.push(...runOnSlice(pair, period2, lookback, "P2"));
    }

    const p1Start = new Date(allDaily[PAIRS[0]].times[0]).toISOString().slice(0, 10);
    const splitTime = allDaily[PAIRS[0]].times[Math.floor(allDaily[PAIRS[0]].times.length * SPLIT_RATIO)];
    const p1End = new Date(splitTime).toISOString().slice(0, 10);
    const p2End = new Date(allDaily[PAIRS[0]].times[allDaily[PAIRS[0]].times.length - 1]).toISOString().slice(0, 10);

    printSummary(`Periode 1 (lebih lama, ~${p1Start} s/d ${p1End})`, period1All);
    printSummary(`Periode 2 (lebih baru, ~${p1End} s/d ${p2End})`, period2All);
  }

  console.log(`\n${"=".repeat(72)}`);
  console.log("KESIMPULAN: kalau KEDUA periode ✅ (WR≥50% & AvgPnL>0), edge kemungkinan ASLI.");
  console.log("Kalau cuma 1 periode ✅ dan satunya ❌/⚠️, kemungkinan besar OVERFITTING.");
  console.log("=".repeat(72));
}

main().catch(console.error);
