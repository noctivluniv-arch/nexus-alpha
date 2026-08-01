/**
 * ml-signal-engine.ts
 *
 * Engine prediksi logistic regression untuk SHADOW forward-test (BELUM
 * menggantikan signal-engine-realtime.ts yang live). Fitur dihitung PERSIS
 * sama seperti scripts/src/build-ml-dataset.ts (extractFeatures) supaya
 * distribusi fitur saat live inference konsisten dengan saat training.
 *
 * PENTING soal volH1/volH6: training pakai APPROKSIMASI dari volume daily
 * (todayVol/24, todayVol/4), BUKAN fetch data 1H asli seperti yang dipakai
 * signal-engine-realtime.ts produksi. Di sini SENGAJA pakai approksimasi
 * yang sama dengan training, supaya tidak ada mismatch distribusi fitur.
 *
 * rolling_vol_pct: percentile bb_bandwidth hari ini relatif ke 90 hari
 * sebelumnya (TIDAK termasuk hari ini sendiri, no lookahead) - sama persis
 * logika di scripts/src/train-final-model.ts.
 */

import {
  ema, rsi, macd, bollinger, atr, swingLevels, trendStructure,
  volumeProfile, stochastic, detectRsiDivergence,
  bosLevel, vwap, ichimoku, waveTrend, pivotPoints,
} from "./indicators";
import modelBuyRaw from "./models/model-buy-final.json";
import modelSellRaw from "./models/model-sell-final.json";

interface MlModel {
  weights: number[];
  bias: number;
  featureNames: string[];
  mean: number[];
  std: number[];
}

const modelBuy = modelBuyRaw as unknown as MlModel;
const modelSell = modelSellRaw as unknown as MlModel;

const ROLLING_WINDOW = 90;

interface Candles {
  opens: number[]; highs: number[]; lows: number[];
  closes: number[]; volumes: number[]; closeTime: number[];
}

