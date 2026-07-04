/**
 * backtest-sweet-spot.ts v2
 *
 * Upgrade dari v1:
 * - Breakdown per pair
 * - BUY vs SELL terpisah
 * - Filter: hanya trade saat bias BUKAN NEUTRAL
 * - Filter: hanya trade saat trend1d jelas (BULLISH atau BEARISH)
 * - Breakdown per bucket + per pair untuk identifikasi masalah
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

const CANDLE_LIMIT = 1000;
const MIN_HISTORY = 200;
const TRADE_MAX_BARS = 10;

interface Candles {
  opens: number[]; highs: number[]; lows: number[];
  closes: number[]; volumes: number[]; times: number[];
}

interface TradeResult {
  pair: string;
  entryIdx: number;
  confidence: number;
  bias: string;
  trend1d: string;
  side: "BUY" | "SELL";
  entry: number;
  pnlPct: number;
  win: boolean;
}

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

function buildInput(
  symbol: string,
  daily: Candles,
  h4: Candles,
  h1: Candles,
  i: number
): RuleBasedSignalInput | null {
  const dc = daily.closes.slice(0, i + 1);
  const dh = daily.highs.slice(0, i + 1);
  const dl = daily.lows.slice(0, i + 1);
  const dv = daily.volumes.slice(0, i + 1);

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

function simulateTrade(
  daily: Candles,
  entryIdx: number,
  side: "BUY" | "SELL",
  atr14: number
): { pnlPct: number; win: boolean } {
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
      if (low <= sl) return { pnlPct: ((sl - entry) / entry) * 100, win: false };
      if (high >= tp) return { pnlPct: ((tp - entry) / entry) * 100, win: true };
    } else {
      if (high >= sl) return { pnlPct: ((entry - sl) / entry) * 100, win: false };
      if (low <= tp) return { pnlPct: ((entry - tp) / entry) * 100, win: true };
    }
  }
  const lastIdx = Math.min(entryIdx + TRADE_MAX_BARS, daily.closes.length - 1);
  const exitPrice = daily.closes[lastIdx];
  const pnlPct = side === "BUY"
    ? ((exitPrice - entry) / entry) * 100
    : ((entry - exitPrice) / entry) * 100;
  return { pnlPct, win: pnlPct > 0 };
}

function getBucket(conf: number): string {
  if (conf < 40) return "00-40";
  if (conf < 45) return "40-45";
  if (conf < 50) return "45-50";
  if (conf < 55) return "50-55";
  if (conf < 60) return "55-60";
  if (conf < 65) return "60-65";
  if (conf < 70) return "65-70";
  if (conf < 75) return "70-75";
  return "75+";
}

function printBucketTable(title: string, results: TradeResult[]) {
  const buckets: Record<string, TradeResult[]> = {};
  for (const r of results) {
    const b = getBucket(r.confidence);
    if (!buckets[b]) buckets[b] = [];
    buckets[b].push(r);
  }

  console.log(`\n${title}`);
  console.log("-".repeat(70));
  console.log(`${"Range".padEnd(8)} ${"Trades".padEnd(8)} ${"WinRate".padEnd(10)} ${"AvgPnL".padEnd(10)} ${"PF".padEnd(8)} ${"TotalPnL"}`);
  console.log("-".repeat(70));

  const sorted = Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b));
  for (const [range, trades] of sorted) {
    const wins = trades.filter(t => t.win).length;
    const wr = (wins / trades.length) * 100;
    const avgPnl = trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length;
    const totalPnl = trades.reduce((s, t) => s + t.pnlPct, 0);
    const gp = trades.filter(t => t.win).reduce((s, t) => s + t.pnlPct, 0);
    const gl = Math.abs(trades.filter(t => !t.win).reduce((s, t) => s + t.pnlPct, 0));
    const pf = gl > 0 ? gp / gl : gp > 0 ? 999 : 0;
    const mark = wr >= 50 && avgPnl > 0 ? " ✅" : wr < 40 || avgPnl < -1 ? " ❌" : " ⚠️";
    console.log(
      `${range.padEnd(8)} ${String(trades.length).padEnd(8)} ${(wr.toFixed(1) + "%").padEnd(10)} ${(avgPnl.toFixed(2) + "%").padEnd(10)} ${pf.toFixed(2).padEnd(8)} ${totalPnl.toFixed(2)}%${mark}`
    );
  }
}

async function main() {
  console.log("=".repeat(70));
  console.log("NEXUS ALPHA — BACKTEST DETAIL v2");
  console.log(`Pairs: ${PAIRS.join(", ")}`);
  console.log("=".repeat(70));

  const allResults: TradeResult[] = [];

  for (const pair of PAIRS) {
    process.stdout.write(`\n[${pair}] Fetching... `);
    await new Promise(r => setTimeout(r, 1000));

    let daily: Candles, h4: Candles, h1: Candles;
    try {
      [daily, h4, h1] = await Promise.all([
        fetchKlines(pair, "1d", CANDLE_LIMIT),
        fetchKlines(pair, "4h", CANDLE_LIMIT),
        fetchKlines(pair, "1", 1000),
      ]);
    } catch (err) {
      console.error(`❌ Fetch gagal:`, err);
      continue;
    }

    console.log(`✅ ${daily.closes.length} daily candles`);

    for (let i = MIN_HISTORY; i < daily.closes.length - TRADE_MAX_BARS - 1; i++) {
      const inp = buildInput(pair, daily, h4, h1, i);
      if (!inp || !inp.atr14) continue;

      const { score, bias } = scoreSwing(inp);
      if (bias === "NEUTRAL") continue; // skip NEUTRAL

      const side: "BUY" | "SELL" = bias === "BULLISH" ? "BUY" : "SELL";
      const sim = simulateTrade(daily, i, side, inp.atr14);

      allResults.push({
        pair,
        entryIdx: i,
        confidence: score.total,
        bias,
        trend1d: inp.trend1d,
        side,
        entry: inp.price,
        ...sim,
      });
    }

    const pairResults = allResults.filter(r => r.pair === pair);
    console.log(`[${pair}] ${pairResults.length} signals (NEUTRAL di-skip)`);
  }

  // ── 1. Semua hasil gabungan ───────────────────────────────────────────────
  console.log("\n" + "=".repeat(70));
  console.log("1. SEMUA PAIR GABUNGAN (NEUTRAL di-skip)");
  console.log("=".repeat(70));
  printBucketTable("Semua signal", allResults);
  printBucketTable("BUY saja", allResults.filter(r => r.side === "BUY"));
  printBucketTable("SELL saja", allResults.filter(r => r.side === "SELL"));

  // ── 2. Filter: hanya saat trend1d jelas ──────────────────────────────────
  const trendClear = allResults.filter(r =>
    (r.side === "BUY" && r.trend1d === "BULLISH") ||
    (r.side === "SELL" && r.trend1d === "BEARISH")
  );
  const trendAgainst = allResults.filter(r =>
    (r.side === "BUY" && r.trend1d === "BEARISH") ||
    (r.side === "SELL" && r.trend1d === "BULLISH")
  );

  console.log("\n" + "=".repeat(70));
  console.log("2. FILTER TREND1D — TRADE SEARAH TREND DAILY");
  console.log("=".repeat(70));
  printBucketTable(`Searah trend (${trendClear.length} trades)`, trendClear);
  printBucketTable(`Melawan trend (${trendAgainst.length} trades)`, trendAgainst);

  // ── 3. Breakdown per pair ─────────────────────────────────────────────────
  console.log("\n" + "=".repeat(70));
  console.log("3. BREAKDOWN PER PAIR (semua bucket digabung)");
  console.log("=".repeat(70));
  console.log(`${"Pair".padEnd(12)} ${"Trades".padEnd(8)} ${"WinRate".padEnd(10)} ${"AvgPnL".padEnd(10)} ${"PF".padEnd(8)} ${"Best Bucket"}`);
  console.log("-".repeat(70));

  for (const pair of PAIRS) {
    const pr = allResults.filter(r => r.pair === pair);
    if (pr.length === 0) continue;
    const wins = pr.filter(r => r.win).length;
    const wr = (wins / pr.length) * 100;
    const avgPnl = pr.reduce((s, r) => s + r.pnlPct, 0) / pr.length;
    const gp = pr.filter(r => r.win).reduce((s, r) => s + r.pnlPct, 0);
    const gl = Math.abs(pr.filter(r => !r.win).reduce((s, r) => s + r.pnlPct, 0));
    const pf = gl > 0 ? gp / gl : gp > 0 ? 999 : 0;

    // cari bucket terbaik per pair
    const buckets: Record<string, TradeResult[]> = {};
    for (const r of pr) {
      const b = getBucket(r.confidence);
      if (!buckets[b]) buckets[b] = [];
      buckets[b].push(r);
    }
    const bestBucket = Object.entries(buckets)
      .filter(([, t]) => t.length >= 3)
      .map(([range, t]) => {
        const w = t.filter(x => x.win).length;
        const ap = t.reduce((s, x) => s + x.pnlPct, 0) / t.length;
        return { range, wr: (w / t.length) * 100, ap, n: t.length };
      })
      .sort((a, b) => b.ap - a.ap)[0];

    const mark = wr >= 50 && avgPnl > 0 ? "✅" : wr < 40 ? "❌" : "⚠️";
    const bestStr = bestBucket
      ? `${bestBucket.range} (WR:${bestBucket.wr.toFixed(0)}% AP:${bestBucket.ap.toFixed(2)}%)`
      : "—";
    console.log(
      `${mark} ${pair.padEnd(10)} ${String(pr.length).padEnd(8)} ${(wr.toFixed(1) + "%").padEnd(10)} ${(avgPnl.toFixed(2) + "%").padEnd(10)} ${pf.toFixed(2).padEnd(8)} ${bestStr}`
    );
  }

  // ── 4. Rekomendasi final ──────────────────────────────────────────────────
  console.log("\n" + "=".repeat(70));
  console.log("4. REKOMENDASI SWEET SPOT BERDASARKAN DATA");
  console.log("=".repeat(70));

  // Cari bucket terbaik dari filter searah trend
  const buckets2: Record<string, TradeResult[]> = {};
  for (const r of trendClear) {
    const b = getBucket(r.confidence);
    if (!buckets2[b]) buckets2[b] = [];
    buckets2[b].push(r);
  }
  const goodBuckets = Object.entries(buckets2)
    .filter(([, t]) => t.length >= 10)
    .map(([range, t]) => {
      const w = t.filter(x => x.win).length;
      const ap = t.reduce((s, x) => s + x.pnlPct, 0) / t.length;
      return { range, wr: (w / t.length) * 100, ap, n: t.length };
    })
    .filter(b => b.wr >= 50 && b.ap > 0)
    .sort((a, b) => b.ap - a.ap);

  if (goodBuckets.length > 0) {
    console.log(`\n✅ Bucket profitable (searah trend, min 10 trades, WR≥50%, AvgPnL>0):`);
    for (const b of goodBuckets) {
      console.log(`   ${b.range}: WinRate ${b.wr.toFixed(1)}%, AvgPnL ${b.ap.toFixed(2)}%, Trades: ${b.n}`);
    }
    const mins = goodBuckets.map(b => parseInt(b.range.split("-")[0]));
    const maxs = goodBuckets.map(b => parseInt(b.range.split("-")[1] ?? b.range.replace("+", "")));
    console.log(`\n✅ Rekomendasi sweet spot: ${Math.min(...mins)} - ${Math.max(...maxs)}`);
  } else {
    console.log(`\n⚠️  Tidak ada bucket profitable dengan filter ketat.`);
    // Tampilkan yang paling mendekati
    const closest = Object.entries(buckets2)
      .filter(([, t]) => t.length >= 5)
      .map(([range, t]) => {
        const w = t.filter(x => x.win).length;
        const ap = t.reduce((s, x) => s + x.pnlPct, 0) / t.length;
        return { range, wr: (w / t.length) * 100, ap, n: t.length };
      })
      .sort((a, b) => b.ap - a.ap)
      .slice(0, 3);
    console.log(`\n   Top 3 bucket terbaik (meski belum ideal):`);
    for (const b of closest) {
      console.log(`   ${b.range}: WinRate ${b.wr.toFixed(1)}%, AvgPnL ${b.ap.toFixed(2)}%, Trades: ${b.n}`);
    }
    console.log(`\n⚠️  Saran: review logic scoring sebelum trading dengan uang asli.`);
  }

  console.log(`\nTotal trade dianalisis: ${allResults.length}`);
  console.log("=".repeat(70));
}

main().catch(console.error);
