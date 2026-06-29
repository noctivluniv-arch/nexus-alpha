/**
 * backtest-sweet-spot.ts
 *
 * Tujuan: cari sweet spot confidence yang optimal berdasarkan data historis nyata.
 * - Fetch 300 candle daily + 4H dari Bybit per pair
 * - Walk-forward: simulasi signal di setiap candle
 * - Simulasi trade: entry di close candle signal, TP = ATR*2.25, SL = ATR*1.5
 * - Kelompokkan hasil per confidence bucket (40-45, 45-50, dst)
 * - Output: win rate, avg return, profit factor per bucket
 */

import {
  ema, rsi, macd, bollinger, atr, swingLevels, trendStructure,
  volumeProfile, stochastic, detectRsiDivergence,
  bosLevel, vwap, ichimoku, waveTrend, pivotPoints,
} from "../../artifacts/api-server/src/lib/indicators.js";
import { scoreSwing, type RuleBasedSignalInput } from "../../artifacts/api-server/src/lib/rule-based-engine.js";

const PAIRS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT",
  "XRPUSDT", "DOGEUSDT", "AVAXUSDT", "LINKUSDT",
];

const CANDLE_LIMIT = 1000; // ambil lebih banyak untuk walk-forward
const MIN_HISTORY = 200;  // butuh minimal 200 candle untuk indikator stabil
const TRADE_MAX_BARS = 10; // max candle untuk tunggu TP/SL

interface Candles {
  opens: number[]; highs: number[]; lows: number[];
  closes: number[]; volumes: number[]; times: number[];
}

interface TradeResult {
  pair: string;
  entryIdx: number;
  confidence: number;
  bias: string;
  side: "BUY" | "SELL";
  entry: number;
  sl: number;
  tp: number;
  exitPrice: number;
  exitBar: number;
  pnlPct: number;
  win: boolean;
}