async function fetchKlines(symbol: string, interval: string, limit = 300): Promise<Candles> {
  const bybitInterval = interval === "1d" ? "D" : interval === "4h" ? "240" : interval;
  // Untuk daily: minta 1 lebih banyak, lalu buang candle yang masih berjalan
  // (belum closed) — root cause bug 16 Juli 2026: volume hari berjalan cuma
  // sebagian (bukan 24 jam penuh), bikin fitur vol_ratio/volH1/volH6 bias.
  // Interval 4h/1h TIDAK diubah (dampaknya jauh lebih kecil ke EMA/RSI/MACD
  // dibanding perbandingan rasio volume harian yang sensitif).
  const fetchLimit = interval === "1d" ? limit + 1 : limit;
  const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${bybitInterval}&limit=${fetchLimit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bybit klines error ${res.status} for ${symbol} ${interval}`);
  const json = (await res.json()) as any;
  if (json.retCode !== 0) throw new Error(`Bybit klines API error: ${json.retMsg} for ${symbol} ${interval}`);
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

  if (interval === "1d") {
    const nowMs = Date.now();
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    while (c.closeTime.length > 0 && c.closeTime[c.closeTime.length - 1] + ONE_DAY_MS > nowMs) {
      c.opens.pop(); c.highs.pop(); c.lows.pop(); c.closes.pop(); c.volumes.pop(); c.closeTime.pop();
    }
  }

  return c;
}

function sigmoid(z: number): number {
  if (z > 30) return 1;
  if (z < -30) return 0;
  return 1 / (1 + Math.exp(-z));
}

function predictProba(features: Record<string, number>, model: MlModel): number {
  let z = model.bias;
  for (let j = 0; j < model.featureNames.length; j++) {
    const raw = features[model.featureNames[j]] ?? 0;
    const standardized = (raw - model.mean[j]) / model.std[j];
    z += model.weights[j] * standardized;
  }
  return sigmoid(z);
}

/**
 * Hitung rolling percentile bb_bandwidth untuk hari TERAKHIR dalam array
 * dailyCloses, berdasarkan 90 hari SEBELUMNYA (tidak termasuk hari ini).
 * Butuh minimal ~90+20 hari daily candle untuk hasil valid.
 */
function computeRollingVolPct(dailyCloses: number[]): number {
  const n = dailyCloses.length;
  if (n < ROLLING_WINDOW + 25) return 0.5; // fallback netral kalau data kurang

  const bbHistory: number[] = [];
  const start = Math.max(20, n - ROLLING_WINDOW - 1);
  for (let i = start; i < n; i++) {
    const slice = dailyCloses.slice(0, i + 1);
    const bb = bollinger(slice, 20, 2);
    bbHistory.push(bb ? bb.bandwidth : 0);
  }
  // bbHistory[bbHistory.length - 1] = bandwidth hari ini
  // window pembanding = semua SEBELUM hari ini
  const today = bbHistory[bbHistory.length - 1];
  const window = bbHistory.slice(0, bbHistory.length - 1);
  if (window.length < 10) return 0.5;
  const sorted = [...window].sort((a, b) => a - b);
  let count = 0;
  for (const v of sorted) if (v <= today) count++;
  return count / sorted.length;
}

function extractFeatures(
  price: number, atr14: number,
  ema20: number | null, ema50: number | null, ema200: number | null,
  rsi1d: number | null, rsi4h: number | null, rsiDiv: string,
  macd4h: { macd: number; signal: number; histogram: number } | null,
  bb: { upper: number; middle: number; lower: number; bandwidth: number } | null,
  stoch4h: { k: number; d: number } | null,
  trend4h: string, trend1d: string,
  volAvg30: number, volRecent: number, volH1: number, volH6: number,
  sup1: number, sup2: number, sup3: number, res1: number, res2: number, res3: number,
  ichimokuVal: { priceVsCloud: string; trend: string } | null,
  waveTrendVal: { cross: string; zone: string } | null,
  vwapVal: { vwap: number } | null,
  pivotsVal: { pp: number } | null,
  bos: { direction: string },
  change24h: string,
  rollingVolPct: number,
): Record<string, number> {
  const f: Record<string, number> = {};
  f.ema20_dist_atr = ema20 !== null ? (price - ema20) / atr14 : 0;
  f.ema50_dist_atr = ema50 !== null ? (price - ema50) / atr14 : 0;
  f.ema200_dist_atr = ema200 !== null ? (price - ema200) / atr14 : 0;
  f.ema_stack_bull = (ema20 && ema50 && ema200 && price > ema20 && ema20 > ema50 && ema50 > ema200) ? 1 : 0;
  f.ema_stack_bear = (ema20 && ema50 && ema200 && price < ema20 && ema20 < ema50 && ema50 < ema200) ? 1 : 0;
  f.rsi1d = rsi1d ?? 50;
  f.rsi4h = rsi4h ?? 50;
  f.rsi_div_bull = rsiDiv === "BULLISH_DIVERGENCE" ? 1 : 0;
  f.rsi_div_bear = rsiDiv === "BEARISH_DIVERGENCE" ? 1 : 0;
  f.macd4h_hist_atr = macd4h ? macd4h.histogram / atr14 : 0;
  f.macd4h_bull_cross = macd4h && macd4h.macd > macd4h.signal ? 1 : 0;
  f.bb_position = bb && (bb.upper - bb.lower) > 0 ? Math.max(0, Math.min(1, (price - bb.lower) / (bb.upper - bb.lower))) : 0.5;
  f.bb_bandwidth = bb ? bb.bandwidth : 0;
  f.stoch4h_k = stoch4h ? stoch4h.k : 50;
  f.stoch4h_d = stoch4h ? stoch4h.d : 50;
  f.trend4h_bull = trend4h === "BULLISH" ? 1 : trend4h === "BEARISH" ? -1 : 0;
  f.trend1d_bull = trend1d === "BULLISH" ? 1 : trend1d === "BEARISH" ? -1 : 0;
  const volRatio = volAvg30 > 0 ? volRecent / volAvg30 : 1;
  const volAcc = volH6 > 0 ? volH1 / (volH6 / 6) : 1;
  f.vol_ratio = volRatio;
  f.vol_accel = volAcc;
  f.dist_sup1_atr = (price - sup1) / atr14;
  f.dist_res1_atr = (res1 - price) / atr14;
  f.dist_sup2_atr = (price - sup2) / atr14;
  f.dist_res2_atr = (res2 - price) / atr14;
  f.dist_sup3_atr = (price - sup3) / atr14;
  f.dist_res3_atr = (res3 - price) / atr14;
  f.ichimoku_above = ichimokuVal?.priceVsCloud === "ABOVE" ? 1 : 0;
  f.ichimoku_below = ichimokuVal?.priceVsCloud === "BELOW" ? 1 : 0;
  f.ichimoku_trend_bull = ichimokuVal?.trend === "BULLISH" ? 1 : ichimokuVal?.trend === "BEARISH" ? -1 : 0;
  f.wt_cross_bull = waveTrendVal?.cross === "BULLISH" ? 1 : 0;
  f.wt_cross_bear = waveTrendVal?.cross === "BEARISH" ? 1 : 0;
  f.wt_oversold = waveTrendVal?.zone === "OVERSOLD" ? 1 : 0;
  f.wt_overbought = waveTrendVal?.zone === "OVERBOUGHT" ? 1 : 0;
  f.vwap_dist_atr = vwapVal ? (price - vwapVal.vwap) / atr14 : 0;
  f.pivot_dist_atr = pivotsVal ? (price - pivotsVal.pp) / atr14 : 0;
  f.bos_bull = bos.direction === "BULLISH" ? 1 : 0;
  f.bos_bear = bos.direction === "BEARISH" ? 1 : 0;
  f.change24h = parseFloat(change24h) || 0;
  f.rolling_vol_pct = rollingVolPct;
  return f;
}

export interface MlSignalResult {
  pair: string;
  price: number;
  probBuy: number;
  probSell: number;
  side: "BUY" | "SELL" | "NO_TRADE";
  confidence: number; // probabilitas sisi yang dipilih, dalam %
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  atr14: number | null;
}

// Threshold dipisah per side setelah backtest-ml-threshold-sweep.ts (7 Juli 2026):
// BUY @ 0.65 terbukti konsisten profitable di 2 periode (PF 2.23/1.88), bahkan
// mengalahkan breakout momentum. SELL TIDAK ditemukan threshold yang aman di
// kedua periode sampai 0.70 — tetap di 0.52 lama sambil menunggu riset lanjutan,
// JANGAN naikkan asal tanpa bukti backtest baru.
const ML_BUY_THRESHOLD = 0.65;
const ML_SELL_THRESHOLD = 0.52;

async function fetchLivePrice(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`);
    const json = (await res.json()) as any;
    if (json.retCode !== 0) return null;
    const ticker = json.result?.list?.[0];
    if (!ticker) return null;
    return parseFloat(ticker.lastPrice);
  } catch {
    return null;
  }
}

