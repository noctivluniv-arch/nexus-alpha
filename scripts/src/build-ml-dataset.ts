/**
 * build-ml-dataset.ts
 *
 * Bangun dataset mentah untuk training logistic regression, menggantikan
 * bobot manual di rule-based-engine.ts dengan bobot yang dicari dari data.
 *
 * - Fitur = nilai MENTAH (jarak dari EMA dalam satuan ATR, RSI, posisi BB, dst),
 *   BUKAN skor 0-100 seperti scoreSwing(). Biar logistic regression yang cari
 *   bobotnya sendiri, bukan kita yang nebak.
 * - Setiap hari digenerate DUA baris hipotesis: "kalau BUY di sini menang/kalah?"
 *   dan "kalau SELL di sini menang/kalah?" -> training model TERPISAH BUY/SELL.
 * - SL/TP identik dengan backtest-v3-paginated.ts: SL = 1.5x ATR14,
 *   TP = 1.5x ATR14 (RR 1:1), max holding 10 hari.
 * - TIDAK ada anti-overlap filter (sama seperti v3) -> baris berdekatan waktu
 *   SALING BERKORELASI. Split train/test HARUS kronologis (ditangani di
 *   train-logistic-model.ts), JANGAN di-random-shuffle.
 * - fundingRate/fgi/lsRatio/btcDom SENGAJA TIDAK dimasukkan -> selalu null
 *   di backtest historis (lihat catatan sesi 5 Juli 2026).
 *
 * Jalankan:
 *   cd ~/nexus-alpha
 *   mkdir -p scripts/output
 *   tsx scripts/src/build-ml-dataset.ts
 *
 * Estimasi waktu: 3-5 menit (sama seperti backtest v3)
 */

import {
  ema, rsi, macd, bollinger, atr, swingLevels, trendStructure,
  volumeProfile, stochastic, detectRsiDivergence,
  bosLevel, vwap, ichimoku, waveTrend, pivotPoints,
} from "../../artifacts/api-server/src/lib/indicators.js";
import type { RuleBasedSignalInput } from "../../artifacts/api-server/src/lib/rule-based-engine.js";
import * as fs from "fs";

const PAIRS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "LINKUSDT", "DOGEUSDT"];
const MIN_HISTORY = 200;
const TRADE_MAX_BARS = 10;
const DAILY_BATCHES = 4;
const H4_BATCHES = 14; // diperbesar dari 5, cover sekitar 6 tahun data 2020-2026
const OUT_PATH = "scripts/output/ml-dataset.csv";

interface Candles {
  opens: number[]; highs: number[]; lows: number[];
  closes: number[]; volumes: number[]; times: number[];
}

