export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

export function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - diff) / period;
    }
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  signalP = 9,
): { macd: number; signal: number; histogram: number } | null {
  if (values.length < slow + signalP) return null;
  const macdSeries: number[] = [];
  for (let i = slow; i <= values.length; i++) {
    const slice = values.slice(0, i);
    const eFast = ema(slice, fast);
    const eSlow = ema(slice, slow);
    if (eFast == null || eSlow == null) continue;
    macdSeries.push(eFast - eSlow);
  }
  const sig = ema(macdSeries, signalP);
  const macdVal = macdSeries[macdSeries.length - 1];
  if (sig == null || macdVal == null) return null;
  return { macd: macdVal, signal: sig, histogram: macdVal - sig };
}

export function bollinger(
  values: number[],
  period = 20,
  mult = 2,
): { upper: number; middle: number; lower: number; bandwidth: number } | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance =
    slice.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / period;
  const sd = Math.sqrt(variance);
  const upper = mean + mult * sd;
  const lower = mean - mult * sd;
  return { upper, middle: mean, lower, bandwidth: (upper - lower) / mean };
}

export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): number | null {
  if (closes.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
    trs.push(tr);
  }
  return sma(trs, period);
}

export function swingLevels(
  highs: number[],
  lows: number[],
  lookback = 20,
): { resistance: number; support: number } {
  const recentHighs = highs.slice(-lookback);
  const recentLows = lows.slice(-lookback);
  return {
    resistance: Math.max(...recentHighs),
    support: Math.min(...recentLows),
  };
}

export function fibLevels(high: number, low: number): Record<string, number> {
  const diff = high - low;
  return {
    "0.236": high - diff * 0.236,
    "0.382": high - diff * 0.382,
    "0.5": high - diff * 0.5,
    "0.618": high - diff * 0.618,
    "0.786": high - diff * 0.786,
  };
}

export function trendStructure(
  ema50: number | null,
  ema200: number | null,
  price: number,
): "BULLISH" | "BEARISH" | "RANGING" {
  if (ema50 == null || ema200 == null) return "RANGING";
  if (price > ema50 && ema50 > ema200) return "BULLISH";
  if (price < ema50 && ema50 < ema200) return "BEARISH";
  return "RANGING";
}

export function volumeProfile(volumes: number[]): {
  avg: number;
  recent: number;
  spike: boolean;
} {
  if (volumes.length === 0) return { avg: 0, recent: 0, spike: false };
  const avg = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const recent = volumes[volumes.length - 1];
  return { avg, recent, spike: recent > avg * 1.5 };
}

export function stochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  kPeriod = 14,
  smoothK = 3,
  dPeriod = 3,
): { k: number; d: number } | null {
  const minLen = kPeriod + smoothK + dPeriod;
  if (closes.length < minLen) return null;

  const rawK: number[] = [];
  for (let i = kPeriod - 1; i < closes.length; i++) {
    const hSlice = highs.slice(i - kPeriod + 1, i + 1);
    const lSlice = lows.slice(i - kPeriod + 1, i + 1);
    const hh = Math.max(...hSlice);
    const ll = Math.min(...lSlice);
    const range = hh - ll;
    rawK.push(range === 0 ? 50 : ((closes[i] - ll) / range) * 100);
  }

  const kSeries: number[] = [];
  for (let i = smoothK - 1; i < rawK.length; i++) {
    const sl = rawK.slice(i - smoothK + 1, i + 1);
    kSeries.push(sl.reduce((a, b) => a + b, 0) / smoothK);
  }

  const dSeries: number[] = [];
  for (let i = dPeriod - 1; i < kSeries.length; i++) {
    const sl = kSeries.slice(i - dPeriod + 1, i + 1);
    dSeries.push(sl.reduce((a, b) => a + b, 0) / dPeriod);
  }

  const k = kSeries[kSeries.length - 1];
  const d = dSeries[dSeries.length - 1];
  if (k == null || d == null) return null;
  return { k, d };
}