export async function computeMlSignal(symbol: string): Promise<MlSignalResult> {
  const [daily, h4, h1] = await Promise.all([
    fetchKlines(symbol, "1d", 300),
    fetchKlines(symbol, "4h", 300),
    fetchKlines(symbol, "1", 24),
  ]);

  const dCloses = daily.closes, dHighs = daily.highs, dLows = daily.lows, dVols = daily.volumes;
  const h4c = h4.closes, h4h = h4.highs, h4l = h4.lows;
  // "price" di bawah ini = closing harian TERAKHIR YANG SUDAH CLOSED (fix 16 Juli 2026,
  // lihat CLAUDE_CONTEXT.md). WAJIB dipakai untuk semua fitur teknikal (RSI/MACD/trend/dst)
  // supaya konsisten dengan data training. TAPI JANGAN dipakai sebagai harga entry sinyal —
  // itu penyebab bug 23-24 Juli 2026: entry beku di harga kemarin sementara checker
  // membandingkan ke harga live, jadi sinyal baru langsung SL_HIT berkali-kali dalam sehari.
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
  const trend1dVal = trendStructure(ema50Val, ema200Val, price);
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
  const pivotsVal = pivotPoints(prevH, prevL, prevC);
  const atr14Val = atr(dHighs, dLows, dCloses, 14);
  const vp = volumeProfile(dVols.slice(-30));
  const change24h = (((price - prevC) / prevC) * 100).toFixed(2);

  // volH1/volH6: APPROKSIMASI dari daily volume, SAMA seperti training (bukan fetch 1H asli)
  const todayVol = dVols[dVols.length - 1];
  const volH1 = todayVol / 24;
  const volH6 = todayVol / 4;

  const rollingVolPct = computeRollingVolPct(dCloses);

  if (!atr14Val || atr14Val <= 0) {
    return { pair: symbol, price, probBuy: 0, probSell: 0, side: "NO_TRADE", confidence: 0, sl: null, tp1: null, tp2: null, tp3: null, atr14: null };
  }

  const features = extractFeatures(
    price, atr14Val, ema20Val, ema50Val, ema200Val, rsi1dVal, rsi4hVal, rsiDiv,
    macd4hVal, bbVal, stoch4hVal, trend4hVal, trend1dVal,
    vp.avg, vp.recent, volH1, volH6,
    swing7d.support, swing30d.support, swing90d.support,
    swing7d.resistance, swing30d.resistance, swing90d.resistance,
    ichimokuVal, waveTrendVal, vwapVal, pivotsVal, bos, change24h, rollingVolPct,
  );

  const probBuy = predictProba(features, modelBuy);
  const probSell = predictProba(features, modelSell);

  let side: "BUY" | "SELL" | "NO_TRADE" = "NO_TRADE";
  let confidence = 0;
  if (probBuy >= ML_BUY_THRESHOLD && probBuy >= probSell) { side = "BUY"; confidence = probBuy; }
  else if (probSell >= ML_SELL_THRESHOLD && probSell > probBuy) { side = "SELL"; confidence = probSell; }

  let sl: number | null = null, tp1: number | null = null, tp2: number | null = null, tp3: number | null = null;
  let entryPrice = price; // fallback kalau live price gagal di-fetch
  if (side !== "NO_TRADE") {
    // Fetch harga live buat entry/SL/TP — JANGAN pakai daily close yang bisa beku
    // sampai 24 jam (lihat catatan di atas soal bug 23-24 Juli 2026).
    const livePrice = await fetchLivePrice(symbol);
    if (livePrice !== null && livePrice > 0) entryPrice = livePrice;

    const riskAmt = atr14Val * 1.5;
    if (side === "BUY") {
      sl = entryPrice - riskAmt; tp1 = entryPrice + riskAmt * 1.5; tp2 = entryPrice + riskAmt * 2.5; tp3 = entryPrice + riskAmt * 4.0;
    } else {
      sl = entryPrice + riskAmt; tp1 = entryPrice - riskAmt * 1.5; tp2 = entryPrice - riskAmt * 2.5; tp3 = entryPrice - riskAmt * 4.0;
    }
  }

  return { pair: symbol, price: entryPrice, probBuy, probSell, side, confidence: confidence * 100, sl, tp1, tp2, tp3, atr14: atr14Val };
}
