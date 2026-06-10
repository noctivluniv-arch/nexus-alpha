/**
 * @module utils/math
 * Pure mathematical utilities used by all indicator modules.
 * Every function here is stateless and deterministic.
 */

/**
 * Simple Moving Average over the last `period` values.
 * Returns NaN for positions where there is insufficient history.
 */
export function sma(values: readonly number[], period: number): number[] {
  if (period <= 0) throw new RangeError(`period must be > 0, got ${period}`)
  return values.map((_, i) => {
    if (i < period - 1) return NaN
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += values[j]
    return sum / period
  })
}

/**
 * Exponential Moving Average.
 * Uses Wilder smoothing when `wilder = true` (multiplier = 1/period),
 * standard EMA otherwise (multiplier = 2/(period+1)).
 */
export function ema(
  values: readonly number[],
  period: number,
  wilder = false,
): number[] {
  if (period <= 0) throw new RangeError(`period must be > 0, got ${period}`)
  const k = wilder ? 1 / period : 2 / (period + 1)
  const result: number[] = new Array(values.length).fill(NaN)
  // Seed with SMA of the first `period` values
  let seed = 0
  for (let i = 0; i < period; i++) seed += values[i]
  result[period - 1] = seed / period
  for (let i = period; i < values.length; i++) {
    result[i] = values[i] * k + result[i - 1] * (1 - k)
  }
  return result
}

/**
 * Rolling maximum over a sliding window of `period` length.
 */
export function rollingMax(values: readonly number[], period: number): number[] {
  return values.map((_, i) => {
    if (i < period - 1) return NaN
    let max = -Infinity
    for (let j = i - period + 1; j <= i; j++) {
      if (values[j] > max) max = values[j]
    }
    return max
  })
}

/**
 * Rolling minimum over a sliding window of `period` length.
 */
export function rollingMin(values: readonly number[], period: number): number[] {
  return values.map((_, i) => {
    if (i < period - 1) return NaN
    let min = Infinity
    for (let j = i - period + 1; j <= i; j++) {
      if (values[j] < min) min = values[j]
    }
    return min
  })
}

/**
 * Population standard deviation.
 */
export function stdDev(values: readonly number[]): number {
  if (values.length === 0) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

/** Clamp a value between [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Percentage change from `from` to `to`. */
export function percentChange(from: number, to: number): number {
  if (from === 0) return 0
  return ((to - from) / Math.abs(from)) * 100
}

/**
 * Normalise a value in [dataMin, dataMax] to [outMin, outMax].
 * Returns outMin when the range collapses (dataMin === dataMax).
 */
export function normalise(
  value: number,
  dataMin: number,
  dataMax: number,
  outMin = 0,
  outMax = 100,
): number {
  if (dataMax === dataMin) return outMin
  return outMin + ((value - dataMin) / (dataMax - dataMin)) * (outMax - outMin)
}

/**
 * Detect divergence between price and a momentum series over the last N candles.
 * Returns:
 *   'bullish'  — price lower low, momentum higher low (hidden strength)
 *   'bearish'  — price higher high, momentum lower high (hidden weakness)
 *   'none'
 */
export function detectDivergence(
  prices: readonly number[],
  momentum: readonly number[],
  lookback = 14,
): 'bullish' | 'bearish' | 'none' {
  const n = prices.length
  if (n < lookback + 1) return 'none'
  const recent = prices.slice(-lookback)
  const mRecent = momentum.slice(-lookback)
  const priceMin = Math.min(...recent)
  const priceMax = Math.max(...recent)
  const mMin = Math.min(...mRecent)
  const mMax = Math.max(...mRecent)
  const prevPriceMin = Math.min(...prices.slice(-(lookback * 2), -lookback))
  const prevPriceMax = Math.max(...prices.slice(-(lookback * 2), -lookback))
  const prevMMin = Math.min(...momentum.slice(-(lookback * 2), -lookback))
  const prevMMax = Math.max(...momentum.slice(-(lookback * 2), -lookback))

  // Bullish: price makes lower low but momentum does NOT
  if (priceMin < prevPriceMin && mMin > prevMMin) return 'bullish'
  // Bearish: price makes higher high but momentum does NOT
  if (priceMax > prevPriceMax && mMax < prevMMax) return 'bearish'
  return 'none'
}

/**
 * Check if an array has enough valid (non-NaN) tail values.
 */
export function hasSufficientData(values: readonly number[], required: number): boolean {
  const tail = values.slice(-required)
  return tail.length === required && tail.every(v => !isNaN(v) && isFinite(v))
}