async function fetchKlinesAll(symbol: string, interval: string, maxBatches: number): Promise<Candles> {
  const bybitInterval = interval === "1d" ? "D" : interval === "4h" ? "240" : interval;
  const LIMIT = 1000;
  const batches: any[][] = [];
  let endTime: number | undefined = undefined;
  for (let b = 0; b < maxBatches; b++) {
    const params: Record<string, string> = { category: "spot", symbol, interval: bybitInterval, limit: String(LIMIT) };
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
    await new Promise(r => setTimeout(r, 400));
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

function buildInput(symbol: string, daily: Candles, h4: Candles, i: number): (RuleBasedSignalInput & { atr14: number }) | null {
  const dc = daily.closes.slice(0, i + 1);
  const dh = daily.highs.slice(0, i + 1);
  const dl = daily.lows.slice(0, i + 1);
  const dv = daily.volumes.slice(0, i + 1);
  const dailyOpenTs = daily.times[i];
  let h4EndIdx = h4.times.findIndex(t => t > dailyOpenTs);
  if (h4EndIdx === -1) h4EndIdx = h4.closes.length;
  const h4c = h4.closes.slice(0, h4EndIdx);
  const h4h = h4.highs.slice(0, h4EndIdx);
  const h4l = h4.lows.slice(0, h4EndIdx);
  if (dc.length < 50 || h4c.length < 50) return null;
  const price = dc[dc.length - 1];
  const todayVol = dv[dv.length - 1];
  const volH1 = todayVol / 24;
  const volH6 = todayVol / 4;
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
    const trend1dVal = trendStructure(ema50Val, ema200Val, price);
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
    if (!atr14Val || atr14Val <= 0) return null;
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

function simulateTrade(daily: Candles, entryIdx: number, side: "BUY" | "SELL", atr14: number): { pnlPct: number; win: boolean } {
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
  const exitIdx = Math.min(entryIdx + TRADE_MAX_BARS, daily.closes.length - 1);
  const exitPrice = daily.closes[exitIdx];
  const pnlPct = side === "BUY" ? ((exitPrice - entry) / entry) * 100 : ((entry - exitPrice) / entry) * 100;
  return { pnlPct, win: pnlPct > 0 };
}

function extractFeatures(inp: RuleBasedSignalInput & { atr14: number }): Record<string, number> {
  const atr14 = inp.atr14;
  const price = inp.price;
  const f: Record<string, number> = {};

  f.ema20_dist_atr = inp.ema20 !== null ? (price - inp.ema20) / atr14 : 0;
  f.ema50_dist_atr = inp.ema50 !== null ? (price - inp.ema50) / atr14 : 0;
  f.ema200_dist_atr = inp.ema200 !== null ? (price - inp.ema200) / atr14 : 0;
  f.ema_stack_bull = (inp.ema20 && inp.ema50 && inp.ema200 && price > inp.ema20 && inp.ema20 > inp.ema50 && inp.ema50 > inp.ema200) ? 1 : 0;
  f.ema_stack_bear = (inp.ema20 && inp.ema50 && inp.ema200 && price < inp.ema20 && inp.ema20 < inp.ema50 && inp.ema50 < inp.ema200) ? 1 : 0;

  f.rsi1d = inp.rsi1d ?? 50;
  f.rsi4h = inp.rsi4h ?? 50;
  f.rsi_div_bull = inp.rsiDivergence === "BULLISH_DIVERGENCE" ? 1 : 0;
  f.rsi_div_bear = inp.rsiDivergence === "BEARISH_DIVERGENCE" ? 1 : 0;

  f.macd4h_hist_atr = inp.macd4h ? inp.macd4h.histogram / atr14 : 0;
  f.macd4h_bull_cross = inp.macd4h && inp.macd4h.macd > inp.macd4h.signal ? 1 : 0;

  f.bb_position = inp.bb && (inp.bb.upper - inp.bb.lower) > 0
    ? Math.max(0, Math.min(1, (price - inp.bb.lower) / (inp.bb.upper - inp.bb.lower)))
    : 0.5;
  f.bb_bandwidth = inp.bb ? inp.bb.bandwidth : 0;

  f.stoch4h_k = inp.stoch4h ? inp.stoch4h.k : 50;
  f.stoch4h_d = inp.stoch4h ? inp.stoch4h.d : 50;

  f.trend4h_bull = inp.trend4h === "BULLISH" ? 1 : inp.trend4h === "BEARISH" ? -1 : 0;
  f.trend1d_bull = inp.trend1d === "BULLISH" ? 1 : inp.trend1d === "BEARISH" ? -1 : 0;

  const volRatio = inp.volAvg30 > 0 ? inp.volRecent / inp.volAvg30 : 1;
  const volAcc = inp.volH6 > 0 ? inp.volH1 / (inp.volH6 / 6) : 1;
  f.vol_ratio = volRatio;
  f.vol_accel = volAcc;

  f.dist_sup1_atr = (price - inp.sup1) / atr14;
  f.dist_res1_atr = (inp.res1 - price) / atr14;
  f.dist_sup2_atr = (price - inp.sup2) / atr14;
  f.dist_res2_atr = (inp.res2 - price) / atr14;
  f.dist_sup3_atr = (price - inp.sup3) / atr14;
  f.dist_res3_atr = (inp.res3 - price) / atr14;

  f.ichimoku_above = inp.ichimoku?.priceVsCloud === "ABOVE" ? 1 : 0;
  f.ichimoku_below = inp.ichimoku?.priceVsCloud === "BELOW" ? 1 : 0;
  f.ichimoku_trend_bull = inp.ichimoku?.trend === "BULLISH" ? 1 : inp.ichimoku?.trend === "BEARISH" ? -1 : 0;

  f.wt_cross_bull = inp.waveTrend?.cross === "BULLISH" ? 1 : 0;
  f.wt_cross_bear = inp.waveTrend?.cross === "BEARISH" ? 1 : 0;
  f.wt_oversold = inp.waveTrend?.zone === "OVERSOLD" ? 1 : 0;
  f.wt_overbought = inp.waveTrend?.zone === "OVERBOUGHT" ? 1 : 0;

  f.vwap_dist_atr = inp.vwap ? (price - inp.vwap.vwap) / atr14 : 0;
  f.pivot_dist_atr = inp.pivots ? (price - inp.pivots.pp) / atr14 : 0;

  f.bos_bull = inp.bos.direction === "BULLISH" ? 1 : 0;
  f.bos_bear = inp.bos.direction === "BEARISH" ? 1 : 0;

  f.change24h = parseFloat(inp.change24h as unknown as string) || 0;

  return f;
}

async function main() {
  const rows: Array<{ pair: string; dateMs: number; features: Record<string, number>; label_buy: number; pnl_buy: number; label_sell: number; pnl_sell: number }> = [];

  for (const pair of PAIRS) {
    process.stdout.write(`[${pair}] fetching daily...`);
    const daily = await fetchKlinesAll(pair, "1d", DAILY_BATCHES);
    console.log(` ${daily.closes.length} candles`);
    process.stdout.write(`[${pair}] fetching 4h...`);
    const h4 = await fetchKlinesAll(pair, "4h", H4_BATCHES);
    console.log(` ${h4.closes.length} candles`);

    let count = 0;
    for (let i = MIN_HISTORY; i < daily.closes.length - TRADE_MAX_BARS - 1; i++) {
      const inp = buildInput(pair, daily, h4, i);
      if (!inp) continue;
      const features = extractFeatures(inp);
      const buySim = simulateTrade(daily, i, "BUY", inp.atr14);
      const sellSim = simulateTrade(daily, i, "SELL", inp.atr14);
      rows.push({
        pair, dateMs: daily.times[i], features,
        label_buy: buySim.win ? 1 : 0, pnl_buy: buySim.pnlPct,
        label_sell: sellSim.win ? 1 : 0, pnl_sell: sellSim.pnlPct,
      });
      count++;
    }
    console.log(`[${pair}] ${count} rows`);
  }

  if (rows.length === 0) {
    console.error("Tidak ada data ter-generate, cek koneksi Bybit.");
    return;
  }

  const featureNames = Object.keys(rows[0].features);
  const header = ["pair", "dateMs", ...featureNames, "label_buy", "pnl_buy", "label_sell", "pnl_sell"].join(",");
  const lines = [header];
  for (const r of rows) {
    const vals = [r.pair, r.dateMs, ...featureNames.map(fn => r.features[fn]), r.label_buy, r.pnl_buy.toFixed(4), r.label_sell, r.pnl_sell.toFixed(4)];
    lines.push(vals.join(","));
  }
  fs.mkdirSync("scripts/output", { recursive: true });
  fs.writeFileSync(OUT_PATH, lines.join("\n"));
  console.log(`\n✅ Dataset ditulis ke ${OUT_PATH} — ${rows.length} baris, ${featureNames.length} fitur`);
}

main().catch(console.error);