export function obvTrend(
  closes: number[],
  volumes: number[],
): "BULLISH" | "BEARISH" | "NEUTRAL" {
  if (closes.length < 2 || volumes.length < 2) return "NEUTRAL";
  let obv = 0;
  const series: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv += volumes[i];
    else if (closes[i] < closes[i - 1]) obv -= volumes[i];
    series.push(obv);
  }
  const lookback = Math.min(20, series.length - 1);
  const half = Math.floor(lookback / 2);
  const first = series.slice(-lookback, -half);
  const second = series.slice(-half);
  const avgFirst = first.reduce((a, b) => a + b, 0) / (first.length || 1);
  const avgSecond = second.reduce((a, b) => a + b, 0) / (second.length || 1);
  const ref = Math.abs(avgFirst) + 1;
  const pct = (avgSecond - avgFirst) / ref;
  if (pct > 0.02) return "BULLISH";
  if (pct < -0.02) return "BEARISH";
  return "NEUTRAL";
}

export function detectRsiDivergence(
  closes: number[],
  lookback = 20,
): "BULLISH" | "BEARISH" | "NONE" {
  if (closes.length < lookback + 20) return "NONE";
  const r1 = rsi(closes.slice(0, closes.length - lookback + 15), 14) ?? 50;
  const r2 = rsi(closes, 14) ?? 50;
  const priceStart = closes[closes.length - lookback];
  const priceEnd = closes[closes.length - 1];
  const priceUp = priceEnd > priceStart * 1.002;
  const priceDown = priceEnd < priceStart * 0.998;
  const rsiUp = r2 > r1 + 2;
  const rsiDown = r2 < r1 - 2;
  if (priceDown && rsiUp) return "BULLISH";
  if (priceUp && rsiDown) return "BEARISH";
  return "NONE";
}

export interface AggregatedOHLC {
  closes: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
}

/**
 * Aggregate sub-period candles into larger candles (e.g. 4×1H → 1×4H).
 *
 * Accepts the full OHLC arrays and uses the SOURCE highs/lows when available
 * so per-bucket high/low reflect actual intra-bar extremes (critical for
 * stochastic, swing levels, BOS, 24h H/L). Falls back to deriving from closes
 * when source highs/lows are not provided (legacy single-array callers).
 */
export function aggregateCandles(
  srcCloses: number[],
  srcVolumes: number[],
  groupSize: number,
  srcHighs?: number[],
  srcLows?: number[],
): AggregatedOHLC {
  const closes: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const volumes: number[] = [];

  const useSrcHL =
    Array.isArray(srcHighs) &&
    Array.isArray(srcLows) &&
    srcHighs.length === srcCloses.length &&
    srcLows.length === srcCloses.length;

  const start = srcCloses.length % groupSize;
  for (let i = start; i + groupSize <= srcCloses.length; i += groupSize) {
    const cSlice = srcCloses.slice(i, i + groupSize);
    const vSlice = srcVolumes.slice(i, i + groupSize);
    closes.push(cSlice[cSlice.length - 1]);
    if (useSrcHL) {
      highs.push(Math.max(...srcHighs!.slice(i, i + groupSize)));
      lows.push(Math.min(...srcLows!.slice(i, i + groupSize)));
    } else {
      highs.push(Math.max(...cSlice));
      lows.push(Math.min(...cSlice));
    }
    volumes.push(vSlice.reduce((a, b) => a + b, 0));
  }
  return { closes, highs, lows, volumes };
}

export function bosLevel(
  highs: number[],
  lows: number[],
  closes: number[],
  lookback = 20,
): { direction: "BULLISH" | "BEARISH" | "NONE"; price: number } {
  if (closes.length < lookback + 2) return { direction: "NONE", price: 0 };
  const prevHigh = Math.max(...highs.slice(-lookback - 1, -1));
  const prevLow = Math.min(...lows.slice(-lookback - 1, -1));
  const current = closes[closes.length - 1];
  if (current > prevHigh) return { direction: "BULLISH", price: prevHigh };
  if (current < prevLow) return { direction: "BEARISH", price: prevLow };
  return { direction: "NONE", price: 0 };
}
