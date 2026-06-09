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

// ─── VWAP ────────────────────────────────────────────────────────────────────
export function vwap(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
): { vwap: number; upperBand: number; lowerBand: number } | null {
  if (closes.length < 2) return null;
  let cumTPV = 0, cumVol = 0;
  const tpvArr: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    cumTPV += tp * volumes[i];
    cumVol += volumes[i];
    tpvArr.push(tp);
  }
  if (cumVol === 0) return null;
  const vwapVal = cumTPV / cumVol;
  // Standard deviation bands
  const mean = cumTPV / cumVol;
  let variance = 0;
  for (let i = 0; i < tpvArr.length; i++) {
    variance += volumes[i] * Math.pow(tpvArr[i] - mean, 2);
  }
  const std = Math.sqrt(variance / cumVol);
  return { vwap: vwapVal, upperBand: vwapVal + 2 * std, lowerBand: vwapVal - 2 * std };
}

// ─── Ichimoku Cloud ───────────────────────────────────────────────────────────
export function ichimoku(
  highs: number[],
  lows: number[],
  closes: number[],
): {
  tenkan: number | null;
  kijun: number | null;
  senkouA: number | null;
  senkouB: number | null;
  chikou: number | null;
  cloudTop: number | null;
  cloudBottom: number | null;
  priceVsCloud: "ABOVE" | "BELOW" | "INSIDE";
  trend: "BULLISH" | "BEARISH" | "NEUTRAL";
} | null {
  if (closes.length < 52) return null;
  const mid = (arr: number[], start: number, end: number) => {
    const slice = arr.slice(start, end);
    return (Math.max(...slice) + Math.min(...slice)) / 2;
  };
  const n = closes.length;
  const tenkan = mid(highs.concat(lows), n - 9, n) !== mid(highs.concat(lows), n - 9, n)
    ? null
    : (Math.max(...highs.slice(n - 9)) + Math.min(...lows.slice(n - 9))) / 2;
  const kijun = (Math.max(...highs.slice(n - 26)) + Math.min(...lows.slice(n - 26))) / 2;
  const senkouA = tenkan !== null ? (tenkan + kijun) / 2 : null;
  const senkouB = (Math.max(...highs.slice(n - 52)) + Math.min(...lows.slice(n - 52))) / 2;
  const chikou = closes[n - 1];
  const cloudTop = senkouA !== null && senkouB !== null ? Math.max(senkouA, senkouB) : null;
  const cloudBottom = senkouA !== null && senkouB !== null ? Math.min(senkouA, senkouB) : null;
  const price = closes[n - 1];
  let priceVsCloud: "ABOVE" | "BELOW" | "INSIDE" = "INSIDE";
  if (cloudTop !== null && cloudBottom !== null) {
    if (price > cloudTop) priceVsCloud = "ABOVE";
    else if (price < cloudBottom) priceVsCloud = "BELOW";
  }
  const trend: "BULLISH" | "BEARISH" | "NEUTRAL" =
    priceVsCloud === "ABOVE" && tenkan !== null && kijun !== null && tenkan > kijun
      ? "BULLISH"
      : priceVsCloud === "BELOW" && tenkan !== null && kijun !== null && tenkan < kijun
      ? "BEARISH"
      : "NEUTRAL";
  return { tenkan, kijun, senkouA, senkouB, chikou, cloudTop, cloudBottom, priceVsCloud, trend };
}

