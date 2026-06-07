/**
 * @module risk/ev-calculator
 *
 * Expected Value (EV) Calculator
 * ───────────────────────────────
 * EV is the single most important number for long-term profitability.
 * A system can be correct only 40% of the time and still grow an account
 * exponentially — provided EV per trade is sufficiently positive.
 *
 * Core formula
 * ────────────
 *   EV = (winRate × avgWin) − (lossRate × avgLoss)
 *
 * Expressed in R-multiples (1R = amount risked):
 *   EV/R = (winRate × RR) − (1 − winRate)
 *
 * Where RR = Risk-Reward ratio (e.g. 2.5 means target is 2.5× the stop).
 *
 * Break-even win rate
 * ───────────────────
 *   breakEven = 1 / (1 + RR)
 *   e.g. RR 2.5 → breakEven = 28.6%  (very forgiving)
 *        RR 1.0 → breakEven = 50%
 *
 * Grade thresholds (per-R)
 * ────────────────────────
 *   A+ : EV ≥ 0.5R   (exceptional — keep trading this setup)
 *   A  : EV ≥ 0.3R   (strong edge)
 *   B  : EV ≥ 0.1R   (positive edge — acceptable)
 *   C  : EV ≥ 0.0R   (marginal — only trade in ideal conditions)
 *   F  : EV < 0.0R   (do not take — negative expectancy)
 */

import type { EVResult } from '../types/signal'
import { clamp } from '../utils/math'

export interface EVInput {
  /** Risk-Reward ratio at primary target (TP1) */
  riskRewardRatio: number
  /**
   * Win rate to use for the calculation.
   * When not provided, it is estimated from the confluence score using
   * the empirical curve: winRate ≈ 0.2 + 0.6 × (score/100)
   */
  winRate?: number
  /**
   * Confluence score 0–100 used to estimate win rate when `winRate` is omitted.
   * Higher confluence → better win rate estimate.
   */
  confluenceScore?: number
}

/**
 * Estimate win rate from a confluence score using an empirical sigmoid curve.
 * At score=50 → ~50% win rate.
 * At score=80 → ~68% win rate.
 * At score=30 → ~38% win rate.
 */
export function estimateWinRate(confluenceScore: number): number {
  const s = clamp(confluenceScore, 0, 100) / 100
  // Sigmoid-shaped curve bounded [0.20, 0.80]
  return 0.20 + 0.60 * s
}

/**
 * Compute Expected Value for a trade setup.
 */
export function computeEV(input: EVInput): EVResult {
  const { riskRewardRatio, confluenceScore } = input

  if (riskRewardRatio <= 0) {
    throw new RangeError(`riskRewardRatio must be > 0, got ${riskRewardRatio}`)
  }

  const winRate = input.winRate ?? estimateWinRate(confluenceScore ?? 50)
  const lossRate = 1 - winRate

  // EV in R-multiples
  const evPerR = winRate * riskRewardRatio - lossRate * 1

  // Break-even win rate for this RR
  const breakEvenWinRate = 1 / (1 + riskRewardRatio)

  // Grade
  const grade: EVResult['grade'] =
    evPerR >= 0.5 ? 'A+' :
    evPerR >= 0.3 ? 'A'  :
    evPerR >= 0.1 ? 'B'  :
    evPerR >= 0   ? 'C'  : 'F'

  const evStr = evPerR >= 0
    ? `+${evPerR.toFixed(2)}R`
    : `${evPerR.toFixed(2)}R`

  const summary = [
    `EV = ${evStr} per trade`,
    `Win rate used: ${(winRate * 100).toFixed(0)}% (break-even: ${(breakEvenWinRate * 100).toFixed(0)}%)`,
    `R:R = 1:${riskRewardRatio.toFixed(1)}`,
    grade === 'F'
      ? '⚠ Do NOT take — negative expectancy'
      : `Grade ${grade} — ${gradeComment(grade)}`,
  ].join(' | ')

  return {
    evPerR,
    breakEvenWinRate,
    assumedWinRate: winRate,
    riskRewardRatio,
    grade,
    summary,
  }
}

/**
 * Compute EV across multiple TP targets and return the blended result.
 * Useful when scaling out (e.g. 50% at TP1, 30% at TP2, 20% at TP3).
 *
 * @param targets   - Array of { rr, fraction } where fraction sums to 1
 * @param winRate   - Assumed win rate for all targets
 */
export function computeBlendedEV(
  targets: Array<{ rr: number; fraction: number }>,
  winRate: number,
): EVResult {
  const totalFraction = targets.reduce((a, b) => a + b.fraction, 0)
  if (Math.abs(totalFraction - 1) > 0.001) {
    throw new Error(`Target fractions must sum to 1.0, got ${totalFraction.toFixed(3)}`)
  }

  // Weighted average RR
  const blendedRR = targets.reduce((acc, t) => acc + t.rr * t.fraction, 0)
  return computeEV({ riskRewardRatio: blendedRR, winRate })
}

/**
 * How many consecutive losses can you sustain before your account drops below
 * a given percentage threshold?
 *
 * @param riskPerTrade - Fraction of account risked per trade (e.g. 0.02 = 2%)
 * @param drawdownLimit - Maximum acceptable drawdown fraction (e.g. 0.20 = 20%)
 */
export function maxConsecutiveLosses(
  riskPerTrade: number,
  drawdownLimit = 0.20,
): number {
  if (riskPerTrade <= 0 || riskPerTrade >= 1) {
    throw new RangeError('riskPerTrade must be in (0, 1)')
  }
  // Account after n losses: (1 - risk)^n ≥ (1 - drawdownLimit)
  return Math.floor(Math.log(1 - drawdownLimit) / Math.log(1 - riskPerTrade))
}

function gradeComment(grade: EVResult['grade']): string {
  switch (grade) {
    case 'A+': return 'Exceptional edge — size up within risk rules'
    case 'A':  return 'Strong edge'
    case 'B':  return 'Positive edge — standard sizing'
    case 'C':  return 'Marginal — reduce size or wait for better confluence'
    default:   return ''
  }
}
