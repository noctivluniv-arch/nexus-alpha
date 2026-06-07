/**
 * @module risk/position-sizer
 *
 * Dynamic Position Sizing
 * ───────────────────────
 * Three layers of position sizing are combined to produce the final
 * recommended fraction:
 *
 * 1. Fixed fractional baseline
 *    "Risk at most X% of account on this trade."
 *    Default max: 2%. Adjusted down by confluence quality.
 *
 * 2. Kelly Criterion (half-Kelly)
 *    Kelly fraction = (bp − q) / b
 *      b = RR ratio, p = win rate, q = 1 − p
 *    Half-Kelly is used because full Kelly is too aggressive in practice
 *    and produces excessive drawdowns from estimation error.
 *
 * 3. ATR volatility scalar
 *    When ATR is significantly above its 20-period mean (high volatility),
 *    the position is scaled DOWN to keep dollar risk constant.
 *    atrRatio = currentATR / meanATR
 *    If atrRatio > 1.5 → reduce position by (atrRatio − 1) × 50%
 *    If atrRatio < 0.8 → allow slight size increase (max +25%)
 *
 * Final recommendation = min(fixedFractional, halfKelly, atrAdjusted)
 *
 * Example
 * ───────
 * Account: $10,000 | Score: 75 | RR: 2.5 | WinRate: 0.60 | ATR normal
 *   fixedFractional = 0.015 (1.5% — slightly reduced from 2% due to score < 80)
 *   kelly           = (2.5×0.6 − 0.4) / 2.5 = 0.44 → halfKelly = 0.22
 *   atrAdjusted     = 0.015 (no adjustment — ATR normal)
 *   recommendation  = 0.015 (1.5% of account)
 *   In dollars: $150 of risk, position size depends on SL distance
 */

import type { OHLCV } from '../types/market'
import type { PositionSizeResult } from '../types/signal'
import { sma, clamp } from '../utils/math'

export interface PositionSizerInput {
  /** Confluence score 0–100 */
  confluenceScore: number
  /** Win rate (e.g. 0.55 = 55%) */
  winRate: number
  /** Risk-Reward ratio */
  riskRewardRatio: number
  /** OHLCV candles to compute ATR from */
  candles: readonly OHLCV[]
  /** Maximum fraction of account to risk. Default 0.02 (2%) */
  maxRiskFraction?: number
  /** ATR period for volatility measurement. Default 14 */
  atrPeriod?: number
}

/** Compute ATR (Average True Range) series using Wilder smoothing. */
export function computeATR(candles: readonly OHLCV[], period = 14): number[] {
  if (candles.length < period + 1) return candles.map(() => NaN)

  const tr: number[] = [NaN]
  for (let i = 1; i < candles.length; i++) {
    const hl = candles[i].high - candles[i].low
    const hcp = Math.abs(candles[i].high - candles[i - 1].close)
    const lcp = Math.abs(candles[i].low - candles[i - 1].close)
    tr.push(Math.max(hl, hcp, lcp))
  }

  // Wilder smoothing: initial seed is SMA of first `period` TRs
  const atr: number[] = new Array(candles.length).fill(NaN)
  let seed = 0
  let count = 0
  for (let i = 1; i <= period; i++) {
    if (!isNaN(tr[i])) { seed += tr[i]; count++ }
  }
  if (count === 0) return atr
  atr[period] = seed / count

  for (let i = period + 1; i < candles.length; i++) {
    if (isNaN(tr[i])) { atr[i] = atr[i - 1]; continue }
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period
  }
  return atr
}

/**
 * Compute Kelly fraction.
 * Returns 0 when the setup has negative EV (Kelly says "don't bet").
 */
export function computeKelly(winRate: number, riskReward: number): number {
  // f = (b*p - q) / b  where b=rr, p=win, q=lose
  const q = 1 - winRate
  const kelly = (riskReward * winRate - q) / riskReward
  return Math.max(0, kelly)
}

/**
 * Compute the recommended position size.
 */
