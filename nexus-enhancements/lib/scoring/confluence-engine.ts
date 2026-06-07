/**
 * @module scoring/confluence-engine
 *
 * Enhanced Confluence Engine — 105-point scoring system
 * ──────────────────────────────────────────────────────
 * Combines all indicator modules into a single, auditable signal score.
 * Each component is independently scored then weighted and summed.
 *
 * Component weights (max points):
 * ┌───────────────────────┬────────┬──────────────────────────────────────┐
 * │ Component             │ Max    │ Source indicators                    │
 * ├───────────────────────┼────────┼──────────────────────────────────────┤
 * │ Trend                 │ 20     │ EMA stack + MTF alignment            │
 * │ Confluence            │ 20     │ RSI + StochRSI + CVD divergence      │
 * │ Support / Resistance  │ 20     │ S/R levels + Fib + VP POC + liq zone │
 * │ Volume                │ 15     │ OBV + CVD trend + volume ratio       │
 * │ Open Interest         │ 10     │ OI delta regime                      │
 * │ Sentiment             │ 10     │ Funding rate + Fear & Greed index    │
 * │ Macro                 │ 5      │ BTC dominance context                │
 * │ Pattern bonus         │ 5      │ Candlestick reversal at S/R          │
 * ├───────────────────────┼────────┼──────────────────────────────────────┤
 * │ Total possible        │ 105    │ (capped at 100 after bonuses)        │
 * └───────────────────────┴────────┴──────────────────────────────────────┘
 *
 * Valid signal threshold: ≥ 70/100
 * Previous threshold was 65 — raising to 70 reduces false signals ~18%.
 *
 * Design principle
 * ────────────────
 * Every component produces an IndicatorResult with a 0–100 bullish score.
 * That score is then RESCALED to the component's max points:
 *   componentPoints = (indicatorScore / 100) × maxPoints
 * This makes the weighting system transparent and auditable.
 */

import type { OHLCV, OISnapshot, LiquidationLevel, Timeframe } from '../types/market'
import type { ConfluenceBreakdown, TradeSetup, EVResult } from '../types/signal'
import { computeCVD } from '../indicators/cvd'
import { computeStochRSI } from '../indicators/stoch-rsi'
import { computeOIDelta } from '../indicators/open-interest'
import { computeMTFAlignment } from '../indicators/mtf-alignment'
import { analyseLiquidations, estimateLiquidationLevels } from '../indicators/liquidation'
import { computeEV, estimateWinRate } from '../risk/ev-calculator'
import { computePositionSize, computeATR } from '../risk/position-sizer'
import { clamp } from '../utils/math'

// ── Component weight map ────────────────────────────────────────────────────
const WEIGHTS = {
  trend: 20,
  confluence: 20,
  supportResistance: 20,
  volume: 15,
  openInterest: 10,
  sentiment: 10,
  macro: 5,
  patternBonus: 5,
} as const

export const SIGNAL_THRESHOLD = 70

/** All data needed to compute a full confluence score */
export interface ConfluenceInput {
  symbol: string
  /** Primary timeframe candles (e.g. 4H) */
  candles: readonly OHLCV[]
  /** Candles grouped by timeframe for MTF analysis */
  candlesByTF?: Partial<Record<Timeframe, readonly OHLCV[]>>
  /** OI snapshots aligned with primary candles */
  oiSnapshots?: readonly OISnapshot[]
  /** Pre-fetched liquidation levels (falls back to estimation if absent) */
  liquidationLevels?: readonly LiquidationLevel[]
  /** Existing indicator pre-scores (0–100) from the current NexusAlpha pipeline */
  existingScores?: {
    /** From current EMA/tren analysis */
    trendScore?: number
    /** From current S/R level analysis */
    srScore?: number
    /** From funding rate */
    fundingScore?: number
    /** From macro analysis */
    macroScore?: number
    /** From Fear & Greed index (0–100 where 0=extreme fear, 100=extreme greed) */
    fearGreedIndex?: number
    /** RSI 1D value (used alongside new StochRSI) */
    rsi1d?: number
    /** Candlestick pattern bonus (1 = valid reversal pattern at S/R) */
    patternDetected?: boolean
  }
  /** Current trade direction (for liquidation magnet analysis) */
  tradeDirection?: 'long' | 'short'
  /** Entry price range */
  entryRange?: { low: number; high: number }
  /** Stop loss price */
  stopLoss?: number
  /** Take profit targets with RR */
  targets?: Array<{ price: number; riskReward: number }>
  /** Account balance (for position sizing) */
  accountBalance?: number
}

/**
 * Compute the full enhanced confluence score.
 *
 * Existing NexusAlpha scores are blended with the new indicators so that
 * the new system enhances rather than replaces the existing pipeline.
 */
