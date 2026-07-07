/**
 * backtest-breakout.ts
 *
 * Riset strategi BARU: breakout momentum (BUKAN mean-reversion EMA/RSI yang dipakai sistem utama).
 *
 * Logika breakout BUY:
 *   - Close hari ini > highest high N hari sebelumnya (breakout ke atas)
 *   - Volume hari ini > (volMultiplier x rata-rata volume N hari) -- konfirmasi, opsional
 *
 * Test beberapa kombinasi lookback (10/20/55 hari) x volume filter (ON/OFF) x gaya exit (ketat/longgar)
 *
 * Jalankan:
 *   cd ~/nexus-alpha
 *   npx tsx scripts/src/backtest-breakout.ts
 *
 * Estimasi waktu: 3-5 menit
 */

import { atr } from "../../artifacts/api-server/src/lib/indicators.js";

const PAIRS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "LINKUSDT", "DOGEUSDT"];
const DAILY_BATCHES = 4; // ~10.9 tahun max, kita pakai yang tersedia

interface Candles {
  opens: number[]; highs: number[]; lows: number[];
  closes: number[]; volumes: number[]; times: number[];
}

interface BreakoutResult {
  pair: string;
  lookback: number;
  volFilter: boolean;
  exitStyle: "ketat" | "longgar";
  pnlPct: number;
  win: boolean;
}

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
  daily: Candles, entryIdx: number, atr14: number, exitStyle: "ketat" | "longgar"
): { pnlPct: number; win: boolean; barsHeld: number } {
  const entry = daily.closes[entryIdx];
  const riskAmt = atr14 * 1.5;
  const sl = entry - riskAmt;
  const tpMultiplier = exitStyle === "ketat" ? 1.5 : 4;
  const tp = entry + riskAmt * tpMultiplier;
  const maxBars = exitStyle === "ketat" ? 10 : 20;

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

function printTable(title: string, results: BreakoutResult[]) {
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
    `  Trades: ${results.length} | WinRate: ${wr.toFixed(1)}% | AvgPnL: ${avgPnl.toFixed(2)}% | PF: ${pf.toFixed(2)} | TotalPnL: ${results.reduce((s, r) => s + r.pnlPct, 0).toFixed(2)}%${mark}`
  );
}

async function main() {
  console.log("=".repeat(72));
  console.log("NEXUS ALPHA — RISET BREAKOUT MOMENTUM STRATEGY");
  console.log(`Pairs: ${PAIRS.join(", ")}`);
  console.log("=".repeat(72));

  const allDaily: Record<string, Candles> = {};
  for (const pair of PAIRS) {
    process.stdout.write(`\n[${pair}] Fetching daily... `);
    try {
      allDaily[pair] = await fetchKlinesAll(pair, "1d", DAILY_BATCHES);
      console.log(`${allDaily[pair].closes.length} candles`);
    } catch (err) {
      console.error(`❌ gagal:`, err);
    }
  }

  const lookbacks = [10, 20, 55];
  const volFilters = [false, true];
  const exitStyles: ("ketat" | "longgar")[] = ["ketat", "longgar"];
  const MIN_HISTORY = 60;

  const allResults: BreakoutResult[] = [];

  for (const pair of PAIRS) {
    const daily = allDaily[pair];
    if (!daily || daily.closes.length < MIN_HISTORY + 20) continue;

    for (const lookback of lookbacks) {
      for (const volFilter of volFilters) {
        for (const exitStyle of exitStyles) {
          let i = MIN_HISTORY;
          while (i < daily.closes.length - 20 - 1) {
            const prevHigh = rollingMax(daily.highs, i, lookback);
            const isBreakout = daily.closes[i] > prevHigh;
            if (!isBreakout) { i++; continue; }

            if (volFilter) {
              const avgVol = rollingAvg(daily.volumes, i, lookback);
              if (daily.volumes[i] < avgVol * 1.5) { i++; continue; }
            }

            const atr14 = atr(
              daily.highs.slice(0, i + 1),
              daily.lows.slice(0, i + 1),
              daily.closes.slice(0, i + 1),
              14
            );
            if (!atr14) { i++; continue; }

            const sim = simulateTrade(daily, i, atr14, exitStyle);
            allResults.push({ pair, lookback, volFilter, exitStyle, pnlPct: sim.pnlPct, win: sim.win });
            // Non-overlapping: skip sampai trade ini selesai, baru cari sinyal baru
            i += sim.barsHeld;
          }
        }
      }
    }
  }

  console.log(`\n${"=".repeat(72)}`);
  console.log(`Total breakout signals (semua kombinasi): ${allResults.length}`);
  console.log("=".repeat(72));

  for (const lookback of lookbacks) {
    for (const volFilter of volFilters) {
      for (const exitStyle of exitStyles) {
        const subset = allResults.filter(
          (r) => r.lookback === lookback && r.volFilter === volFilter && r.exitStyle === exitStyle
        );
        const label = `Lookback ${lookback}hari | Volume filter: ${volFilter ? "ON (1.5x)" : "OFF"} | Exit: ${exitStyle}`;
        printTable(label, subset);
      }
    }
  }

  console.log(`\n${"=".repeat(72)}`);
  console.log("SELESAI. Cari baris dengan tanda ✅ (WR≥50% DAN AvgPnL>0) sebagai kandidat.");
  console.log("Kalau SEMUA tanda ❌/⚠️, berarti breakout sederhana ini juga belum terbukti profitable.");
  console.log("=".repeat(72));
}

main().catch(console.error);
