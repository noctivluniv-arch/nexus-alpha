/**
 * Backtest Scalp Engine (scoreScalp)
 *
 * scoreScalp butuh konfluensi >=4 dari 8 kondisi (RSI 1H, RSI 4H, MACD 4H,
 * Stoch 1H, WaveTrend 4H, near S/R, VWAP, funding) untuk trigger LONG/SHORT.
 *
 * LIMITATIONS:
 * - fundingRate: real historis dari Binance Futures (sama seperti backtest swing).
 * - lsRatio, btcDom: null.
 * - Forward return = close-to-close pada candle 1H, horizon dalam JAM.
 * - SL/TP belum disimulasikan presisi (path-dependent) — fase ini fokus ke
 *   "apakah arah (LONG/SHORT) yang dipilih scoreScalp benar", bukan PnL exact.
 *
 * Usage: npx tsx scripts/backtest-scalp-engine.ts
 */

import {
  ema, rsi, macd, bollinger, atr, swingLevels, trendStructure,
  volumeProfile, stochastic, detectRsiDivergence,
  bosLevel, vwap, ichimoku, waveTrend, pivotPoints,
} from "../src/lib/indicators";

// Re-export scoreScalp by importing the module and calling generateRuleBasedSignal,
// then reading scalpSide/scalpEntry/scalpSL/scalpTP from its output (scoreScalp
// itself isn't exported, but generateRuleBasedSignal exposes its results).
import { generateRuleBasedSignal } from "../src/lib/rule-based-engine";

const ROUND_TRIP_FEE = 0.001;

interface Candles {
  opens: number[]; highs: number[]; lows: number[];
  closes: number[]; volumes: number[]; closeTime: number[];
}