export function computePositionSize(input: PositionSizerInput): PositionSizeResult {
  const {
    confluenceScore,
    winRate,
    riskRewardRatio,
    candles,
    maxRiskFraction = 0.02,
    atrPeriod = 14,
  } = input

  // ── 1. Fixed fractional (confidence-adjusted) ─────────────────────────
  // Scale max risk by confluence: score 70 → 0.80× max, score 90 → 1.0× max
  const confidenceScalar = clamp((confluenceScore - 50) / 50, 0, 1)
  const baseRiskFraction = maxRiskFraction * (0.6 + 0.4 * confidenceScalar)

  // ── 2. Kelly ──────────────────────────────────────────────────────────
  const fullKellyFraction = computeKelly(winRate, riskRewardRatio)
  const halfKellyFraction = fullKellyFraction / 2

  // Kelly is a capital fraction, not a risk fraction. Convert to equivalent
  // risk fraction assuming RR: riskFraction = kellyFraction / (1 + RR)
  // (because the position includes both risk capital and the potential gain)
  const kellyRiskEquivalent = halfKellyFraction / (1 + riskRewardRatio)

  // ── 3. ATR volatility adjustment ─────────────────────────────────────
  const atrSeries = computeATR(candles, atrPeriod)
  const validATR = atrSeries.filter(v => !isNaN(v))
  const currentATR = validATR[validATR.length - 1] ?? 0
  const meanATR = validATR.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, validATR.length)
  const atrRatio = meanATR > 0 ? currentATR / meanATR : 1

  let atrScalar = 1
  if (atrRatio > 1.5) {
    // Reduce size when volatility is elevated (max 50% reduction)
    atrScalar = clamp(1 - (atrRatio - 1) * 0.5, 0.5, 1)
  } else if (atrRatio < 0.8) {
    // Allow slight increase in low-volatility environments
    atrScalar = clamp(1 + (1 - atrRatio) * 0.25, 1, 1.25)
  }

  const atrAdjustedRiskFraction = baseRiskFraction * atrScalar

  // ── 4. Final: take the most conservative ─────────────────────────────
  const riskFraction = clamp(
    Math.min(baseRiskFraction, kellyRiskEquivalent > 0 ? kellyRiskEquivalent : baseRiskFraction, atrAdjustedRiskFraction),
    0.001,   // minimum 0.1% risk
    0.03,    // hard cap: never risk more than 3%
  )

  // Position fraction = riskFraction × (1 + RR) because position includes
  // the stop buffer. Simplified: positionSize = risk / stopDistancePct.
  // Without knowing exact stop % here, we express as risk multiple.
  const positionFraction = riskFraction * (1 + riskRewardRatio)

  // ── 5. Human-readable recommendation ──────────────────────────────────
  let recommendation: string
  if (confluenceScore < 70) {
    recommendation = `Score below threshold — consider skipping. If taking: risk ${(riskFraction * 100).toFixed(1)}% (half normal size).`
  } else if (atrRatio > 1.5) {
    recommendation = `High volatility (ATR ${atrRatio.toFixed(1)}× mean) — reduced to ${(riskFraction * 100).toFixed(1)}% risk. Standard would be ${(baseRiskFraction * 100 / atrScalar).toFixed(1)}%.`
  } else if (fullKellyFraction === 0) {
    recommendation = `Kelly says skip (negative EV). Risk no more than ${(riskFraction * 100).toFixed(1)}% if taking.`
  } else {
    recommendation = `Recommended risk: ${(riskFraction * 100).toFixed(1)}% of account. Half-Kelly equivalent: ${(halfKellyFraction * 100).toFixed(1)}% capital.`
  }

  return {
    riskFraction,
    positionFraction,
    fullKellyFraction,
    halfKellyFraction,
    atrAdjustedRiskFraction,
    atrRatio,
    recommendation,
  }
}

/**
 * Given an account balance and the position sizing result, compute the
 * concrete dollar amounts for a trade.
 *
 * @param accountBalance   - Total account equity in USD
 * @param sizing           - Result from computePositionSize
 * @param entryPrice       - Intended entry price
 * @param stopLossPrice    - Stop loss price (used to compute position size)
 */
export function computePositionDollars(
  accountBalance: number,
  sizing: PositionSizeResult,
  entryPrice: number,
  stopLossPrice: number,
): {
  dollarRisk: number
  positionSizeUsd: number
  positionSizeCoins: number
  stopDistancePct: number
} {
  const dollarRisk = accountBalance * sizing.riskFraction
  const stopDistancePct = Math.abs(entryPrice - stopLossPrice) / entryPrice
  const positionSizeUsd = stopDistancePct > 0 ? dollarRisk / stopDistancePct : 0
  const positionSizeCoins = positionSizeUsd / entryPrice

  return { dollarRisk, positionSizeUsd, positionSizeCoins, stopDistancePct }
}