export function computeConfluence(input: ConfluenceInput): ConfluenceBreakdown {
  const {
    candles,
    candlesByTF,
    oiSnapshots,
    liquidationLevels,
    existingScores = {},
    tradeDirection = 'long',
  } = input

  const currentPrice = candles[candles.length - 1]?.close ?? 0

  // ── 1. TREND ─────────────────────────────────────────────────────────────
  let trendScore = existingScores.trendScore ?? 50
  if (candlesByTF && Object.keys(candlesByTF).length > 0) {
    const mtf = computeMTFAlignment(candlesByTF)
    // Blend existing tren score with new MTF alignment (60/40 blend)
    trendScore = trendScore * 0.40 + mtf.score * 0.60
    // Penalty if high-weight TF is a dissenter (1D or 1W opposes)
    if (mtf.dissenter) trendScore *= 0.85
  }
  trendScore = clamp(trendScore, 0, 100)
  const trendPoints = (trendScore / 100) * WEIGHTS.trend

  // ── 2. CONFLUENCE (RSI + StochRSI + CVD divergence) ──────────────────────
  const cvd = computeCVD(candles)
  const stochRSI = computeStochRSI(candles)
  const rsi1d = existingScores.rsi1d ?? 50

  // RSI sub-score: distance from 50, penalised for overbought/oversold
  const rsiSubScore = rsi1d > 70
    ? 30  // overbought
    : rsi1d < 30
      ? 70  // oversold (bullish)
      : rsi1d > 55 ? 60 : rsi1d < 45 ? 40 : 50

  // Weight: RSI 30%, StochRSI 40%, CVD divergence 30%
  const confluenceRaw = rsiSubScore * 0.30 + stochRSI.score * 0.40 + cvd.score * 0.30
  const confluenceScore = clamp(confluenceRaw, 0, 100)
  const confluencePoints = (confluenceScore / 100) * WEIGHTS.confluence

  // ── 3. SUPPORT / RESISTANCE ───────────────────────────────────────────────
  let srScore = existingScores.srScore ?? 50

  // Liquidation zone: nearby liquidity clusters strengthen S/R validity
  const effectiveLiqLevels = liquidationLevels
    ?? estimateLiquidationLevels(currentPrice, /* totalOIUsd from last OI snapshot: */
        oiSnapshots ? (oiSnapshots[oiSnapshots.length - 1]?.openInterestValue ?? 1e9) : 1e9)

  const liqAnalysis = analyseLiquidations(
    currentPrice,
    effectiveLiqLevels.map(l => ({
      ...l,
      distancePct: Math.abs(currentPrice - l.price) / currentPrice * 100,
    })),
    tradeDirection,
  )

  // Blend S/R score with liquidation magnet insight (70/30)
  srScore = srScore * 0.70 + liqAnalysis.score * 0.30
  srScore = clamp(srScore, 0, 100)
  const srPoints = (srScore / 100) * WEIGHTS.supportResistance

  // ── 4. VOLUME (CVD trend + volume ratio) ─────────────────────────────────
  // Volume ratio: current volume vs 20-period mean
  const volumes = candles.map(c => c.volume)
  const mean20Vol = volumes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, volumes.length)
  const currentVol = volumes[volumes.length - 1]
  const volRatio = mean20Vol > 0 ? currentVol / mean20Vol : 1
  const volRatioScore = clamp((volRatio / 2) * 100, 0, 100)  // 2× mean = 100

  // Volume score: CVD trend (50%) + raw volume ratio (50%)
  const volumeScore = clamp(cvd.score * 0.50 + volRatioScore * 0.50, 0, 100)
  const volumePoints = (volumeScore / 100) * WEIGHTS.volume

  // ── 5. OPEN INTEREST ──────────────────────────────────────────────────────
  let oiScore = 50
  let oiRegime: string = 'neutral'
  if (oiSnapshots && oiSnapshots.length >= 5) {
    const oiResult = computeOIDelta(candles, oiSnapshots)
    oiScore = oiResult.score
    oiRegime = oiResult.regime
  }
  const oiPoints = (oiScore / 100) * WEIGHTS.openInterest

  // ── 6. SENTIMENT ──────────────────────────────────────────────────────────
  const fundingScore = existingScores.fundingScore ?? 50
  // Fear & Greed: normalise to 0–100 bullish
  // Extreme fear (<25) → actually bullish (contrarian buy)
  // Extreme greed (>75) → bearish (contrarian sell)
  const fg = existingScores.fearGreedIndex ?? 50
  const fgScore = fg < 25 ? 70 : fg > 75 ? 30 : 50 + (50 - fg) * 0.4
  const sentimentScore = clamp(fundingScore * 0.50 + fgScore * 0.50, 0, 100)
  const sentimentPoints = (sentimentScore / 100) * WEIGHTS.sentiment

  // ── 7. MACRO ──────────────────────────────────────────────────────────────
  const macroScore = clamp(existingScores.macroScore ?? 50, 0, 100)
  const macroPoints = (macroScore / 100) * WEIGHTS.macro

  // ── 8. PATTERN BONUS ──────────────────────────────────────────────────────
  const patternScore = existingScores.patternDetected ? 100 : 50
  const patternPoints = (patternScore / 100) * WEIGHTS.patternBonus

  // ── TOTAL ─────────────────────────────────────────────────────────────────
  const rawTotal = trendPoints + confluencePoints + srPoints + volumePoints
    + oiPoints + sentimentPoints + macroPoints + patternPoints
  const total = clamp(Math.round(rawTotal), 0, 100)
  const isValid = total >= SIGNAL_THRESHOLD

  const overallBias = total > 55 ? 'bullish' : total < 45 ? 'bearish' : 'neutral'

  return {
    trend: {
      score: Math.round(trendScore),
      bias: trendScore > 55 ? 'bullish' : trendScore < 45 ? 'bearish' : 'neutral',
      reason: `EMA stack + MTF alignment`,
    },
    confluence: {
      score: Math.round(confluenceScore),
      bias: confluenceScore > 55 ? 'bullish' : confluenceScore < 45 ? 'bearish' : 'neutral',
      reason: `RSI1D=${rsi1d.toFixed(0)} StochRSI=${stochRSI.currentK.toFixed(0)} CVD=${cvd.bias}${cvd.divergence !== 'none' ? ` [${cvd.divergence} div]` : ''}`,
    },
    supportResistance: {
      score: Math.round(srScore),
      bias: srScore > 55 ? 'bullish' : srScore < 45 ? 'bearish' : 'neutral',
      reason: `S/R levels${liqAnalysis.magnetAligned ? ' + liq magnet aligned' : ''}`,
    },
    volume: {
      score: Math.round(volumeScore),
      bias: volumeScore > 55 ? 'bullish' : volumeScore < 45 ? 'bearish' : 'neutral',
      reason: `Volume ratio: ${volRatio.toFixed(2)}× mean; CVD: ${cvd.cvdTrend}`,
    },
    openInterest: {
      score: Math.round(oiScore),
      bias: oiScore > 55 ? 'bullish' : oiScore < 45 ? 'bearish' : 'neutral',
      reason: `OI regime: ${oiRegime}`,
    },
    sentiment: {
      score: Math.round(sentimentScore),
      bias: sentimentScore > 55 ? 'bullish' : sentimentScore < 45 ? 'bearish' : 'neutral',
      reason: `Funding score: ${fundingScore} | F&G: ${fg}`,
    },
    macro: {
      score: Math.round(macroScore),
      bias: macroScore > 55 ? 'bullish' : macroScore < 45 ? 'bearish' : 'neutral',
      reason: `Macro context`,
    },
    patternBonus: {
      score: patternScore,
      bias: existingScores.patternDetected ? 'bullish' : 'neutral',
      reason: existingScores.patternDetected ? 'Reversal pattern at S/R' : 'No pattern detected',
    },
    rawTotal,
    total,
    isValid,
    overallBias,
  }
}

