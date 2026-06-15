/**
 * Backtest Rule-Based Engine — Multi-pair, Multi-horizon, Train/Test Split, Cost Model
 *
 * LIMITATIONS (Phase 2 update):
 * - fundingRate: REAL historis dari Binance Futures (fapi fundingRate endpoint).
 * - fgi: REAL historis dari alternative.me (full history).
 * - lsRatio, btcDom: masih null (tidak ada API historis gratis yang mudah;
 *   impact maksimal ke score cuma ~5-7/100, sebagian besar baseline tetap terisi).
 * - rsi1h, stoch1h, volH1/H6 = null/0 (scalp engine tidak dites).
 * - Forward return = close-to-close.
 * - COST MODEL adalah ASUMSI, bukan data funding rate historis real:
 *     - Round-trip fee: 0.10% (taker entry + exit, Binance futures ~0.04-0.05% per sisi)
 *     - Funding cost: 0.03%/hari (asumsi rata-rata, magnitude only, arah diabaikan)
 *   Net return = gross directional return - fee - (funding_per_day * horizon)
 *
 * TRAIN = candle dengan closeTime < CUTOFF
 * TEST  = candle dengan closeTime >= CUTOFF (out-of-sample, belum "dilihat" saat analisa awal)
 *
 * Usage: npx tsx scripts/backtest-rule-engine.ts
 */

import {
  ema, rsi, macd, bollinger, atr, swingLevels, trendStructure,
  volumeProfile, stochastic, detectRsiDivergence,
  bosLevel, vwap, ichimoku, waveTrend, pivotPoints,
} from "../src/lib/indicators";
import { scoreSwing } from "../src/lib/rule-based-engine";

const ROUND_TRIP_FEE = 0.001;     // 0.10%
const FUNDING_PER_DAY = 0.0003;   // 0.03%/hari
const CUTOFF_DATE = "2025-09-01"; // train < cutoff, test >= cutoff

interface Candles {
  opens: number[]; highs: number[]; lows: number[];
  closes: number[]; volumes: number[]; closeTime: number[];
}