// ── Fetch dari Bybit ──────────────────────────────────────────────────────────
async function fetchKlines(symbol: string, interval: string, limit: number): Promise<Candles> {
  const bybitInterval = interval === "1d" ? "D" : interval === "4h" ? "240" : interval;
  const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${bybitInterval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bybit error ${res.status} for ${symbol} ${interval}`);
  const json = await res.json() as any;
  if (json.retCode !== 0) throw new Error(`Bybit API error: ${json.retMsg}`);

  const raw: any[] = json.result?.list ?? [];
  raw.reverse();

  const c: Candles = { opens: [], highs: [], lows: [], closes: [], volumes: [], times: [] };
  for (const k of raw) {
    c.opens.push(parseFloat(k[1]));
    c.highs.push(parseFloat(k[2]));
    c.lows.push(parseFloat(k[3]));
    c.closes.push(parseFloat(k[4]));
    c.volumes.push(parseFloat(k[5]));
    c.times.push(parseInt(k[0], 10));
  }
  return c;
}

// ── Hitung indikator dari slice data ─────────────────────────────────────────
function buildInput(
  symbol: string,
  daily: Candles,
  h4: Candles,
  h1: Candles,
  i: number // index candle saat ini di daily
): RuleBasedSignalInput | null {
  // Slice data sampai candle ke-i (tidak boleh pakai data masa depan)
  const dc = daily.closes.slice(0, i + 1);
  const dh = daily.highs.slice(0, i + 1);
  const dl = daily.lows.slice(0, i + 1);
  const dv = daily.volumes.slice(0, i + 1);

  // Estimasi index h4 yang sesuai dengan daily ke-i (1 daily = ~6 bar 4H)
  const h4EndIdx = Math.min(Math.floor((i + 1) * 6), h4.closes.length);
  const h4c = h4.closes.slice(0, h4EndIdx);
  const h4h = h4.highs.slice(0, h4EndIdx);
  const h4l = h4.lows.slice(0, h4EndIdx);
  const h1EndIdx = Math.min((i + 1) * 24, h1.volumes.length);
  const h1vols = h1.volumes.slice(0, h1EndIdx);
  const volH1 = h1vols.length > 0 ? h1vols[h1vols.length - 1] : 0;
  const volH6 = h1vols.length >= 6 ? h1vols.slice(-6).reduce((a, b) => a + b, 0) : 0;

  if (dc.length < 50 || h4c.length < 50) return null;

  const price = dc[dc.length - 1];

  try {
    const ema20Val = ema(dc, Math.min(20, dc.length - 1));
    const ema50Val = ema(dc, Math.min(50, dc.length - 1));
    const ema200Val = ema(dc, Math.min(200, dc.length - 1));
    const rsi1dVal = rsi(dc, 14);
    const rsi4hVal = rsi(h4c, 14);
    const rsiDiv = detectRsiDivergence(dc, 20);
    const macd4hVal = macd(h4c);
    const bbVal = bollinger(dc, 20, 2);
    const stoch4hVal = stochastic(h4h, h4l, h4c);
    const ema50_4h = ema(h4c, Math.min(50, h4c.length - 1));
    const ema200_4h = ema(h4c, Math.min(200, h4c.length - 1));
    const trend4hVal = trendStructure(ema50_4h, ema200_4h, h4c[h4c.length - 1]);
    const bos = bosLevel(h4h, h4l, h4c, 20);
    const swing7d = swingLevels(h4h, h4l, 42);
    const swing30d = swingLevels(dh, dl, 30);
    const swing90d = swingLevels(dh, dl, 90);
    const vwapVal = vwap(dh, dl, dc, dv);
    const ichimokuVal = ichimoku(dh, dl, dc);
    const waveTrendVal = waveTrend(h4h, h4l, h4c);
    const prevH = dh[dh.length - 2] ?? dh[dh.length - 1];
    const prevL = dl[dl.length - 2] ?? dl[dl.length - 1];
    const prevC = dc[dc.length - 2] ?? dc[dc.length - 1];
    const pivotsVal = pivotPoints(prevH, prevL, prevC);
    const atr14Val = atr(dh, dl, dc, 14);
    const vp = volumeProfile(dv.slice(-30));
    const high24h = dh[dh.length - 1];
    const low24h = dl[dl.length - 1];
    const change24h = (((price - prevC) / prevC) * 100).toFixed(2);

    // Hitung trend1d dari EMA50 vs EMA200 daily
    const trend1dVal = trendStructure(ema50Val, ema200Val, price);

    return {
      pair: symbol, price,
      ema20: ema20Val, ema50: ema50Val, ema200: ema200Val,
      rsi1h: null, rsi4h: rsi4hVal, rsi1d: rsi1dVal, rsi1w: null,
      rsiDivergence: rsiDiv,
      macd4h: macd4hVal, macd1d: macd(dc),
      bb: bbVal,
      stoch4h: stoch4hVal, stoch1h: null,
      volAvg30: vp.avg, volRecent: vp.recent, volH1, volH6,
      trend4h: trend4hVal, trend1d: trend1dVal,
      bos,
      sup1: swing7d.support, sup2: swing30d.support, sup3: swing90d.support,
      res1: swing7d.resistance, res2: swing30d.resistance, res3: swing90d.resistance,
      ichimoku: ichimokuVal, waveTrend: waveTrendVal, vwap: vwapVal, pivots: pivotsVal,
      fundingRate: null, lsRatio: null, oiUsd: null,
      fgi: null, btcDom: null,
      atr14: atr14Val,
      change24h, high24h, low24h,
    };
  } catch {
    return null;
  }
}

// ── Simulasi satu trade ───────────────────────────────────────────────────────
function simulateTrade(
  daily: Candles,
  entryIdx: number,
  side: "BUY" | "SELL",
  atr14: number
): { exitPrice: number; exitBar: number; pnlPct: number; win: boolean } {
  const entry = daily.closes[entryIdx];
  const riskAmt = atr14 * 1.5;
  const sl = side === "BUY" ? entry - riskAmt : entry + riskAmt;
  const tp = side === "BUY" ? entry + riskAmt * 1.5 : entry - riskAmt * 1.5;

  for (let b = 1; b <= TRADE_MAX_BARS; b++) {
    const idx = entryIdx + b;
    if (idx >= daily.closes.length) break;

    const high = daily.highs[idx];
    const low = daily.lows[idx];

    if (side === "BUY") {
      if (low <= sl) return { exitPrice: sl, exitBar: b, pnlPct: ((sl - entry) / entry) * 100, win: false };
      if (high >= tp) return { exitPrice: tp, exitBar: b, pnlPct: ((tp - entry) / entry) * 100, win: true };
    } else {
      if (high >= sl) return { exitPrice: sl, exitBar: b, pnlPct: ((entry - sl) / entry) * 100, win: false };
      if (low <= tp) return { exitPrice: tp, exitBar: b, pnlPct: ((entry - tp) / entry) * 100, win: true };
    }
  }

  // Timeout — close di candle terakhir
  const lastIdx = Math.min(entryIdx + TRADE_MAX_BARS, daily.closes.length - 1);
  const exitPrice = daily.closes[lastIdx];
  const pnlPct = side === "BUY"
    ? ((exitPrice - entry) / entry) * 100
    : ((entry - exitPrice) / entry) * 100;
  return { exitPrice, exitBar: TRADE_MAX_BARS, pnlPct, win: pnlPct > 0 };
}

// ── Analisis per bucket ───────────────────────────────────────────────────────
interface BucketStats {
  range: string;
  trades: number;
  wins: number;
  winRate: number;
  avgPnl: number;
  profitFactor: number;
  totalPnl: number;
}

function analyzeBuckets(results: TradeResult[]): BucketStats[] {
  const buckets: Record<string, TradeResult[]> = {};

  const getBucket = (conf: number): string => {
    if (conf < 40) return "00-40";
    if (conf < 45) return "40-45";
    if (conf < 50) return "45-50";
    if (conf < 55) return "50-55";
    if (conf < 60) return "55-60";
    if (conf < 65) return "60-65";
    if (conf < 70) return "65-70";
    if (conf < 75) return "70-75";
    return "75-100";
  };

  for (const r of results) {
    const b = getBucket(r.confidence);
    if (!buckets[b]) buckets[b] = [];
    buckets[b].push(r);
  }

  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([range, trades]) => {
      const wins = trades.filter(t => t.win).length;
      const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
      const avgPnl = trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length;
      const totalPnl = trades.reduce((s, t) => s + t.pnlPct, 0);
      const grossProfit = trades.filter(t => t.win).reduce((s, t) => s + t.pnlPct, 0);
      const grossLoss = Math.abs(trades.filter(t => !t.win).reduce((s, t) => s + t.pnlPct, 0));
      const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;
      return { range, trades: trades.length, wins, winRate, avgPnl, profitFactor, totalPnl };
    });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(60));
  console.log("NEXUS ALPHA — BACKTEST SWEET SPOT FINDER");
  console.log(`Pairs: ${PAIRS.join(", ")}`);
  console.log(`Candles per pair: ${CANDLE_LIMIT} daily + ${CANDLE_LIMIT} 4H`);
  console.log("=".repeat(60));

  const allResults: TradeResult[] = [];

  for (const pair of PAIRS) {
    console.log(`\n[${pair}] Fetching data...`);
    await new Promise(r => setTimeout(r, 1000)); // rate limit

    let daily: Candles, h4: Candles, h1: Candles;
    try {
      [daily, h4, h1] = await Promise.all([
        fetchKlines(pair, "1d", CANDLE_LIMIT),
        fetchKlines(pair, "4h", CANDLE_LIMIT),
        fetchKlines(pair, "1", 1000),
      ]);
    } catch (err) {
      console.error(`[${pair}] ❌ Fetch gagal:`, err);
      continue;
    }

    console.log(`[${pair}] ✅ ${daily.closes.length} daily, ${h4.closes.length} 4H candles`);

    let signals = 0;
    const pairResults: TradeResult[] = [];

    for (let i = MIN_HISTORY; i < daily.closes.length - TRADE_MAX_BARS - 1; i++) {
      const inp = buildInput(pair, daily, h4, h1, i);
      if (!inp || !inp.atr14) continue;

      const { score, bias } = scoreSwing(inp);
      const conf = score.total;

      // Test SEMUA range confidence (bukan hanya sweet spot) untuk analisis komprehensif
      let side: "BUY" | "SELL" | null = null;
      if (bias === "BULLISH") side = "BUY";
      else if (bias === "BEARISH") side = "SELL";
      if (!side) continue;

      const sim = simulateTrade(daily, i, side, inp.atr14);
      pairResults.push({
        pair, entryIdx: i, confidence: conf, bias,
        side, entry: inp.price,
        sl: side === "BUY" ? inp.price - inp.atr14 * 1.5 : inp.price + inp.atr14 * 1.5,
        tp: side === "BUY" ? inp.price + inp.atr14 * 2.25 : inp.price - inp.atr14 * 2.25,
        ...sim,
      });
      signals++;
    }

    console.log(`[${pair}] ${signals} signals disimulasikan`);
    allResults.push(...pairResults);
  }

  // ── Output per pair ─────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("HASIL PER CONFIDENCE BUCKET (semua pair digabung)");
  console.log("=".repeat(60));

  const buckets = analyzeBuckets(allResults);
  console.log(`\n${"Range".padEnd(8)} ${"Trades".padEnd(8)} ${"WinRate".padEnd(10)} ${"AvgPnL".padEnd(10)} ${"ProfitFactor".padEnd(14)} ${"TotalPnL"}`);
  console.log("-".repeat(65));

  for (const b of buckets) {
    const wr = `${b.winRate.toFixed(1)}%`;
    const ap = `${b.avgPnl.toFixed(2)}%`;
    const pf = b.profitFactor === 999 ? "∞" : b.profitFactor.toFixed(2);
    const tp = `${b.totalPnl.toFixed(2)}%`;
    const mark = b.winRate >= 50 && b.avgPnl > 0 ? " ✅" : b.winRate < 40 ? " ❌" : " ⚠️";
    console.log(`${b.range.padEnd(8)} ${String(b.trades).padEnd(8)} ${wr.padEnd(10)} ${ap.padEnd(10)} ${pf.padEnd(14)} ${tp}${mark}`);
  }

  // ── Rekomendasi sweet spot ───────────────────────────────────────────────
  const goodBuckets = buckets.filter(b => b.trades >= 5 && b.winRate >= 50 && b.avgPnl > 0);
  console.log("\n" + "=".repeat(60));
  console.log("REKOMENDASI SWEET SPOT");
  console.log("=".repeat(60));

  if (goodBuckets.length === 0) {
    console.log("⚠️  Tidak ada bucket dengan win rate >= 50% dan avgPnL positif.");
    console.log("   Perlu review logic scoring atau tambah data.");
  } else {
    const ranges = goodBuckets.map(b => b.range);
    const minVal = Math.min(...goodBuckets.map(b => parseInt(b.range.split("-")[0])));
    const maxVal = Math.max(...goodBuckets.map(b => parseInt(b.range.split("-")[1])));
    console.log(`✅ Bucket profitable: ${ranges.join(", ")}`);
    console.log(`✅ Rekomendasi sweet spot: ${minVal} - ${maxVal}`);
    console.log(`   (berdasarkan ${goodBuckets.reduce((s, b) => s + b.trades, 0)} trade historis)`);
  }

  console.log("\n" + "=".repeat(60));
  console.log(`Total trade disimulasikan: ${allResults.length}`);
  console.log("=".repeat(60));
}

main().catch(console.error);