async function fetchKlines(symbol: string, interval: string, totalWanted: number): Promise<Candles> {
  const c: Candles = { opens: [], highs: [], lows: [], closes: [], volumes: [], closeTime: [] };
  let endTime: number | undefined = undefined;

  while (c.closes.length < totalWanted) {
    const remaining = totalWanted - c.closes.length;
    const batchLimit = Math.min(1000, remaining);
    let url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${batchLimit}`;
    if (endTime !== undefined) url += `&endTime=${endTime}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance API error ${res.status} for ${symbol} ${interval}`);
    const raw: any[] = await res.json();
    if (raw.length === 0) break;

    const batch: Candles = { opens: [], highs: [], lows: [], closes: [], volumes: [], closeTime: [] };
    for (const k of raw) {
      batch.opens.push(parseFloat(k[1]));
      batch.highs.push(parseFloat(k[2]));
      batch.lows.push(parseFloat(k[3]));
      batch.closes.push(parseFloat(k[4]));
      batch.volumes.push(parseFloat(k[5]));
      batch.closeTime.push(k[6]);
    }

    c.opens = [...batch.opens, ...c.opens];
    c.highs = [...batch.highs, ...c.highs];
    c.lows = [...batch.lows, ...c.lows];
    c.closes = [...batch.closes, ...c.closes];
    c.volumes = [...batch.volumes, ...c.volumes];
    c.closeTime = [...batch.closeTime, ...c.closeTime];

    if (raw.length < batchLimit) break;
    endTime = raw[0][0] - 1;
    await new Promise((r) => setTimeout(r, 200));
  }
  return c;
}

async function fetchFundingHistory(symbol: string, totalWanted = 2200): Promise<{ time: number; rate: number }[]> {
  const out: { time: number; rate: number }[] = [];
  let startTime: number | undefined = undefined;
  while (out.length < totalWanted) {
    let url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1000`;
    if (startTime !== undefined) url += `&startTime=${startTime}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const raw: any[] = await res.json();
    if (raw.length === 0) break;
    for (const r of raw) out.push({ time: r.fundingTime, rate: parseFloat(r.fundingRate) });
    if (raw.length < 1000) break;
    startTime = raw[raw.length - 1].fundingTime + 1;
    await new Promise((r) => setTimeout(r, 200));
  }
  return out;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(3)}%`;
}

interface ScalpSample {
  pair: string;
  timeKey: number;
  side: "LONG" | "SHORT" | "NO_SCALP";
  fwdReturns: Record<number, number>; // horizon (hours) -> return
}

async function backtestScalpPair(symbol: string, horizonsH: number[]): Promise<ScalpSample[]> {
  // 1H candles: 1000 max per request, fetch ~6000 (~250 days)
  const h1 = await fetchKlines(symbol, "1h", 4000);
  // 4H candles derived from same period: fetch separately for indicator alignment
  const h4 = await fetchKlines(symbol, "4h", 1000);
  // Daily for EMA200/swing levels context
  const daily = await fetchKlines(symbol, "1d", 400);
  const fundingHistory = await fetchFundingHistory(symbol);

  const maxHorizon = Math.max(...horizonsH);
  const samples: ScalpSample[] = [];
  const minH1Idx = 250; // warmup for stoch/rsi/etc

  let fundingPtr = 0;

  for (let i = minH1Idx; i < h1.closes.length - maxHorizon; i++) {
    const h1CloseTime = h1.closeTime[i];

    // Slice 4H up to this point in time
    let h4End = h4.closeTime.findIndex((t) => t > h1CloseTime);
    if (h4End === -1) h4End = h4.closeTime.length;
    if (h4End < 60) continue;

    // Slice daily up to this point
    let dEnd = daily.closeTime.findIndex((t) => t > h1CloseTime);
    if (dEnd === -1) dEnd = daily.closeTime.length;
    if (dEnd < 60) continue;

    const h1c = h1.closes.slice(0, i + 1);
    const h1h = h1.highs.slice(0, i + 1);
    const h1l = h1.lows.slice(0, i + 1);
    const h1v = h1.volumes.slice(0, i + 1);

    const h4c = h4.closes.slice(0, h4End);
    const h4h = h4.highs.slice(0, h4End);
    const h4l = h4.lows.slice(0, h4End);

    const dC = daily.closes.slice(0, dEnd);
    const dH = daily.highs.slice(0, dEnd);
    const dL = daily.lows.slice(0, dEnd);
    const dV = daily.volumes.slice(0, dEnd);

    const price = h1c[h1c.length - 1];

    // Daily-based indicators
    const ema20Val = ema(dC, Math.min(20, dC.length - 1));
    const ema50Val = ema(dC, Math.min(50, dC.length - 1));
    const ema200Val = ema(dC, Math.min(200, dC.length - 1));
    const rsi1dVal = rsi(dC, 14);
    const rsiDiv = detectRsiDivergence(dC, 20);
    const bbVal = bollinger(dC, 20, 2);

    // 4H-based
    const rsi4hVal = rsi(h4c, 14);
    const macd4hVal = macd(h4c);
    const stoch4hVal = stochastic(h4h, h4l, h4c);
    const ema50_4h = ema(h4c, Math.min(50, h4c.length - 1));
    const ema200_4h = ema(h4c, Math.min(200, h4c.length - 1));
    const trend4hVal = trendStructure(ema50_4h, ema200_4h, h4c[h4c.length - 1]);
    const bos = bosLevel(h4h, h4l, h4c, 20);
    const waveTrendVal = waveTrend(h4h, h4l, h4c);

    // 1H-based
    const rsi1hVal = rsi(h1c, 14);
    const stoch1hVal = stochastic(h1h, h1l, h1c);

    // Swing levels
    const swing7d = swingLevels(h4h, h4l, 42);
    const swing30d = swingLevels(dH, dL, 30);
    const swing90d = swingLevels(dH, dL, 90);

    const vwapVal = vwap(dH, dL, dC, dV);
    const ichimokuVal = ichimoku(dH, dL, dC);

    const prevH = dH[dH.length - 2] ?? dH[dH.length - 1];
    const prevL = dL[dL.length - 2] ?? dL[dL.length - 1];
    const prevC = dC[dC.length - 2] ?? dC[dC.length - 1];
    const pivots = pivotPoints(prevH, prevL, prevC);

    const atr14Val = atr(dH, dL, dC, 14);
    const vp = volumeProfile(dV.slice(-31, -1)); // exclude in-progress, consistent with prod fix

    // Funding rate at this point in time
    while (fundingPtr + 1 < fundingHistory.length && fundingHistory[fundingPtr + 1].time <= h1CloseTime) {
      fundingPtr++;
    }
    const fundingRateVal = fundingHistory.length > 0 && fundingHistory[fundingPtr].time <= h1CloseTime
      ? fundingHistory[fundingPtr].rate
      : null;

    const input: any = {
      pair: symbol, price,
      ema20: ema20Val, ema50: ema50Val, ema200: ema200Val,
      rsi1h: rsi1hVal, rsi4h: rsi4hVal, rsi1d: rsi1dVal, rsi1w: null,
      rsiDivergence: rsiDiv,
      macd4h: macd4hVal, macd1d: macd(dC),
      bb: bbVal,
      stoch4h: stoch4hVal, stoch1h: stoch1hVal,
      volAvg30: vp.avg, volRecent: vp.recent,
      volH1: h1v.slice(-1)[0] ?? 0,
      volH6: h1v.slice(-6).reduce((a, b) => a + b, 0) ?? 0,
      trend4h: trend4hVal, trend1d: trend4hVal,
      bos,
      sup1: swing7d.support, sup2: swing30d.support, sup3: swing90d.support,
      res1: swing7d.resistance, res2: swing30d.resistance, res3: swing90d.resistance,
      ichimoku: ichimokuVal, waveTrend: waveTrendVal, vwap: vwapVal, pivots,
      fundingRate: fundingRateVal, lsRatio: null, oiUsd: null,
      fgi: null, btcDom: null,
      atr14: atr14Val,
      change24h: "0",
      high24h: dH[dH.length - 1],
      low24h: dL[dL.length - 1],
    };

    let out;
    try {
      out = generateRuleBasedSignal(input);
    } catch (e) {
      continue;
    }

    if (out.scalpSide === "NO_SCALP") continue;

    const fwdReturns: Record<number, number> = {};
    for (const h of horizonsH) {
      const fwdPrice = h1.closes[i + h];
      fwdReturns[h] = (fwdPrice - price) / price;
    }

    samples.push({
      pair: symbol,
      timeKey: h1CloseTime,
      side: out.scalpSide,
      fwdReturns,
    });
  }

  return samples;
}

async function main() {
  const pairs = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT"];
  const horizonsH = [1, 4, 8, 24]; // 1h, 4h, 8h, 1 day

  let allSamples: ScalpSample[] = [];
  for (const pair of pairs) {
    console.log(`Fetching & scoring ${pair} (1H scalp engine)...`);
    const samples = await backtestScalpPair(pair, horizonsH);
    console.log(`  -> ${samples.length} scalp signals (LONG=${samples.filter(s=>s.side==="LONG").length}, SHORT=${samples.filter(s=>s.side==="SHORT").length})`);
    allSamples = allSamples.concat(samples);
  }

  console.log(`\n\n========== SCALP ENGINE RESULTS — total n=${allSamples.length} ==========`);
  console.log(`(non-overlapping NOT enforced here — semua signal candidate dihitung independen,`);
  console.log(` representasi "kalau setiap sinyal di-trade sendiri-sendiri")\n`);

  for (const h of horizonsH) {
    console.log(`--- Horizon ${h}h ---`);
    console.log("pair    | side  | n     | win_rate | gross_avg | net_avg");
    for (const pair of pairs) {
      for (const side of ["LONG", "SHORT"] as const) {
        const subset = allSamples.filter((s) => s.pair === pair && s.side === side);
        if (subset.length === 0) {
          console.log(`${pair.padEnd(7)} | ${side.padEnd(5)} | ${String(0).padEnd(5)} | -        | -         | -`);
          continue;
        }
        const directional = subset.map((s) => (side === "LONG" ? s.fwdReturns[h] : -s.fwdReturns[h]));
        const wins = directional.filter((d) => d > 0).length;
        const winRate = wins / directional.length;
        const avgGross = directional.reduce((a, b) => a + b, 0) / directional.length;
        const avgNet = avgGross - ROUND_TRIP_FEE; // funding negligible for <1day holds
        console.log(`${pair.padEnd(7)} | ${side.padEnd(5)} | ${String(subset.length).padEnd(5)} | ${fmtPct(winRate).padEnd(8)} | ${fmtPct(avgGross).padEnd(9)} | ${fmtPct(avgNet)}`);
      }
    }
    console.log();
  }

  // Combined LONG vs SHORT overall
  console.log(`--- COMBINED (semua pair) ---`);
  for (const h of horizonsH) {
    console.log(`Horizon ${h}h:`);
    for (const side of ["LONG", "SHORT"] as const) {
      const subset = allSamples.filter((s) => s.side === side);
      if (subset.length === 0) { console.log(`  ${side}: n=0`); continue; }
      const directional = subset.map((s) => (side === "LONG" ? s.fwdReturns[h] : -s.fwdReturns[h]));
      const wins = directional.filter((d) => d > 0).length;
      const winRate = wins / directional.length;
      const avgGross = directional.reduce((a, b) => a + b, 0) / directional.length;
      const avgNet = avgGross - ROUND_TRIP_FEE;
      console.log(`  ${side}: n=${subset.length} | win_rate=${fmtPct(winRate)} | gross=${fmtPct(avgGross)} | net=${fmtPct(avgNet)}`);
    }
  }

  console.log(`\nCara baca: net_avg > 0 dan win_rate > 50% secara konsisten di beberapa`);
  console.log(`horizon -> scalp engine punya edge kasar. Kalau net_avg negatif atau`);
  console.log(`win_rate ~50% (coin-flip) -> "4 dari 8 kondisi" BUKAN threshold yang berarti,`);
  console.log(`perlu rethink (misal naikkan minimal jadi 5-6/8, atau ganti kombinasi kondisi).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