async function fetchKlines(symbol: string, interval: string, totalWanted = 1000): Promise<Candles> {
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
    await new Promise((r) => setTimeout(r, 250));
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

async function fetchFgiHistory(): Promise<Map<string, { value: number; label: string }>> {
  const map = new Map<string, { value: number; label: string }>();
  const res = await fetch("https://api.alternative.me/fng/?limit=0&format=json");
  const j: any = await res.json();
  for (const d of j.data ?? []) {
    const date = new Date(parseInt(d.timestamp, 10) * 1000).toISOString().slice(0, 10);
    map.set(date, { value: parseInt(d.value, 10), label: d.value_classification });
  }
  return map;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

interface Sample {
  pair: string;
  date: string;
  score: number;
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  fwdReturns: Record<number, number>;
  atrPct: number; // ATR14 / price at signal time
}

async function backtestPair(symbol: string, horizons: number[], fgiHistory: Map<string, { value: number; label: string }>): Promise<Sample[]> {
  const daily = await fetchKlines(symbol, "1d", 730);
  const h4 = await fetchKlines(symbol, "4h", 730 * 6);
  const fundingHistory = await fetchFundingHistory(symbol);
  let fundingPtr = 0;
  const maxHorizon = Math.max(...horizons);

  const samples: Sample[] = [];
  const minDailyIdx = 200;

  for (let i = minDailyIdx; i < daily.closes.length - maxHorizon; i++) {
    const dCloses = daily.closes.slice(0, i + 1);
    const dHighs = daily.highs.slice(0, i + 1);
    const dLows = daily.lows.slice(0, i + 1);
    const dVols = daily.volumes.slice(0, i + 1);
    const dCloseTime = daily.closeTime[i];

    let h4End = h4.closeTime.findIndex((t) => t > dCloseTime);
    if (h4End === -1) h4End = h4.closeTime.length;
    if (h4End < 60) continue;

    const h4c = h4.closes.slice(0, h4End);
    const h4h = h4.highs.slice(0, h4End);
    const h4l = h4.lows.slice(0, h4End);

    const price = dCloses[dCloses.length - 1];

    const ema20Val = ema(dCloses, Math.min(20, dCloses.length - 1));
    const ema50Val = ema(dCloses, Math.min(50, dCloses.length - 1));
    const ema200Val = ema(dCloses, Math.min(200, dCloses.length - 1));
    const rsi1dVal = rsi(dCloses, 14);
    const rsi4hVal = rsi(h4c, 14);
    const rsiDiv = detectRsiDivergence(dCloses, 20);
    const macd4hVal = macd(h4c);
    const bbVal = bollinger(dCloses, 20, 2);
    const stoch4hVal = stochastic(h4h, h4l, h4c);

    const ema50_4h = ema(h4c, Math.min(50, h4c.length - 1));
    const ema200_4h = ema(h4c, Math.min(200, h4c.length - 1));
    const trend4hVal = trendStructure(ema50_4h, ema200_4h, h4c[h4c.length - 1]);

    const bos = bosLevel(h4h, h4l, h4c, 20);

    const swing7d = swingLevels(h4h, h4l, 42);
    const swing30d = swingLevels(dHighs, dLows, 30);
    const swing90d = swingLevels(dHighs, dLows, 90);

    const vwapVal = vwap(dHighs, dLows, dCloses, dVols);
    const ichimokuVal = ichimoku(dHighs, dLows, dCloses);
    const waveTrendVal = waveTrend(h4h, h4l, h4c);

    const prevH = dHighs[dHighs.length - 2] ?? dHighs[dHighs.length - 1];
    const prevL = dLows[dLows.length - 2] ?? dLows[dLows.length - 1];
    const prevC = dCloses[dCloses.length - 2] ?? dCloses[dCloses.length - 1];
    const pivots = pivotPoints(prevH, prevL, prevC);

    const atr14Val = atr(dHighs, dLows, dCloses, 14);
    const vp = volumeProfile(dVols.slice(-30));

    // Funding rate: ambil entry terakhir yang fundingTime <= dCloseTime
    while (fundingPtr + 1 < fundingHistory.length && fundingHistory[fundingPtr + 1].time <= dCloseTime) {
      fundingPtr++;
    }
    const fundingRateVal = fundingHistory.length > 0 && fundingHistory[fundingPtr].time <= dCloseTime
      ? fundingHistory[fundingPtr].rate
      : null;

    const dateKey = new Date(dCloseTime).toISOString().slice(0, 10);
    const fgiVal = fgiHistory.get(dateKey) ?? null;

    const input: any = {
      pair: symbol, price,
      ema20: ema20Val, ema50: ema50Val, ema200: ema200Val,
      rsi1h: null, rsi4h: rsi4hVal, rsi1d: rsi1dVal, rsi1w: null,
      rsiDivergence: rsiDiv,
      macd4h: macd4hVal, macd1d: macd(dCloses),
      bb: bbVal,
      stoch4h: stoch4hVal, stoch1h: null,
      volAvg30: vp.avg, volRecent: vp.recent, volH1: 0, volH6: 0,
      trend4h: trend4hVal, trend1d: trend4hVal,
      bos,
      sup1: swing7d.support, sup2: swing30d.support, sup3: swing90d.support,
      res1: swing7d.resistance, res2: swing30d.resistance, res3: swing90d.resistance,
      ichimoku: ichimokuVal, waveTrend: waveTrendVal, vwap: vwapVal, pivots,
      fundingRate: fundingRateVal, lsRatio: null, oiUsd: null,
      fgi: fgiVal, btcDom: null,
      atr14: atr14Val,
      change24h: "0",
      high24h: dHighs[dHighs.length - 1],
      low24h: dLows[dLows.length - 1],
    };

    let scored;
    try {
      scored = scoreSwing(input);
    } catch (e) {
      continue;
    }

    const fwdReturns: Record<number, number> = {};
    for (const h of horizons) {
      const fwdPrice = daily.closes[i + h];
      fwdReturns[h] = (fwdPrice - price) / price;
    }

    const atrPct = (atr14Val ?? price * 0.02) / price;

    samples.push({
      pair: symbol,
      date: new Date(dCloseTime).toISOString().slice(0, 10),
      score: scored.score.total,
      bias: scored.bias,
      fwdReturns,
      atrPct,
    });
  }

  return samples;
}

const buckets = [
  { label: "< 40", min: 0, max: 40 },
  { label: "40-45", min: 40, max: 45 },
  { label: "45-50", min: 45, max: 50 },
  { label: "50-55", min: 50, max: 55 },
  { label: "55-60", min: 55, max: 60 },
  { label: "60-65", min: 60, max: 65 },
  { label: "65+", min: 65, max: 1000 },
];

function printBucketTable(samples: Sample[], horizon: number, label: string) {
  console.log(`\n--- ${label} | Horizon ${horizon}d (n=${samples.length}) ---`);
  console.log("score_bucket | n     | win_rate | gross_avg | net_avg  | avg_abs(all)");
  const fundingCost = FUNDING_PER_DAY * horizon;
  for (const b of buckets) {
    const inBucket = samples.filter((s) => s.score >= b.min && s.score < b.max && s.bias !== "NEUTRAL");
    const allInBucket = samples.filter((s) => s.score >= b.min && s.score < b.max);
    if (inBucket.length === 0) {
      console.log(`${b.label.padEnd(13)} | ${String(allInBucket.length).padEnd(5)} | -        | -         | -        | -`);
      continue;
    }
    const directional = inBucket.map((s) => (s.bias === "BULLISH" ? s.fwdReturns[horizon] : -s.fwdReturns[horizon]));
    const wins = directional.filter((d) => d > 0).length;
    const winRate = wins / directional.length;
    const avgGross = directional.reduce((a, b2) => a + b2, 0) / directional.length;
    const avgNet = avgGross - ROUND_TRIP_FEE - fundingCost;
    const avgAbs = allInBucket.reduce((a, s) => a + Math.abs(s.fwdReturns[horizon]), 0) / allInBucket.length;

    console.log(
      `${b.label.padEnd(13)} | ${String(allInBucket.length).padEnd(5)} | ${fmtPct(winRate).padEnd(8)} | ${fmtPct(avgGross).padEnd(9)} | ${fmtPct(avgNet).padEnd(8)} | ${fmtPct(avgAbs)}`
    );
  }
}

async function main() {
  const pairs = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT"];
  const horizons = [3, 5, 10];

  console.log("Fetching Fear & Greed Index history (shared across pairs)...");
  const fgiHistory = await fetchFgiHistory();
  console.log(`  -> ${fgiHistory.size} days of FGI data\n`);

  let allSamples: Sample[] = [];
  for (const pair of pairs) {
    console.log(`Fetching & scoring ${pair}...`);
    const samples = await backtestPair(pair, horizons, fgiHistory);
    console.log(`  -> ${samples.length} samples (${samples[0]?.date} -> ${samples[samples.length-1]?.date})`);
    allSamples = allSamples.concat(samples);
  }

  const train = allSamples.filter((s) => s.date < CUTOFF_DATE);
  const test = allSamples.filter((s) => s.date >= CUTOFF_DATE);

  console.log(`\n\n========== TRAIN/TEST SPLIT ==========`);
  console.log(`CUTOFF: ${CUTOFF_DATE}`);
  console.log(`TRAIN: n=${train.length} (sebelum cutoff — ini yang "dilihat" di analisa awal)`);
  console.log(`TEST:  n=${test.length} (sesudah cutoff — OUT-OF-SAMPLE, belum pernah dilihat)`);
  console.log(`\nCost model: round-trip fee ${fmtPct(ROUND_TRIP_FEE)}, funding ${fmtPct(FUNDING_PER_DAY)}/hari`);

  for (const h of horizons) {
    console.log(`\n\n############ HORIZON ${h} HARI ############`);
    printBucketTable(train, h, "TRAIN");
    printBucketTable(test, h, "TEST (out-of-sample)");
  }


// ── EQUITY CURVE SIMULATION ─────────────────────────────────────────────────
// Asumsi:
// - Horizon 5 hari, non-overlapping (posisi ditutup sebelum buka posisi baru)
// - Trade hanya jika score in [45,55) dan bias != NEUTRAL (zona "sweet spot")
// - Net return per trade sudah termasuk fee + funding (lihat printBucketTable)
// - Leverage diterapkan linear ke return; jika leveraged loss <= -100% -> LIQUIDATED,
//   equity jadi $0 dan berhenti trading untuk pair itu (realistic margin call).
// - Real exchange punya maintenance margin yang trigger SEBELUM -100% — jadi ini
//   skenario BEST CASE untuk leverage tinggi, bukan worst case.
function simulateEquity(samples: Sample[], horizon: number, leverage: number, startCapital = 1000) {
  let equity = startCapital;
  let peak = startCapital;
  let maxDD = 0;
  let nTrades = 0;
  let liquidatedAt: number | null = null;
  let nextIdx = 0;
  const fundingCost = FUNDING_PER_DAY * horizon;

  for (let i = 0; i < samples.length; i++) {
    if (i < nextIdx) continue;
    const s = samples[i];
    if (s.score < 45 || s.score >= 55 || s.bias === "NEUTRAL") continue;

    const gross = s.bias === "BULLISH" ? s.fwdReturns[horizon] : -s.fwdReturns[horizon];
    const net = gross - ROUND_TRIP_FEE - fundingCost;
    const leveraged = net * leverage;

    nTrades++;
    if (leveraged <= -1) {
      equity = 0;
      liquidatedAt = nTrades;
      break;
    }
    equity *= (1 + leveraged);
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, (peak - equity) / peak);

    nextIdx = i + horizon;
  }

  return { finalEquity: equity, nTrades, maxDD, liquidatedAt };
}

console.log(`\n\n========== EQUITY SIMULATION (modal awal $1000, horizon 5d, zona 45-55) ==========`);
console.log(`Asumsi: non-overlapping, leverage linear, liquidation jika loss per-trade <= -100%/leverage.\n`);

const leverages = [5, 10, 20, 50];
for (const pair of pairs) {
  const pairSamples = allSamples.filter((s) => s.pair === pair);
  console.log(`${pair} (n_candidate=${pairSamples.length}):`);
  console.log("  leverage | final_equity | n_trades | max_drawdown | liquidated_at_trade#");
  for (const lev of leverages) {
    const r = simulateEquity(pairSamples, 5, lev);
    const eqStr = r.finalEquity >= 1 ? `${r.finalEquity.toFixed(2)}` : `${r.finalEquity.toFixed(6)}`;
    console.log(`  ${String(lev).padEnd(8)} | ${eqStr.padEnd(12)} | ${String(r.nTrades).padEnd(8)} | ${fmtPct(r.maxDD).padEnd(12)} | ${r.liquidatedAt ?? "no"}`);
  }
  console.log();
}


// ── RISK-BASED POSITION SIZING SIMULATION ───────────────────────────────────
// - risk_pct: berapa % modal yang dipertaruhkan per trade
// - stop_pct: jarak stop-loss = stop_mult * ATR14/price (saat sinyal)
// - position_value = (equity * risk_pct) / stop_pct, leverage hasil = position_value/equity
//   (di-cap maxLeverage; kalau stop sangat ketat & leverage tercap, risk aktual < risk_pct)
// - APPROXIMATION: kalau net_directional <= -stop_pct, loss di-cap = -risk_pct*equity
//   (asumsi stop-loss kena tepat). Profit tidak di-cap (run to horizon close).
function simulateRiskBased(samples: Sample[], horizon: number, riskPct: number, stopMult: number, maxLeverage: number, startCapital = 1000) {
  let equity = startCapital;
  let peak = startCapital;
  let maxDD = 0;
  let nTrades = 0;
  let nStopped = 0;
  let liquidatedAt: number | null = null;
  let nextIdx = 0;
  const fundingCost = FUNDING_PER_DAY * horizon;

  for (let i = 0; i < samples.length; i++) {
    if (i < nextIdx) continue;
    const s = samples[i];
    if (s.score < 45 || s.score >= 55 || s.bias === "NEUTRAL") continue;

    const gross = s.bias === "BULLISH" ? s.fwdReturns[horizon] : -s.fwdReturns[horizon];
    const net = gross - ROUND_TRIP_FEE - fundingCost;
    const stopPct = Math.max(s.atrPct * stopMult, 0.001); // avoid div by ~0

    let impliedLeverage = riskPct / stopPct;
    impliedLeverage = Math.min(impliedLeverage, maxLeverage);
    const effectiveRiskPct = impliedLeverage * stopPct; // actual risk if leverage capped

    nTrades++;
    let equityChangePct: number;
    if (net <= -stopPct) {
      equityChangePct = -effectiveRiskPct;
      nStopped++;
    } else {
      equityChangePct = net * impliedLeverage;
    }

    if (equityChangePct <= -1) {
      equity = 0;
      liquidatedAt = nTrades;
      break;
    }
    equity *= (1 + equityChangePct);
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, (peak - equity) / peak);

    nextIdx = i + horizon;
  }

  return { finalEquity: equity, nTrades, nStopped, maxDD, liquidatedAt };
}

console.log(`\n\n========== RISK-BASED SIZING SIMULATION (modal awal $1000, horizon 5d, zona 45-55) ==========`);
console.log(`stop = 1.5x ATR14 (saat sinyal), max leverage cap = 10x\n`);

for (const riskPct of [0.01, 0.02]) {
  console.log(`--- Risk per trade: ${fmtPct(riskPct)} dari modal ---`);
  console.log("pair    | final_equity | n_trades | n_stopped | max_drawdown | liquidated_at#");
  for (const pair of pairs) {
    const pairSamples = allSamples.filter((s) => s.pair === pair);
    const r = simulateRiskBased(pairSamples, 5, riskPct, 1.5, 10);
    const eqStr = r.finalEquity >= 1 ? `${r.finalEquity.toFixed(2)}` : `${r.finalEquity.toFixed(6)}`;
    console.log(`${pair.padEnd(7)} | ${eqStr.padEnd(12)} | ${String(r.nTrades).padEnd(8)} | ${String(r.nStopped).padEnd(9)} | ${fmtPct(r.maxDD).padEnd(12)} | ${r.liquidatedAt ?? "no"}`);
  }
  console.log();
}

  console.log(`\n\nCara baca: Bandingkan TRAIN vs TEST untuk bucket 45-50 dan 45-55.`);
  console.log(`Kalau pola "edge positif" di TRAIN HILANG atau BERUBAH ARAH di TEST,`);
  console.log(`berarti pola itu cuma kebetulan/overfitting periode 2024, BUKAN edge nyata.`);
  console.log(`Kalau net_avg (setelah fee+funding) masih positif konsisten di TEST,`);
  console.log(`itu baru sinyal yang lebih bisa dipercaya.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
