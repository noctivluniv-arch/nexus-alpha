/**
 * breakout-signal-engine.ts
 *
 * Engine untuk SHADOW forward-test breakout momentum BUY (BELUM menggantikan
 * signal-engine-realtime.ts atau ml-signal-engine.ts yang sudah live).
 * Formula identik persis dengan scripts/src/backtest-breakout-walkforward.ts
 * (kandidat "Lookback 10 hari + Volume filter ON + Exit ketat", walk-forward
 * PROVEN: PF 1.45 (2021-2024) / PF 1.29 (2024-2026), kedua periode profitable).
 *
 * Logika (BUY only, breakout momentum — BUKAN mean-reversion):
 * - Entry: close hari ini > highest-high 10 hari SEBELUMNYA (breakout)
 * - Filter: volume hari ini >= 1.5x rata-rata volume 10 hari sebelumnya
 * - SL: entry - (ATR14 x 1.5)
 * - TP: entry + (ATR14 x 1.5 x 1.5) — single target "exit ketat", RR 1:1.5
 * - Max hold 10 hari (dicek via cron forward-test terpisah)
 */

import { atr } from "./indicators";

const LOOKBACK = 10;
const VOL_MULTIPLIER = 1.5;
const SL_ATR_MULT = 1.5;
const TP_RR_MULT = 1.5; // TP = entry + riskAmt * 1.5 (riskAmt = ATR14 * SL_ATR_MULT)

interface Candles {
  opens: number[]; highs: number[]; lows: number[];
  closes: number[]; volumes: number[]; closeTime: number[];
}

async function fetchDailyKlines(symbol: string, limit = 120): Promise<Candles> {
  const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=D&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bybit klines error ${res.status} for ${symbol}`);
  const json = (await res.json()) as any;
  if (json.retCode !== 0) throw new Error(`Bybit klines API error: ${json.retMsg} for ${symbol}`);
  const raw: any[] = json.result?.list ?? [];
  raw.reverse();
  const c: Candles = { opens: [], highs: [], lows: [], closes: [], volumes: [], closeTime: [] };
  for (const k of raw) {
    c.opens.push(parseFloat(k[1]));
    c.highs.push(parseFloat(k[2]));
    c.lows.push(parseFloat(k[3]));
    c.closes.push(parseFloat(k[4]));
    c.volumes.push(parseFloat(k[5]));
    c.closeTime.push(parseInt(k[0], 10));
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

export interface BreakoutSignalResult {
  pair: string;
  price: number;
  side: "BUY" | "NO_TRADE";
  sl: number | null;
  tp: number | null;
  atr14: number | null;
  prevHigh: number | null;
  volRatio: number | null;
}

export async function computeBreakoutSignal(symbol: string): Promise<BreakoutSignalResult> {
  const daily = await fetchDailyKlines(symbol, 120);
  const n = daily.closes.length;

  if (n < LOOKBACK + 20) {
    return { pair: symbol, price: daily.closes[n - 1] ?? 0, side: "NO_TRADE", sl: null, tp: null, atr14: null, prevHigh: null, volRatio: null };
  }

  const todayIdx = n - 1;
  const price = daily.closes[todayIdx];

  const prevHigh = rollingMax(daily.highs, todayIdx, LOOKBACK);
  const prevAvgVol = rollingAvg(daily.volumes, todayIdx, LOOKBACK);
  const todayVol = daily.volumes[todayIdx];
  const volRatio = prevAvgVol > 0 ? todayVol / prevAvgVol : 0;

  const atr14Val = atr(daily.highs, daily.lows, daily.closes, 14);

  const isBreakout = price > prevHigh;
  const passesVolumeFilter = todayVol >= prevAvgVol * VOL_MULTIPLIER;

  let side: "BUY" | "NO_TRADE" = "NO_TRADE";
  let sl: number | null = null;
  let tp: number | null = null;

  if (isBreakout && passesVolumeFilter && atr14Val && atr14Val > 0) {
    side = "BUY";
    const riskAmt = atr14Val * SL_ATR_MULT;
    sl = price - riskAmt;
    tp = price + riskAmt * TP_RR_MULT;
  }

  return {
    pair: symbol,
    price,
    side,
    sl,
    tp,
    atr14: atr14Val,
    prevHigh,
    volRatio,
  };
}
