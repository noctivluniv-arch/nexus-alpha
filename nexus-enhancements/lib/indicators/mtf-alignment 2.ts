/**
 * @module indicators/mtf-alignment
 *
 * Multi-Timeframe (MTF) Alignment Score
 * ──────────────────────────────────────
 * The single biggest source of false signals in any system is a lower-timeframe
 * signal trading AGAINST the dominant higher-timeframe trend. MTF alignment
 * ensures that only setups where multiple timeframes agree on direction are
 * given high scores.
 *
 * Scoring model
 * ─────────────
 * Each timeframe is evaluated independently:
 *   • EMA stack: close > EMA20 > EMA50 > EMA200 = fully bullish (+1)
 *     close < EMA20 < EMA50 < EMA200 = fully bearish (−1)
 *     mixed = partially scored (−0.5 to +0.5)
 *   • MACD: histogram positive and rising = bullish, else bearish
 *   • RSI: > 55 = bullish bias, < 45 = bearish, 45–55 = neutral
 *
 * Composite TF score = (ema + macd + rsi) / 3 → range [−1, +1]
 * Weighted sum across all TFs using TIMEFRAME_WEIGHTS
 * Final score normalised to 0–100.
 *
 * A score ≥ 70 on the 1D+4H confirms trend; < 30 confirms downtrend.
 */

import type { OHLCV, IndicatorResult, Bias } from '../types/market'
import { TIMEFRAME_WEIGHTS, Timeframe } from '../types/market'
import { ema, sma, clamp } from '../utils/math'
import { computeRSI } from './stoch-rsi'

export interface TimeframeSignal {
  timeframe: Timeframe
  bias: Bias
  /** Normalised score for this TF alone 0–100 */
  score: number
  emaStack: 'bullish' | 'bearish' | 'mixed'
  macdHistogram: number
  rsi: number
}

export interface MTFAlignmentResult extends IndicatorResult {
  /** Per-timeframe breakdown */
  signals: TimeframeSignal[]
  /** 0–1 degree of agreement (1 = all TFs agree) */
  agreementRatio: number
  /** Strongest opposing timeframe (if any) */
  dissenter?: Timeframe
}

/**
 * Compute how well-aligned a single OHLCV series is internally.
 * Returns a composite score in [−1, +1].
 */
function scoreTimeframe(candles: readonly OHLCV[]): Omit<TimeframeSignal, 'timeframe'> {
  const closes = candles.map(c => c.close)
  const minLen = 27  // need at least EMA26 for MACD

  if (closes.length < minLen) {
    return { bias: 'neutral', score: 50, emaStack: 'mixed', macdHistogram: 0, rsi: 50 }
  }

  // ── EMA stack ──────────────────────────────────────────────────────────
  const ema20 = ema(closes, 20)
  const ema50 = closes.length >= 50 ? ema(closes, 50) : ema(closes, 20)
  const ema200 = closes.length >= 200 ? ema(closes, 200) : ema(closes, 50)
  const lastClose = closes[closes.length - 1]
  const e20 = ema20[ema20.length - 1]
  const e50 = ema50[ema50.length - 1]
  const e200 = ema200[ema200.length - 1]

  let emaScore = 0
  if (lastClose > e20) emaScore += 0.33
  if (lastClose > e50) emaScore += 0.34
  if (lastClose > e200) emaScore += 0.33
  if (e20 > e50) emaScore += 0.17
  if (e50 > e200) emaScore += 0.17
  emaScore = emaScore * 2 - 1  // map [0,1] → [-1, +1]

  const emaStack: 'bullish' | 'bearish' | 'mixed' =
    emaScore > 0.5 ? 'bullish' : emaScore < -0.5 ? 'bearish' : 'mixed'

  // ── MACD (12/26/9) ─────────────────────────────────────────────────────
  const macdFast = ema(closes, 12)
  const macdSlow = ema(closes, 26)
  const macdLine = macdFast.map((v, i) =>
    isNaN(v) || isNaN(macdSlow[i]) ? NaN : v - macdSlow[i],
  )
  const signalLine = ema(macdLine.filter(v => !isNaN(v)), 9)
  const lastMacd = macdLine[macdLine.length - 1]
  const lastSignal = signalLine[signalLine.length - 1]
  const macdHistogram = isNaN(lastMacd) || isNaN(lastSignal) ? 0 : lastMacd - lastSignal
  const macdScore = macdHistogram > 0 ? 1 : -1

  // ── RSI ────────────────────────────────────────────────────────────────
  const rsiSeries = computeRSI(closes, 14)
  const rsi = rsiSeries[rsiSeries.length - 1] ?? 50
  const rsiScore = rsi > 55 ? 1 : rsi < 45 ? -1 : (rsi - 50) / 5

  // ── Composite ──────────────────────────────────────────────────────────
  const composite = (emaScore * 0.5 + macdScore * 0.3 + rsiScore * 0.2)
  const score = clamp((composite + 1) / 2 * 100, 0, 100)
  const bias: Bias = score > 55 ? 'bullish' : score < 45 ? 'bearish' : 'neutral'

  return { bias, score, emaStack, macdHistogram, rsi }
}

/**
 * Compute MTF alignment score from a map of candle arrays.
 *
 * @param candlesByTF - Map from Timeframe enum to its OHLCV candles
 */
export function computeMTFAlignment(
  candlesByTF: Partial<Record<Timeframe, readonly OHLCV[]>>,
): MTFAlignmentResult {
  const signals: TimeframeSignal[] = []

  for (const [tf, candles] of Object.entries(candlesByTF) as [Timeframe, OHLCV[]][]) {
    if (!candles || candles.length === 0) continue
    const s = scoreTimeframe(candles)
    signals.push({ timeframe: tf, ...s })
  }

  if (signals.length === 0) {
    return {
      score: 50,
      bias: 'neutral',
      reason: 'No timeframe data provided',
      signals: [],
      agreementRatio: 0,
    }
  }

  // ── Weighted score ──────────────────────────────────────────────────────
  let weightedSum = 0
  let totalWeight = 0
  for (const s of signals) {
    const weight = TIMEFRAME_WEIGHTS[s.timeframe] ?? 0.2
    weightedSum += s.score * weight
    totalWeight += weight
  }
  const rawScore = totalWeight > 0 ? weightedSum / totalWeight : 50

  // ── Agreement ratio ─────────────────────────────────────────────────────
  const bullishCount = signals.filter(s => s.bias === 'bullish').length
  const bearishCount = signals.filter(s => s.bias === 'bearish').length
  const dominant = bullishCount >= bearishCount ? 'bullish' : 'bearish'
  const dominantCount = Math.max(bullishCount, bearishCount)
  const agreementRatio = dominantCount / signals.length

  // ── Dissenter ───────────────────────────────────────────────────────────
  const highWeightTFs = [Timeframe.D1, Timeframe.W1]
  const dissenter = signals.find(
    s => s.bias !== dominant && s.bias !== 'neutral' && highWeightTFs.includes(s.timeframe),
  )?.timeframe

  const score = clamp(rawScore, 0, 100)
  const bias: Bias = score > 55 ? 'bullish' : score < 45 ? 'bearish' : 'neutral'

  const tfSummary = signals.map(s => `${s.timeframe}:${s.bias[0].toUpperCase()}`).join(' ')
  const reason = `TF alignment: ${tfSummary} | Agreement: ${(agreementRatio * 100).toFixed(0)}%${dissenter ? ` | Dissenter: ${dissenter}` : ''}`

  return { score, bias, reason, signals, agreementRatio, dissenter }
}