// ─── WaveTrend Oscillator (Market Cipher B) ───────────────────────────────────
export function waveTrend(
  highs: number[],
  lows: number[],
  closes: number[],
  n1 = 10,
  n2 = 21,
): { wt1: number | null; wt2: number | null; cross: "BULLISH" | "BEARISH" | "NONE"; zone: "OVERBOUGHT" | "OVERSOLD" | "NEUTRAL" } | null {
  if (closes.length < n2 + 4) return null;
  const hlc3 = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
  const k = 2 / (n1 + 1);
  // EMA of hlc3
  let ema1 = hlc3.slice(0, n1).reduce((a, b) => a + b, 0) / n1;
  const ema1Arr: number[] = new Array(n1 - 1).fill(NaN);
  ema1Arr.push(ema1);
  for (let i = n1; i < hlc3.length; i++) {
    ema1 = hlc3[i] * k + ema1 * (1 - k);
    ema1Arr.push(ema1);
  }
  // EMA of abs(hlc3 - ema1)
  const diff = hlc3.map((v, i) => Math.abs(v - (ema1Arr[i] ?? v)));
  let ema2 = diff.slice(0, n1).reduce((a, b) => a + b, 0) / n1;
  const ema2Arr: number[] = new Array(n1 - 1).fill(NaN);
  ema2Arr.push(ema2);
  for (let i = n1; i < diff.length; i++) {
    ema2 = diff[i] * k + ema2 * (1 - k);
    ema2Arr.push(ema2);
  }
  const ci = hlc3.map((v, i) => {
    const e2 = ema2Arr[i];
    if (!e2 || isNaN(e2)) return 0;
    return (v - (ema1Arr[i] ?? v)) / (0.015 * e2);
  });
  // EMA of ci = wt1
  const k2 = 2 / (n2 + 1);
  let wt1val = ci.slice(0, n2).reduce((a, b) => a + b, 0) / n2;
  const wt1Arr: number[] = new Array(n2 - 1).fill(NaN);
  wt1Arr.push(wt1val);
  for (let i = n2; i < ci.length; i++) {
    wt1val = ci[i] * k2 + wt1val * (1 - k2);
    wt1Arr.push(wt1val);
  }
  // wt2 = SMA(wt1, 4)
  const wt1Last4 = wt1Arr.slice(-4).filter(v => !isNaN(v));
  const wt2val = wt1Last4.length === 4 ? wt1Last4.reduce((a, b) => a + b, 0) / 4 : null;
  const wt1Final = wt1Arr[wt1Arr.length - 1];
  const wt1Prev = wt1Arr[wt1Arr.length - 2];
  const wt2Prev = wt1Arr.slice(-5, -1).filter(v => !isNaN(v));
  const wt2PrevVal = wt2Prev.length === 4 ? wt2Prev.reduce((a, b) => a + b, 0) / 4 : null;
  let cross: "BULLISH" | "BEARISH" | "NONE" = "NONE";
  if (wt2val !== null && wt2PrevVal !== null) {
    if (wt1Prev < wt2PrevVal && wt1Final > wt2val) cross = "BULLISH";
    else if (wt1Prev > wt2PrevVal && wt1Final < wt2val) cross = "BEARISH";
  }
  const zone: "OVERBOUGHT" | "OVERSOLD" | "NEUTRAL" =
    wt1Final > 53 ? "OVERBOUGHT" : wt1Final < -53 ? "OVERSOLD" : "NEUTRAL";
  return { wt1: isNaN(wt1Final) ? null : wt1Final, wt2: wt2val, cross, zone };
}

// ─── Pivot Points (Classic) ───────────────────────────────────────────────────
export function pivotPoints(
  prevHigh: number,
  prevLow: number,
  prevClose: number,
): { pp: number; r1: number; r2: number; r3: number; s1: number; s2: number; s3: number } {
  const pp = (prevHigh + prevLow + prevClose) / 3;
  const r1 = 2 * pp - prevLow;
  const r2 = pp + (prevHigh - prevLow);
  const r3 = prevHigh + 2 * (pp - prevLow);
  const s1 = 2 * pp - prevHigh;
  const s2 = pp - (prevHigh - prevLow);
  const s3 = prevLow - 2 * (prevHigh - pp);
  return { pp, r1, r2, r3, s1, s2, s3 };
}

// ─── Order Flow Imbalance ─────────────────────────────────────────────────────
export function orderFlowImbalance(
  opens: number[],
  closes: number[],
  volumes: number[],
  period = 20,
): { buyPressure: number; sellPressure: number; imbalance: number; bias: "BUY" | "SELL" | "NEUTRAL" } | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const openSlice = opens.slice(-period);
  const volSlice = volumes.slice(-period);
  let buyVol = 0, sellVol = 0;
  for (let i = 0; i < slice.length; i++) {
    if (slice[i] >= openSlice[i]) buyVol += volSlice[i];
    else sellVol += volSlice[i];
  }
  const total = buyVol + sellVol;
  if (total === 0) return null;
  const imbalance = (buyVol - sellVol) / total;
  return {
    buyPressure: (buyVol / total) * 100,
    sellPressure: (sellVol / total) * 100,
    imbalance,
    bias: imbalance > 0.1 ? "BUY" : imbalance < -0.1 ? "SELL" : "NEUTRAL",
  };
}

// ─── Liquidation Heatmap Levels ───────────────────────────────────────────────
export function liquidationLevels(
  closes: number[],
  highs: number[],
  lows: number[],
  currentPrice: number,
  leverage = 10,
): { longLiqLevel: number; shortLiqLevel: number; densityAbove: string; densityBelow: string } {
  // Estimate liquidation clusters based on recent swing levels
  const n = Math.min(closes.length, 50);
  const recentHighs = highs.slice(-n);
  const recentLows = lows.slice(-n);
  const avgHigh = recentHighs.reduce((a, b) => a + b, 0) / n;
  const avgLow = recentLows.reduce((a, b) => a + b, 0) / n;
  // Long liq level: price where avg long position (entered near recent low) gets liquidated
  const longLiqLevel = avgLow * (1 - 1 / leverage);
  // Short liq level: price where avg short position (entered near recent high) gets liquidated
  const shortLiqLevel = avgHigh * (1 + 1 / leverage);
  const densityAbove = currentPrice < shortLiqLevel
    ? `High short liq cluster ~$${shortLiqLevel.toFixed(0)}`
    : "Above short liq zone";
  const densityBelow = currentPrice > longLiqLevel
    ? `High long liq cluster ~$${longLiqLevel.toFixed(0)}`
    : "Below long liq zone";
  return { longLiqLevel, shortLiqLevel, densityAbove, densityBelow };
}
