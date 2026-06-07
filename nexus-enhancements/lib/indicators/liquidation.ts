/**
 * @module indicators/liquidation
 *
 * Liquidation Zone Analysis
 * ─────────────────────────
 * Futures markets accumulate leveraged positions at key levels. When price
 * approaches a dense cluster of liquidations it acts as a "magnet" — often
 * price will hunt that level to trigger stop cascades before reversing.
 *
 * Two use-cases for signals:
 *   1. Target alignment: if the nearest large liquidation cluster is in the
 *      direction of our trade, it strengthens the TP expectation.
 *   2. Stop placement: our stop should sit BEYOND the nearest opposing-side
 *      liquidation cluster to avoid being swept by the hunt.
 *
 * Data source: Coinglass /api/pro/v1/futures/liquidation/chart
 * (When live data is unavailable the module falls back to an estimation
 * model based on OI distribution and current leverage assumptions.)
 *
 * Estimation model (fallback)
 * ───────────────────────────
 * Assuming normally distributed leverage between 2x–125x:
 *   • 10x cluster ≈ ±10% from current price
 *   • 25x cluster ≈ ±4%
 *   • 50x cluster ≈ ±2%
 *   • 100x cluster ≈ ±1%
 * Each cluster size is estimated from OI * assumed_leverage_distribution.
 */

import type { LiquidationLevel, IndicatorResult, Bias, OHLCV } from '../types/market'
import { clamp } from '../utils/math'

export interface LiquidationResult extends IndicatorResult {
  /** Nearest liquidation cluster on the upside */
  nearestLong: LiquidationLevel | null
  /** Nearest liquidation cluster on the downside */
  nearestShort: LiquidationLevel | null
  /** Clusters sorted by estimated USD value descending */
  topClusters: LiquidationLevel[]
  /** Is the nearest large cluster in the direction of a trade? */
  magnetAligned: boolean
}

/**
 * Analyse a set of liquidation levels relative to current price.
 *
 * @param currentPrice - Latest close price
 * @param levels       - Liquidation levels (from Coinglass or estimation)
 * @param tradeDirection - 'long' or 'short' to check magnet alignment
 * @param minClusterUsd  - Minimum USD value to consider a level significant
 */
export function analyseLiquidations(
  currentPrice: number,
  levels: readonly LiquidationLevel[],
  tradeDirection: 'long' | 'short' = 'long',
  minClusterUsd = 1_000_000,
): LiquidationResult {
  if (levels.length === 0) {
    return noData(currentPrice)
  }

  // Filter significant clusters only
  const significant = levels
    .filter(l => l.estimatedUsd >= minClusterUsd)
    .sort((a, b) => b.estimatedUsd - a.estimatedUsd)

  const topClusters = significant.slice(0, 10)

  const aboveClusters = significant.filter(l => l.price > currentPrice)
  const belowClusters = significant.filter(l => l.price < currentPrice)

  const nearestLong = aboveClusters.length > 0
    ? aboveClusters.reduce((a, b) => a.price < b.price ? a : b)
    : null
  const nearestShort = belowClusters.length > 0
    ? belowClusters.reduce((a, b) => a.price > b.price ? a : b)
    : null

  // ── Magnet alignment ──────────────────────────────────────────────────
  // For a long trade: is the nearest large cluster ABOVE (price will hunt it)?
  const magnetTarget = tradeDirection === 'long' ? nearestLong : nearestShort
  const magnetAligned = magnetTarget !== null && magnetTarget.estimatedUsd >= minClusterUsd * 5

  // ── Score ─────────────────────────────────────────────────────────────
  // Score from perspective of the long side (>50 = helpful for longs)
  let score = 50

  if (nearestLong && nearestShort) {
    // If the nearest long liquidation cluster is larger → price likely hunts up
    if (nearestLong.estimatedUsd > nearestShort.estimatedUsd) score += 15
    else score -= 15

    // Distance: closer cluster = stronger magnet
    const upDist = nearestLong.distancePct
    const downDist = nearestShort.distancePct
    if (upDist < downDist) score += 10
    else score -= 10
  }

  if (magnetAligned && tradeDirection === 'long') score += 15
  if (magnetAligned && tradeDirection === 'short') score -= 15

  score = clamp(score, 0, 100)
  const bias: Bias = score > 55 ? 'bullish' : score < 45 ? 'bearish' : 'neutral'

  const parts: string[] = []
  if (nearestLong) parts.push(`Nearest long liq: $${nearestLong.price.toFixed(0)} (+${nearestLong.distancePct.toFixed(1)}%)`)
  if (nearestShort) parts.push(`Nearest short liq: $${nearestShort.price.toFixed(0)} (-${nearestShort.distancePct.toFixed(1)}%)`)
  if (magnetAligned) parts.push(`Magnet aligned with ${tradeDirection}`)

  return {
    score,
    bias,
    reason: parts.join('; ') || 'No significant liquidation clusters',
    nearestLong,
    nearestShort,
    topClusters,
    magnetAligned,
  }
}

/**
 * Estimate liquidation levels from OI data when Coinglass is unavailable.
 * Modelling assumptions:
 *   • OI is split 50/50 between longs and shorts
 *   • Leverage distribution: 20% at 10x, 30% at 25x, 30% at 50x, 20% at 100x
 *
 * @param currentPrice   - Latest close price
 * @param totalOIUsd     - Total open interest in USD
 */
export function estimateLiquidationLevels(
  currentPrice: number,
  totalOIUsd: number,
): LiquidationLevel[] {
  const leverageBuckets: Array<{ leverage: number; share: number }> = [
    { leverage: 10, share: 0.2 },
    { leverage: 25, share: 0.3 },
    { leverage: 50, share: 0.3 },
    { leverage: 100, share: 0.2 },
  ]

  const levels: LiquidationLevel[] = []
  const halfOI = totalOIUsd / 2  // longs and shorts split

  for (const { leverage, share } of leverageBuckets) {
    const distancePct = (1 / leverage) * 100
    const usd = halfOI * share

    // Long liquidation below current price
    levels.push({
      price: currentPrice * (1 - distancePct / 100),
      estimatedUsd: usd,
      side: 'long',
      distancePct,
    })

    // Short liquidation above current price
    levels.push({
      price: currentPrice * (1 + distancePct / 100),
      estimatedUsd: usd,
      side: 'short',
      distancePct,
    })
  }

  return levels
}

function noData(currentPrice: number): LiquidationResult {
  return {
    score: 50,
    bias: 'neutral',
    reason: 'No liquidation data available',
    nearestLong: null,
    nearestShort: null,
    topClusters: [],
    magnetAligned: false,
  }
}
