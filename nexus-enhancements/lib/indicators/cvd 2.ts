/**
 * @module indicators/cvd
 *
 * Cumulative Volume Delta (CVD)
 * ─────────────────────────────
 * CVD measures the net buying vs selling pressure embedded in OHLCV candles
 * using the volume-weighted midpoint method. It is especially powerful for
 * futures because it surfaces hidden absorption before price moves.
 *
 * Algorithm
 * ---------
 * Per candle:
 *   buyRatio  = (close - low) / (high - low)   → fraction of range closed bullish
 *   sellRatio = (high - close) / (high - low)  → fraction of range closed bearish
 *   delta     = (buyRatio - sellRatio) * volume
 *   (when high === low we treat the candle as neutral: delta = 0)
 *
 * CVD = rolling cumulative sum of delta values.
 *
 * Divergence signals
 * ------------------
 * • Bearish divergence: price makes higher high, CVD makes lower high
 *   → distribution; smart money selling into strength
 * • Bullish divergence: price makes lower low, CVD makes higher low
 *   → accumulation; smart money buying the dip
 *
 * Score mapping (0–100, bullish = high)
 * • 65–100: CVD trend aligned with price AND no negative divergence
 * • 50:     neutral / sideways CVD
 * • 0–35:   CVD opposing price, or active bearish divergence
 */

import type { OHLCV, IndicatorResult, Bias } from '../types/market'
import { detectDivergence, sma, clamp } from '../utils/math'

export interface CVDResult extends IndicatorResult {
  /** Full cumulative delta series aligned with candle indices */
  cumulativeDelta: number[]
  /** Per-candle raw delta values */
  delta: number[]
  /** Latest CVD value */
  currentCVD: number
  /** Direction of CVD trend over the last 20 candles */
  cvdTrend: 'rising' | 'falling' | 'flat'
  divergence: 'bullish' | 'bearish' | 'none'
}

const TREND_WINDOW = 20
const DIVERGENCE_LOOKBACK = 14

/**
 * Compute per-candle volume delta using the OHLCV approximation method.
 * Returns 0 for doji candles (high === low) to avoid division by zero.
 */
export function computeCandelDelta(candle: OHLCV): number {
  const range = candle.high - candle.low
  if (range === 0) return 0
  const buyRatio = (candle.close - candle.low) / range
  const sellRatio = (candle.high - candle.close) / range
  return (buyRatio - sellRatio) * candle.volume
}

/**
 * Compute the full CVD series and return a scored IndicatorResult.
 *
 * @param candles - OHLCV candles in chronological order (oldest first)
 * @param divergenceLookback - window for divergence detection (default 14)
 */
export function computeCVD(
  candles: readonly OHLCV[],
  divergenceLookback = DIVERGENCE_LOOKBACK,
): CVDResult {
  if (candles.length < divergenceLookback * 2 + 1) {
    return insufficientData()
  }

  // ── 1. Delta per candle ──────────────────────────────────────────────────
  const delta = candles.map(computeCandelDelta)

  // ── 2. Cumulative sum ────────────────────────────────────────────────────
  const cumulativeDelta: number[] = []
  let running = 0
  for (const d of delta) {
    running += d
    cumulativeDelta.push(running)
  }

  const currentCVD = cumulativeDelta[cumulativeDelta.length - 1]

  // ── 3. CVD trend: compare current 20-candle mean vs previous 20-candle mean
  const trendLen = Math.min(TREND_WINDOW, Math.floor(cumulativeDelta.length / 2))
  const recentMean =
    cumulativeDelta.slice(-trendLen).reduce((a, b) => a + b, 0) / trendLen
  const priorMean =
    cumulativeDelta.slice(-trendLen * 2, -trendLen).reduce((a, b) => a + b, 0) / trendLen
  const cvdTrend: 'rising' | 'falling' | 'flat' =
    recentMean > priorMean * 1.01
      ? 'rising'
      : recentMean < priorMean * 0.99
        ? 'falling'
        : 'flat'

  // ── 4. Divergence check ──────────────────────────────────────────────────
  const closes = candles.map(c => c.close)
  const divergence = detectDivergence(closes, cumulativeDelta, divergenceLookback)

  // ── 5. Score ─────────────────────────────────────────────────────────────
  const priceTrend = closes[closes.length - 1] > closes[closes.length - 1 - trendLen]
    ? 'rising'
    : 'falling'

  let score = 50
  // Alignment of CVD trend with price trend
  if (cvdTrend === 'rising' && priceTrend === 'rising') score += 20
  if (cvdTrend === 'falling' && priceTrend === 'falling') score -= 20
  if (cvdTrend === 'rising' && priceTrend === 'falling') score -= 10  // hidden strength
  if (cvdTrend === 'falling' && priceTrend === 'rising') score -= 15  // weakness hidden

  // Divergence bonus / penalty
  if (divergence === 'bullish') score += 20
  if (divergence === 'bearish') score -= 20

  // CVD absolute level relative to its own SMA (momentum confirmation)
  const cvdSma = sma(cumulativeDelta, 20)
  const cvdSmaLast = cvdSma[cvdSma.length - 1]
  if (!isNaN(cvdSmaLast)) {
    if (currentCVD > cvdSmaLast) score += 10
    else if (currentCVD < cvdSmaLast) score -= 10
  }

  score = clamp(score, 0, 100)
  const bias: Bias = score > 55 ? 'bullish' : score < 45 ? 'bearish' : 'neutral'

  const reasonParts: string[] = []
  reasonParts.push(`CVD trend: ${cvdTrend}`)
  if (divergence !== 'none') reasonParts.push(`${divergence} divergence detected`)
  reasonParts.push(`CVD vs SMA: ${currentCVD > (cvdSmaLast || 0) ? 'above' : 'below'}`)

  return {
    score,
    bias,
    reason: reasonParts.join('; '),
    cumulativeDelta,
    delta,
    currentCVD,
    cvdTrend,
    divergence,
  }
}

function insufficientData(): CVDResult {
  return {
    score: 50,
    bias: 'neutral',
    reason: 'Insufficient candle data for CVD calculation',
    cumulativeDelta: [],
    delta: [],
    currentCVD: 0,
    cvdTrend: 'flat',
    divergence: 'none',
  }
}
