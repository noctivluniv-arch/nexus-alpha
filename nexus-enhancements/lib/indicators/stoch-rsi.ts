/**
 * @module indicators/stoch-rsi
 *
 * Stochastic RSI (%K / %D)
 * ─────────────────────────
 * StochRSI applies the Stochastic oscillator formula to RSI values rather
 * than raw price. This makes it significantly more sensitive to momentum
 * changes than plain RSI — especially valuable in ranging / low-volatility
 * markets where RSI can stay neutral for extended periods.
 *
 * Algorithm
 * ---------
 * 1. Compute RSI(rsiPeriod) over the closes
 * 2. StochRSI = (RSI - min(RSI, stochPeriod)) / (max(RSI) - min(RSI))
 *    over the rolling stochPeriod window
 * 3. %K = SMA(StochRSI, smoothK)   — fast line
 * 4. %D = SMA(%K, smoothD)         — slow signal line
 *
 * Default parameters (match TradingView):
 *   rsiPeriod = 14, stochPeriod = 14, smoothK = 3, smoothD = 3
 *
 * Signal rules used for scoring
 * ─────────────────────────────
 * • Buy signal  : %K crosses above %D while both < 20 (oversold crossover)
 * • Sell signal : %K crosses below %D while both > 80 (overbought crossover)
 * • Extreme zones add weight when aligned with trend
 */

import type { OHLCV, IndicatorResult, Bias } from '../types/market'
import { ema, rollingMax, rollingMin, sma, clamp, hasSufficientData } from '../utils/math'

export interface StochRSIResult extends IndicatorResult {
  /** %K line values (fast) */
  k: number[]
  /** %D line values (slow signal) */
  d: number[]
  /** Latest %K value 0–100 */
  currentK: number
  /** Latest %D value 0–100 */
  currentD: number
  /** Is a fresh crossover occurring at the current bar? */
  crossover: 'bullish' | 'bearish' | 'none'
  /** Condition of the most recent reading */
  zone: 'oversold' | 'overbought' | 'neutral'
}

export interface StochRSIParams {
  rsiPeriod?: number
  stochPeriod?: number
  smoothK?: number
  smoothD?: number
}

const DEFAULTS: Required<StochRSIParams> = {
  rsiPeriod: 14,
  stochPeriod: 14,
  smoothK: 3,
  smoothD: 3,
}

/**
 * Compute RSI series using Wilder's smoothing method.
 * Returns array aligned with `closes` — leading values are NaN.
 */
export function computeRSI(closes: readonly number[], period: number): number[] {
  if (closes.length < period + 1) return closes.map(() => NaN)

  const gains: number[] = [NaN]
  const losses: number[] = [NaN]
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    gains.push(diff > 0 ? diff : 0)
    losses.push(diff < 0 ? -diff : 0)
  }

  const avgGain = ema(gains.slice(1), period, true)
  const avgLoss = ema(losses.slice(1), period, true)
  const rsi: number[] = [NaN]

  for (let i = 0; i < avgGain.length; i++) {
    if (isNaN(avgGain[i]) || isNaN(avgLoss[i])) {
      rsi.push(NaN)
    } else if (avgLoss[i] === 0) {
      rsi.push(100)
    } else {
      const rs = avgGain[i] / avgLoss[i]
      rsi.push(100 - 100 / (1 + rs))
    }
  }
  return rsi
}

/**
 * Compute StochRSI and return a scored IndicatorResult.
 *
 * @param candles - OHLCV candles in chronological order (oldest first)
 * @param params  - Optional parameter overrides
 */
export function computeStochRSI(
  candles: readonly OHLCV[],
  params: StochRSIParams = {},
): StochRSIResult {
  const { rsiPeriod, stochPeriod, smoothK, smoothD } = { ...DEFAULTS, ...params }
  const minRequired = rsiPeriod + stochPeriod + smoothK + smoothD + 5

  if (candles.length < minRequired) {
    return insufficientData()
  }

  const closes = candles.map(c => c.close)

  // ── 1. RSI ───────────────────────────────────────────────────────────────
  const rsiValues = computeRSI(closes, rsiPeriod)

  // ── 2. Stochastic of RSI ─────────────────────────────────────────────────
  const rsiMax = rollingMax(rsiValues, stochPeriod)
  const rsiMin = rollingMin(rsiValues, stochPeriod)
  const rawStoch = rsiValues.map((v, i) => {
    const range = rsiMax[i] - rsiMin[i]
    if (isNaN(v) || isNaN(rsiMax[i])) return NaN
    // When RSI is constant over the window (saturated trend), assign extreme values
    // rather than NaN to prevent the entire k/d pipeline from collapsing.
    if (range === 0) return v >= 50 ? 100 : 0
    return ((v - rsiMin[i]) / range) * 100
  })

  // ── 3. %K and %D smoothing ───────────────────────────────────────────────
  const kLine = sma(rawStoch, smoothK)
  const dLine = sma(kLine, smoothD)

  const currentK = kLine[kLine.length - 1]
  const currentD = dLine[dLine.length - 1]
  const prevK = kLine[kLine.length - 2]
  const prevD = dLine[dLine.length - 2]

  if (!hasSufficientData(kLine, 2) || !hasSufficientData(dLine, 2)) {
    return insufficientData()
  }

  // ── 4. Crossover detection ───────────────────────────────────────────────
  const crossover: 'bullish' | 'bearish' | 'none' =
    prevK <= prevD && currentK > currentD
      ? 'bullish'
      : prevK >= prevD && currentK < currentD
        ? 'bearish'
        : 'none'

  const zone: 'oversold' | 'overbought' | 'neutral' =
    currentK < 20 ? 'oversold' : currentK > 80 ? 'overbought' : 'neutral'

  // ── 5. Score ─────────────────────────────────────────────────────────────
  let score = 50

  // Raw position of %K
  score += (currentK - 50) * 0.4  // −20 to +20

  // Crossover signals
  if (crossover === 'bullish' && zone === 'oversold') score += 20
  if (crossover === 'bullish') score += 10
  if (crossover === 'bearish' && zone === 'overbought') score -= 20
  if (crossover === 'bearish') score -= 10

  // %K above/below %D (trend direction within StochRSI)
  if (currentK > currentD) score += 5
  else score -= 5

  score = clamp(score, 0, 100)
  const bias: Bias = score > 55 ? 'bullish' : score < 45 ? 'bearish' : 'neutral'

  const reasonParts: string[] = [
    `%K=${currentK.toFixed(1)} %D=${currentD.toFixed(1)}`,
    `Zone: ${zone}`,
  ]
  if (crossover !== 'none') reasonParts.push(`${crossover} crossover`)

  return {
    score,
    bias,
    reason: reasonParts.join('; '),
    k: kLine,
    d: dLine,
    currentK,
    currentD,
    crossover,
    zone,
  }
}

function insufficientData(): StochRSIResult {
  return {
    score: 50,
    bias: 'neutral',
    reason: 'Insufficient candle data for StochRSI calculation',
    k: [],
    d: [],
    currentK: 50,
    currentD: 50,
    crossover: 'none',
    zone: 'neutral',
  }
}
