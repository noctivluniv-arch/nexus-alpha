/**
 * backtest-v3-paginated.ts
 *
 * Upgrade dari v2:
 * - fetchKlinesAll(): paginated fetch (multi-batch, masing-masing 1000 candle)
 *   → Daily: up to 4000 candles (~10.9 tahun)
 *   → 4H:    up to 5000 candles (~2.3 tahun), time-aligned pakai timestamp
 * - volH1/volH6 diapproximasi dari daily volume → menghilangkan masalah
 *   misalignment yang ada di v2 (1H data cuma 41 hari terakhir, tidak aligned)
 * - trend1d FIXED: pakai daily EMA (bukan 4H EMA seperti di v2 dan engine lama)
 * - XRPUSDT + AVAXUSDT di-remove (v2: AvgPnL -1.71% dan -1.42%)
 * - Seksi "VALIDASI SWEET SPOT BARU" mengecek apakah BUY 50-55 / SELL 0-45
 *   yang sudah di-set di engine benar-benar profitable di dataset yang lebih besar
 *
 * Jalankan:
 *   cd ~/nexus-alpha
 *   tsx scripts/src/backtest-v3-paginated.ts
 *
 * Estimasi waktu: 3-5 menit (banyak API call, ada delay rate limit)
 */

import {
  ema, rsi, macd, bollinger, atr, swingLevels, trendStructure,
  volumeProfile, stochastic, detectRsiDivergence,
  bosLevel, vwap, ichimoku, waveTrend, pivotPoints,
} from "../../artifacts/api-server/src/lib/indicators.js";
import { scoreSwing, type RuleBasedSignalInput } from "../../artifacts/api-server/src/lib/rule-based-engine.js";

// XRPUSDT dan AVAXUSDT di-remove berdasarkan backtest v2
const PAIRS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT",
  "LINKUSDT", "DOGEUSDT",
];

const MIN_HISTORY    = 200;
const TRADE_MAX_BARS = 10;
const DAILY_BATCHES  = 4;  // max 4000 daily candles ≈ 10.9 tahun
const H4_BATCHES     = 5;  // max 5000 4H candles ≈ 2.3 tahun

interface Candles {
  opens: number[]; highs: number[]; lows: number[];
  closes: number[]; volumes: number[]; times: number[];
}

interface TradeResult {
  pair: string;
  confidence: number;
  side: "BUY" | "SELL";
  trend1d: string;
  pnlPct: number;
  win: boolean;
}

