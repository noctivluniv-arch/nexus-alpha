/**
 * @module indicators/open-interest
 *
 * Open Interest Delta Analysis
 * ────────────────────────────
 * OI alone says nothing; it is the combination of OI direction and price
 * direction that tells the story. This module implements the classic
 * four-quadrant regime model and adds a rate-of-change filter to catch
 * sudden flush events before they fully play out.
 *
 * Four OI regimes
 * ───────────────
 * ┌───────────────┬──────────────┬──────────────────────────────────────┐
 * │ Price         │ OI           │ Interpretation                       │
 * ├───────────────┼──────────────┼──────────────────────────────────────┤
 * │ Rising        │ Rising       │ NEW LONGS entering — bullish          │
 * │ Rising        │ Falling      │ SHORT SQUEEZE / profit taking — fade  │
 * │ Falling       │ Rising       │ NEW SHORTS entering — bearish         │
 * │ Falling       │ Falling      │ LONG LIQUIDATION — potential reversal │
 * └───────────────┴──────────────┴──────────────────────────────────────┘
 *
 * Additional signals
 * ──────────────────
 * • OI spike (>2σ above mean): watch for volatility expansion
 * • OI bleed (falling >3 days consecutively): potential squeeze exhaustion
 */

import type { OHLCV, OISnapshot, IndicatorResult, Bias } from '../types/market'
import { sma, stdDev, percentChange, clamp } from '../utils/math'

export type OIRegime =
  | 'long_buildup'       // price ↑, OI ↑ — strongest bullish
  | 'short_squeeze'      // price ↑, OI ↓ — bullish but unsustainable
  | 'short_buildup'      // price ↓, OI ↑ — strongest bearish
  | 'long_liquidation'   // price ↓, OI ↓ — bearish but near reversal
  | 'neutral'

export interface OIResult extends IndicatorResult {
  regime: OIRegime
  /** Latest OI change % vs previous snapshot */
  oiChangePct: number
  /** Whether OI is at a statistically elevated level (> mean + 2σ) */
  isOISpike: boolean
  /** Whether OI has been falling for ≥ 3 consecutive periods */
  isOIBleed: boolean
  /** OI change % per period (aligned with snapshots) */
  oiChangeSeries: number[]
}

/**
 * Compute OI delta regime and return a scored IndicatorResult.
 *
 * @param candles   - OHLCV candles matching the OI snapshots (same timeframe)
 * @param snapshots - Chronological OI snapshots (oldest first)
 * @param lookback  - Number of periods used for mean/stddev baseline (default 20)
 */
export function computeOIDelta(
  candles: readonly OHLCV[],
  snapshots: readonly OISnapshot[],
  lookback = 20,
): OIResult {
  if (snapshots.length < lookback + 1 || candles.length < 2) {
    return insufficientData()
  }

  // Align: use the minimum common length
  const len = Math.min(candles.length, snapshots.length)
  const recentCandles = candles.slice(-len)
  const recentOI = snapshots.slice(-len)

  // ── 1. OI change series ──────────────────────────────────────────────────
  const oiValues = recentOI.map(s => s.openInterest)
  const oiChangeSeries = oiValues.map((v, i) =>
    i === 0 ? 0 : percentChange(oiValues[i - 1], v),
  )

  // ── 2. Statistical baseline ──────────────────────────────────────────────
  const baselineOI = oiValues.slice(-lookback)
  const meanOI = baselineOI.reduce((a, b) => a + b, 0) / baselineOI.length
  const sdOI = stdDev(baselineOI)
  const currentOI = oiValues[oiValues.length - 1]
  const isOISpike = currentOI > meanOI + 2 * sdOI

  // ── 3. OI bleed: falling for ≥ 3 consecutive periods ────────────────────
  const last3 = oiChangeSeries.slice(-3)
  const isOIBleed = last3.every(c => c < -0.3)

  // ── 4. Regime classification ─────────────────────────────────────────────
  const oiChangePct = oiChangeSeries[oiChangeSeries.length - 1]
  const priceChangePct = percentChange(
    recentCandles[recentCandles.length - 2].close,
    recentCandles[recentCandles.length - 1].close,
  )
  // Use a multi-period view (last 5 candles) for more stable classification
  const priceChangePct5 = percentChange(
    recentCandles[recentCandles.length - 6]?.close ?? recentCandles[0].close,
    recentCandles[recentCandles.length - 1].close,
  )
  const oiChange5 = percentChange(
    oiValues[oiValues.length - 6] ?? oiValues[0],
    currentOI,
  )

  const priceRising = priceChangePct5 > 0.1
  const oiRising = oiChange5 > 0.1

  let regime: OIRegime
  if (priceRising && oiRising) regime = 'long_buildup'
  else if (priceRising && !oiRising) regime = 'short_squeeze'
  else if (!priceRising && oiRising) regime = 'short_buildup'
  else if (!priceRising && !oiRising) regime = 'long_liquidation'
  else regime = 'neutral'

  // ── 5. Score ─────────────────────────────────────────────────────────────
  const regimeScore: Record<OIRegime, number> = {
    long_buildup: 80,
    short_squeeze: 62,  // bullish but less reliable
    neutral: 50,
    long_liquidation: 38,  // bearish but potential reversal
    short_buildup: 20,
  }
  let score = regimeScore[regime]

  // Modifier: spike + long_buildup = very strong
  if (isOISpike && regime === 'long_buildup') score = Math.min(100, score + 10)
  // Modifier: spike + short_buildup = very strong sell
  if (isOISpike && regime === 'short_buildup') score = Math.max(0, score - 10)
  // Modifier: bleed often precedes reversal
  if (isOIBleed && regime === 'short_buildup') score += 8

  score = clamp(score, 0, 100)
  const bias: Bias = score > 55 ? 'bullish' : score < 45 ? 'bearish' : 'neutral'

  const reasonParts = [
    `Regime: ${regime.replace('_', ' ')}`,
    `OI Δ5: ${oiChange5.toFixed(2)}%`,
    `Price Δ5: ${priceChangePct5.toFixed(2)}%`,
  ]
  if (isOISpike) reasonParts.push('OI spike detected')
  if (isOIBleed) reasonParts.push('OI bleed (≥3 periods)')

  return {
    score,
    bias,
    reason: reasonParts.join('; '),
    regime,
    oiChangePct,
    isOISpike,
    isOIBleed,
    oiChangeSeries,
  }
}

/**
 * Derive a synthetic OI series from OHLCV data when real OI is unavailable.
 * Uses volume as a proxy (not a substitute for real OI data — use only as fallback).
 */
export function syntheticOIFromVolume(candles: readonly OHLCV[]): OISnapshot[] {
  return candles.map((c, i) => {
    const baseOI = candles.slice(0, i + 1).reduce((acc, cv) => acc + cv.volume, 0)
    return {
      timestamp: c.timestamp,
      openInterest: baseOI,
      openInterestValue: baseOI * c.close,
    }
  })
}

function insufficientData(): OIResult {
  return {
    score: 50,
    bias: 'neutral',
    reason: 'Insufficient OI data',
    regime: 'neutral',
    oiChangePct: 0,
    isOISpike: false,
    isOIBleed: false,
    oiChangeSeries: [],
  }
}