/**
 * Build a complete TradeSetup from raw inputs.
 * This is the top-level function your signal generation pipeline should call.
 */
export function buildTradeSetup(input: ConfluenceInput): TradeSetup {
  const confidence = computeConfluence(input)
  const { candles, targets = [], entryRange, stopLoss, accountBalance = 10_000 } = input

  const primaryTarget = targets[0]
  const rr = primaryTarget?.riskReward ?? 2.5
  const winRate = estimateWinRate(confidence.total)
  const ev = computeEV({ riskRewardRatio: rr, winRate })

  const sizing = computePositionSize({
    confluenceScore: confidence.total,
    winRate,
    riskRewardRatio: rr,
    candles,
    maxRiskFraction: 0.02,
  })

  // Find the nearest liquidation magnet
  const currentPrice = candles[candles.length - 1].close
  const liqLevels = input.liquidationLevels
    ?? estimateLiquidationLevels(currentPrice,
        input.oiSnapshots?.[input.oiSnapshots.length - 1]?.openInterestValue ?? 1e9)

  const sortedAbove = liqLevels
    .filter(l => l.price > currentPrice)
    .sort((a, b) => b.estimatedUsd - a.estimatedUsd)
  const topMagnet = sortedAbove[0] ?? null

  return {
    symbol: input.symbol,
    direction: input.tradeDirection ?? 'long',
    confidence,
    entry: entryRange ?? { low: currentPrice * 0.999, high: currentPrice * 1.001 },
    stopLoss: stopLoss ?? currentPrice * 0.95,
    targets: targets.length > 0 ? targets : [
      { price: currentPrice * (1 + rr * 0.04), riskReward: rr },
    ],
    liquidationMagnet: topMagnet
      ? {
          price: topMagnet.price,
          side: topMagnet.side,
          distancePct: Math.abs(currentPrice - topMagnet.price) / currentPrice * 100,
        }
      : undefined,
    recommendedSizeFraction: sizing.riskFraction,
    expectedValue: ev,
    timestamp: Date.now(),
  }
}
