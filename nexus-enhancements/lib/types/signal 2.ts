/**
 * @module types/signal
 * Signal output and risk management types.
 */

import type { Bias, IndicatorResult } from './market'

/** Full breakdown of the enhanced 105-point confluence score */
export interface ConfluenceBreakdown {
  /** EMA stack + MTF alignment — max 20 */
  trend: IndicatorResult
  /** RSI + StochRSI + CVD divergence — max 20 */
  confluence: IndicatorResult
  /** S/R + Fib + Volume Profile POC + nearest liquidation zone — max 20 */
  supportResistance: IndicatorResult
  /** OBV + CVD trend + volume ratio — max 15 */
  volume: IndicatorResult
  /** OI delta regime interpretation — max 10 */
  openInterest: IndicatorResult
  /** Funding rate + Fear & Greed index — max 10 */
  sentiment: IndicatorResult
  /** BTC dominance context — max 5 */
  macro: IndicatorResult
  /** Reversal candle pattern at a key level — max 5 bonus */
  patternBonus: IndicatorResult
  /** Raw sum before capping (can exceed 100) */
  rawTotal: number
  /** Final capped score 0–100 */
  total: number
  /** Whether the signal clears the minimum threshold (≥70) */
  isValid: boolean
  overallBias: Bias
}

/** A fully processed trade setup with risk parameters */
export interface TradeSetup {
  symbol: string
  direction: 'long' | 'short'
  confidence: ConfluenceBreakdown
  entry: { low: number; high: number }
  stopLoss: number
  targets: Array<{ price: number; riskReward: number }>
  /** Nearest significant liquidation cluster */
  liquidationMagnet?: { price: number; side: 'long' | 'short'; distancePct: number }
  /** Recommended position size as fraction of account */
  recommendedSizeFraction: number
  expectedValue: EVResult
  timestamp: number
}

// ─── Risk types ──────────────────────────────────────────────────────────────

/** Expected Value calculation output */
export interface EVResult {
  /** EV expressed in units of R (1R = amount risked) */
  evPerR: number
  /** Minimum win rate required for this setup to be EV-positive */
  breakEvenWinRate: number
  /** Win rate at which this setup was evaluated */
  assumedWinRate: number
  riskRewardRatio: number
  /** Qualitative grade: A+ ≥ 0.5R, A ≥ 0.3R, B ≥ 0.1R, C < 0.1R, F < 0 */
  grade: 'A+' | 'A' | 'B' | 'C' | 'F'
  /** Plain-language summary */
  summary: string
}

/** Position sizing recommendation */
export interface PositionSizeResult {
  /** Fraction of account equity to risk (e.g. 0.015 = 1.5%) */
  riskFraction: number
  /** Fraction of account to allocate as position notional */
  positionFraction: number
  /** Full Kelly fraction (for reference — never use raw Kelly) */
  fullKellyFraction: number
  /** Half-Kelly fraction (recommended) */
  halfKellyFraction: number
  /** ATR-adjusted risk (may be lower than base when volatility is high) */
  atrAdjustedRiskFraction: number
  /** Current ATR relative to its 20-period mean (>1.5 = high volatility) */
  atrRatio: number
  /** Human-readable sizing advice */
  recommendation: string
}
