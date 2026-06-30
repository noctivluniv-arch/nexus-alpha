/**
 * signal-engine-realtime.ts
 *
 * Versi real-time dari logic yang dipakai backtest-rule-engine.ts.
 * Fetch candle TERBARU dari Binance, hitung semua indikator yang sama persis
 * seperti backtest, lalu panggil scoreSwing() dari rule-based-engine.ts.
 *
 * Karena formula & input identik dengan backtest, hasil sinyal ini SECARA LOGIKA
 * konsisten dengan apa yang sudah kamu backtest — bukan engine baru yang belum teruji.
 *
 * Dipakai oleh cron.ts sebagai pengganti panggilan ke /api/ai/signal (Gemini).
 */

import {
  ema, rsi, macd, bollinger, atr, swingLevels, trendStructure,
  volumeProfile, stochastic, detectRsiDivergence,
  bosLevel, vwap, ichimoku, waveTrend, pivotPoints,
} from "./indicators";
import { scoreSwing, type RuleBasedSignalInput } from "./rule-based-engine";

interface Candles {
  opens: number[]; highs: number[]; lows: number[];
  closes: number[]; volumes: number[]; closeTime: number[];
}

async function fetchKlines(symbol: string, interval: string, limit = 300): Promise<Candles> {
  // Bybit interval mapping: "1d" -> "D", "4h" -> "240" (minutes)
  const bybitInterval = interval === "1d" ? "D" : interval === "4h" ? "240" : interval;
  const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${bybitInterval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bybit klines error ${res.status} for ${symbol} ${interval}`);
  const json = (await res.json()) as any;

  if (json.retCode !== 0) {
    throw new Error(`Bybit klines API error: ${json.retMsg} for ${symbol} ${interval}`);
  }

  // Bybit returns [startTime, open, high, low, close, volume, turnover], newest first
  const raw: any[] = json.result?.list ?? [];
  raw.reverse(); // oldest first, to match ordering used elsewhere

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

async function fetchLatestFundingRate(symbol: string): Promise<number | null> {
  try {
    const url = `https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${symbol}&limit=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    if (json.retCode !== 0) return null;
    const list = json.result?.list ?? [];
    return list.length > 0 ? parseFloat(list[0].fundingRate) : null;
  } catch {
    return null;
  }
}

async function fetchLatestFGI(): Promise<{ value: number; label: string } | null> {
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=1");
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const entry = data?.data?.[0];
    if (!entry) return null;
    return { value: parseInt(entry.value, 10), label: entry.value_classification };
  } catch {
    return null;
  }
}

export interface RealtimeSignal {
  pair: string;
  price: number;
  side: "BUY" | "SELL" | "NO_TRADE";
  confidence: number;
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  confluences: string[];
  scoreBreakdown: ReturnType<typeof scoreSwing>["score"];
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  atr14: number | null;
}

/**
 * Hitung sinyal real-time untuk satu pair, menggunakan formula yang
 * identik dengan backtest-rule-engine.ts.
 */
export async function computeRealtimeSignal(symbol: string): Promise<RealtimeSignal> {
  const [daily, h4, h1, fundingRateVal, fgiVal] = await Promise.all([
    fetchKlines(symbol, "1d", 300),
    fetchKlines(symbol, "4h", 300),
    fetchKlines(symbol, "1", 24),
    fetchLatestFundingRate(symbol),
    fetchLatestFGI(),
  ]);

  const dCloses = daily.closes;
  const dHighs = daily.highs;
  const dLows = daily.lows;
  const dVols = daily.volumes;

  const h4c = h4.closes;
  const h4h = h4.highs;
  const h4l = h4.lows;

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
  const trend1dVal = trendStructure(ema50Val, ema200Val, price); // Daily: EMA50/200 daily

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

  const high24h = dHighs[dHighs.length - 1];
  const low24h = dLows[dLows.length - 1];
  const prevClose = dCloses[dCloses.length - 2] ?? price;
  const change24h = (((price - prevClose) / prevClose) * 100).toFixed(2);

  const input: RuleBasedSignalInput = {
    pair: symbol, price,
    ema20: ema20Val, ema50: ema50Val, ema200: ema200Val,
    rsi1h: null, rsi4h: rsi4hVal, rsi1d: rsi1dVal, rsi1w: null,
    rsiDivergence: rsiDiv,
    macd4h: macd4hVal, macd1d: macd(dCloses),
    bb: bbVal,
    stoch4h: stoch4hVal, stoch1h: null,
    volAvg30: vp.avg, volRecent: vp.recent,
    volH1: h1.volumes.length > 0 ? h1.volumes[h1.volumes.length - 1] : 0,
    volH6: h1.volumes.length >= 6 ? h1.volumes.slice(-6).reduce((a, b) => a + b, 0) : 0,
    trend4h: trend4hVal, trend1d: trend1dVal,
    bos,
    sup1: swing7d.support, sup2: swing30d.support, sup3: swing90d.support,
    res1: swing7d.resistance, res2: swing30d.resistance, res3: swing90d.resistance,
    ichimoku: ichimokuVal, waveTrend: waveTrendVal, vwap: vwapVal, pivots,
    fundingRate: fundingRateVal, lsRatio: null, oiUsd: null,
    fgi: fgiVal, btcDom: null,
    atr14: atr14Val,
    change24h,
    high24h, low24h,
  };

  const scored = scoreSwing(input);

  // ── Sweet spot split berdasarkan backtest v2 (3124 trades) ──────────────────
  // BUY : confidence 50–55 → WR 44.7%, AvgPnL +1.23% (satu-satunya zone positif)
  // SELL: confidence 45–55 → PF 1.22 (45-50), PF 1.09 (50-55) — backtest v3, 2813 trades
  // Confidence di luar range ini → NO_TRADE (terlalu berisiko berdasarkan data)
  const conf = scored.score.total;

  let side: "BUY" | "SELL" | "NO_TRADE" = "NO_TRADE";
  if (scored.bias === "BEARISH" && conf >= 45 && conf <= 55) side = "SELL";
  // BUY disabled — re-enable setelah ada bukti zona profitable (backtest v3: semua bucket negatif)

  // ATR-based risk management
  let sl: number | null = null;
  let tp1: number | null = null;
  let tp2: number | null = null;
  let tp3: number | null = null;

  if (atr14Val && side !== "NO_TRADE") {
    const riskAmt = atr14Val * 1.5;
    if (side === "BUY") {
      sl = price - riskAmt;
      tp1 = price + riskAmt * 1.5;
      tp2 = price + riskAmt * 2.5;
      tp3 = price + riskAmt * 4.0;
    } else {
      sl = price + riskAmt;
      tp1 = price - riskAmt * 1.5;
      tp2 = price - riskAmt * 2.5;
      tp3 = price - riskAmt * 4.0;
    }
  }

  return {
    pair: symbol,
    price,
    side,
    confidence: scored.score.total,
    bias: scored.bias,
    confluences: scored.confluences,
    scoreBreakdown: scored.score,
    sl, tp1, tp2, tp3,
    atr14: atr14Val,
  };
}