// ─── Paginated fetch ────────────────────────────────────────────────────────
// Bybit returns newest-first. Kita paginate ke belakang menggunakan `end` param.
// Setiap batch di-reverse ke oldest-first, lalu di-prepend ke array batches.
// Hasil akhir: candles dalam urutan chronologis (oldest first).
async function fetchKlinesAll(
  symbol: string,
  interval: string,
  maxBatches: number
): Promise<Candles> {
  const bybitInterval = interval === "1d" ? "D" : interval === "4h" ? "240" : interval;
  const LIMIT = 1000;
  const batches: any[][] = [];
  let endTime: number | undefined = undefined;

  for (let b = 0; b < maxBatches; b++) {
    const params: Record<string, string> = {
      category: "spot",
      symbol,
      interval: bybitInterval,
      limit: String(LIMIT),
    };
    if (endTime !== undefined) params.end = String(endTime);

    const url = `https://api.bybit.com/v5/market/kline?${new URLSearchParams(params)}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const json = (await res.json()) as any;
    if (json.retCode !== 0) break;

    const raw: any[] = [...(json.result?.list ?? [])];
    if (raw.length === 0) break;

    raw.reverse();               // oldest first
    batches.unshift(raw);        // prepend → batches tetap chronologis

    const oldestTs = parseInt(raw[0][0], 10);
    endTime = oldestTs - 1;      // set ceiling untuk batch berikutnya

    if (raw.length < LIMIT) break; // tidak ada data lebih lama lagi
    await new Promise(r => setTimeout(r, 400)); // rate limit
  }

  // Merge semua batch (semua sudah oldest-first)
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

// ─── Build input ────────────────────────────────────────────────────────────
function buildInput(
  symbol: string,
  daily: Candles,
  h4: Candles,
  i: number
): RuleBasedSignalInput | null {
  const dc = daily.closes.slice(0, i + 1);
  const dh = daily.highs.slice(0, i + 1);
  const dl = daily.lows.slice(0, i + 1);
  const dv = daily.volumes.slice(0, i + 1);

  // Time-aligned 4H: ambil semua 4H candle sampai (tapi tidak melebihi) open daily[i]
  const dailyOpenTs = daily.times[i];
  let h4EndIdx = h4.times.findIndex(t => t > dailyOpenTs);
  if (h4EndIdx === -1) h4EndIdx = h4.closes.length;

  const h4c = h4.closes.slice(0, h4EndIdx);
  const h4h = h4.highs.slice(0, h4EndIdx);
  const h4l = h4.lows.slice(0, h4EndIdx);

  if (dc.length < 50 || h4c.length < 50) return null;

  const price = dc[dc.length - 1];

  // Approximate volH1/volH6 dari daily volume.
  // Jauh lebih akurat daripada mengambil 1H data yang tidak time-aligned (masalah di v2).
  const todayVol = dv[dv.length - 1];
  const volH1    = todayVol / 24;
  const volH6    = todayVol / 4;

  try {
    const ema20Val   = ema(dc, Math.min(20, dc.length - 1));
    const ema50Val   = ema(dc, Math.min(50, dc.length - 1));
    const ema200Val  = ema(dc, Math.min(200, dc.length - 1));
    const rsi1dVal   = rsi(dc, 14);
    const rsi4hVal   = rsi(h4c, 14);
    const rsiDiv     = detectRsiDivergence(dc, 20);
    const macd4hVal  = macd(h4c);
    const bbVal      = bollinger(dc, 20, 2);
    const stoch4hVal = stochastic(h4h, h4l, h4c);
    const ema50_4h   = ema(h4c, Math.min(50, h4c.length - 1));
    const ema200_4h  = ema(h4c, Math.min(200, h4c.length - 1));
    const trend4hVal = trendStructure(ema50_4h, ema200_4h, h4c[h4c.length - 1]);
    const trend1dVal = trendStructure(ema50Val, ema200Val, price); // FIXED: daily EMA
    const bos        = bosLevel(h4h, h4l, h4c, 20);
    const swing7d    = swingLevels(h4h, h4l, 42);
    const swing30d   = swingLevels(dh, dl, 30);
    const swing90d   = swingLevels(dh, dl, 90);
    const vwapVal    = vwap(dh, dl, dc, dv);
    const ichimokuVal   = ichimoku(dh, dl, dc);
    const waveTrendVal  = waveTrend(h4h, h4l, h4c);
    const prevH  = dh[dh.length - 2] ?? dh[dh.length - 1];
    const prevL  = dl[dl.length - 2] ?? dl[dl.length - 1];
    const prevC  = dc[dc.length - 2] ?? dc[dc.length - 1];
    const pivotsVal = pivotPoints(prevH, prevL, prevC);
    const atr14Val  = atr(dh, dl, dc, 14);
    const vp        = volumeProfile(dv.slice(-30));
    const high24h   = dh[dh.length - 1];
    const low24h    = dl[dl.length - 1];
    const change24h = (((price - prevC) / prevC) * 100).toFixed(2);

    return {
      pair: symbol, price,
      ema20: ema20Val, ema50: ema50Val, ema200: ema200Val,
      rsi1h: null, rsi4h: rsi4hVal, rsi1d: rsi1dVal, rsi1w: null,
      rsiDivergence: rsiDiv,
      macd4h: macd4hVal, macd1d: macd(dc),
      bb: bbVal,
      stoch4h: stoch4hVal, stoch1h: null,
      volAvg30: vp.avg, volRecent: vp.recent, volH1, volH6,
      trend4h: trend4hVal, trend1d: trend1dVal, // FIXED
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

// ─── Trade simulation ───────────────────────────────────────────────────────
function simulateTrade(
  daily: Candles,
  entryIdx: number,
  side: "BUY" | "SELL",
  atr14: number
): { pnlPct: number; win: boolean } {
  const entry   = daily.closes[entryIdx];
  const riskAmt = atr14 * 1.5;
  const sl = side === "BUY" ? entry - riskAmt : entry + riskAmt;
  const tp = side === "BUY" ? entry + riskAmt * 1.5 : entry - riskAmt * 1.5;

  for (let b = 1; b <= TRADE_MAX_BARS; b++) {
    const idx  = entryIdx + b;
    if (idx >= daily.closes.length) break;
    const high = daily.highs[idx];
    const low  = daily.lows[idx];
    if (side === "BUY") {
      if (low  <= sl) return { pnlPct: ((sl - entry) / entry) * 100, win: false };
      if (high >= tp) return { pnlPct: ((tp - entry) / entry) * 100, win: true };
    } else {
      if (high >= sl) return { pnlPct: ((entry - sl) / entry) * 100, win: false };
      if (low  <= tp) return { pnlPct: ((entry - tp) / entry) * 100, win: true };
    }
  }
  const exitIdx   = Math.min(entryIdx + TRADE_MAX_BARS, daily.closes.length - 1);
  const exitPrice = daily.closes[exitIdx];
  const pnlPct    = side === "BUY"
    ? ((exitPrice - entry) / entry) * 100
    : ((entry - exitPrice) / entry) * 100;
  return { pnlPct, win: pnlPct > 0 };
}

// ─── Helpers ────────────────────────────────────────────────────────────────
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

function printTable(title: string, results: TradeResult[]) {
  const buckets: Record<string, TradeResult[]> = {};
  for (const r of results) {
    const b = getBucket(r.confidence);
    if (!buckets[b]) buckets[b] = [];
    buckets[b].push(r);
  }
  console.log(`\n${title}`);
  console.log("-".repeat(72));
  console.log(`${"Range".padEnd(8)} ${"Trades".padEnd(8)} ${"WinRate".padEnd(10)} ${"AvgPnL".padEnd(10)} ${"PF".padEnd(8)} ${"TotalPnL"}`);
  console.log("-".repeat(72));
  for (const [range, trades] of Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b))) {
    if (trades.length === 0) continue;
    const wins     = trades.filter(t => t.win).length;
    const wr       = (wins / trades.length) * 100;
    const avgPnl   = trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length;
    const totalPnl = trades.reduce((s, t) => s + t.pnlPct, 0);
    const gp = trades.filter(t => t.win).reduce((s, t)  => s + t.pnlPct, 0);
    const gl = Math.abs(trades.filter(t => !t.win).reduce((s, t) => s + t.pnlPct, 0));
    const pf = gl > 0 ? gp / gl : gp > 0 ? 999 : 0;
    const mark = wr >= 50 && avgPnl > 0 ? " ✅" : wr < 40 || avgPnl < -1 ? " ❌" : " ⚠️";
    console.log(
      `${range.padEnd(8)} ${String(trades.length).padEnd(8)} ${(wr.toFixed(1) + "%").padEnd(10)} ${(avgPnl.toFixed(2) + "%").padEnd(10)} ${pf.toFixed(2).padEnd(8)} ${totalPnl.toFixed(2)}%${mark}`
    );
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(72));
  console.log("NEXUS ALPHA — BACKTEST v3 (Paginated | Vol Approx | trend1d FIXED)");
  console.log(`Pairs: ${PAIRS.join(", ")}`);
  console.log(`Daily: ${DAILY_BATCHES}x1000 candles | 4H: ${H4_BATCHES}x1000 candles (time-aligned)`);
  console.log("=".repeat(72));

  const allResults: TradeResult[] = [];

  for (const pair of PAIRS) {
    process.stdout.write(`\n[${pair}] Fetching daily (${DAILY_BATCHES} batches)... `);
    let daily: Candles;
    try {
      daily = await fetchKlinesAll(pair, "1d", DAILY_BATCHES);
    } catch (err) {
      console.error(`❌ daily fetch gagal:`, err);
      continue;
    }
    console.log(`${daily.closes.length} candles`);

    process.stdout.write(`[${pair}] Fetching 4H   (${H4_BATCHES} batches)... `);
    let h4: Candles;
    try {
      h4 = await fetchKlinesAll(pair, "4h", H4_BATCHES);
    } catch (err) {
      console.error(`❌ 4H fetch gagal:`, err);
      continue;
    }
    console.log(`${h4.closes.length} candles`);

    let pairSignals = 0;
    for (let i = MIN_HISTORY; i < daily.closes.length - TRADE_MAX_BARS - 1; i++) {
      const inp = buildInput(pair, daily, h4, i);
      if (!inp || !inp.atr14) continue;

      const { score, bias } = scoreSwing(inp);
      if (bias === "NEUTRAL") continue;

      const side: "BUY" | "SELL" = bias === "BULLISH" ? "BUY" : "SELL";
      const sim = simulateTrade(daily, i, side, inp.atr14);

      allResults.push({ pair, confidence: score.total, side, trend1d: inp.trend1d, ...sim });
      pairSignals++;
    }
    console.log(`[${pair}] ${pairSignals} signals (NEUTRAL di-skip)`);
  }

  const total = allResults.length;
  console.log(`\n${"=".repeat(72)}`);
  console.log(`Total signals: ${total}`);

  // ── 1. Semua signal ────────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(72)}`);
  console.log("1. SEMUA PAIR GABUNGAN");
  printTable("Semua signal (non-NEUTRAL)", allResults);
  printTable("BUY saja", allResults.filter(r => r.side === "BUY"));
  printTable("SELL saja", allResults.filter(r => r.side === "SELL"));

  // ── 2. Filter trend1d ──────────────────────────────────────────────────────
  const trendClear   = allResults.filter(r =>
    (r.side === "BUY"  && r.trend1d === "BULLISH") ||
    (r.side === "SELL" && r.trend1d === "BEARISH")
  );
  const trendAgainst = allResults.filter(r =>
    (r.side === "BUY"  && r.trend1d === "BEARISH") ||
    (r.side === "SELL" && r.trend1d === "BULLISH")
  );

  console.log(`\n${"=".repeat(72)}`);
  console.log("2. FILTER TREND1D (sekarang pakai daily EMA, bukan 4H)");
  printTable(`Searah trend (${trendClear.length} trades)`, trendClear);
  printTable("Searah trend — BUY",  trendClear.filter(r => r.side === "BUY"));
  printTable("Searah trend — SELL", trendClear.filter(r => r.side === "SELL"));
  printTable(`Melawan trend (${trendAgainst.length} trades)`, trendAgainst);

  // ── 3. Breakdown per pair ──────────────────────────────────────────────────
  console.log(`\n${"=".repeat(72)}`);
  console.log("3. BREAKDOWN PER PAIR");
  console.log(`${"Pair".padEnd(12)} ${"Trades".padEnd(8)} ${"WR".padEnd(8)} ${"AvgPnL".padEnd(10)} ${"Best Bucket (≥10 trades)"}`);
  console.log("-".repeat(72));
  for (const pair of PAIRS) {
    const pr = allResults.filter(r => r.pair === pair);
    if (!pr.length) continue;
    const wins   = pr.filter(r => r.win).length;
    const wr     = (wins / pr.length) * 100;
    const avgPnl = pr.reduce((s, r) => s + r.pnlPct, 0) / pr.length;
    const bucketMap: Record<string, TradeResult[]> = {};
    for (const r of pr) {
      const b = getBucket(r.confidence);
      if (!bucketMap[b]) bucketMap[b] = [];
      bucketMap[b].push(r);
    }
    const best = Object.entries(bucketMap)
      .filter(([, t]) => t.length >= 10)
      .map(([range, t]) => ({
        range,
        wr:  (t.filter(x => x.win).length / t.length) * 100,
        ap:  t.reduce((s, x) => s + x.pnlPct, 0) / t.length,
      }))
      .sort((a, b) => b.ap - a.ap)[0];
    const mark    = wr >= 50 && avgPnl > 0 ? "✅" : wr < 40 ? "❌" : "⚠️";
    const bestStr = best
      ? `${best.range} (WR:${best.wr.toFixed(0)}% AP:${best.ap.toFixed(2)}%)`
      : "— (tidak ada bucket ≥10 trades)";
    console.log(`${mark} ${pair.padEnd(10)} ${String(pr.length).padEnd(8)} ${(wr.toFixed(1) + "%").padEnd(8)} ${(avgPnl.toFixed(2) + "%").padEnd(10)} ${bestStr}`);
  }

  // ── 4. Validasi sweet spot baru ────────────────────────────────────────────
  console.log(`\n${"=".repeat(72)}`);
  console.log("4. VALIDASI SWEET SPOT BARU: BUY 50-55 / SELL 0-45");
  console.log("=".repeat(72));
  const newBuy  = allResults.filter(r => r.side === "BUY"  && r.confidence >= 50 && r.confidence <= 55);
  const newSell = allResults.filter(r => r.side === "SELL" && r.confidence <= 45);
  const newBuyTrend  = newBuy.filter(r => r.trend1d === "BULLISH");
  const newSellTrend = newSell.filter(r => r.trend1d === "BEARISH");

  for (const [label, subset] of [
    ["BUY  50-55 (semua)",       newBuy],
    ["BUY  50-55 (searah trend)", newBuyTrend],
    ["SELL  0-45 (semua)",       newSell],
    ["SELL  0-45 (searah trend)", newSellTrend],
  ] as const) {
    if (!subset.length) { console.log(`  ${label}: no data`); continue; }
    const wins   = subset.filter(r => r.win).length;
    const wr     = (wins / subset.length) * 100;
    const avgPnl = subset.reduce((s, r) => s + r.pnlPct, 0) / subset.length;
    const gp     = subset.filter(r => r.win).reduce((s, r) => s + r.pnlPct, 0);
    const gl     = Math.abs(subset.filter(r => !r.win).reduce((s, r) => s + r.pnlPct, 0));
    const pf     = gl > 0 ? gp / gl : 999;
    const mark   = wr >= 50 && avgPnl > 0 ? "✅" : wr >= 45 && avgPnl > 0 ? "⚠️" : "❌";
    console.log(
      `  ${mark} ${label.padEnd(28)}: ${String(subset.length).padEnd(5)} trades | WR ${wr.toFixed(1)}% | AvgPnL ${avgPnl.toFixed(2)}% | PF ${pf.toFixed(2)}`
    );
  }

  console.log(`\n${"=".repeat(72)}`);
}

main().catch(console.error);
