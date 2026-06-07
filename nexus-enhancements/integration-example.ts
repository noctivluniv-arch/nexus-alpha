/**
 * @file integration-example.ts
 *
 * How to wire the new modules into your existing NexusAlpha signal generation.
 *
 * This file is an EXAMPLE — copy the relevant parts into your actual
 * signal generation pipeline (likely lib/signals/ or similar).
 *
 * Assumptions about your existing code:
 *   - You already fetch OHLCV from Binance/Bybit using CCXT or similar
 *   - You already compute EMA, RSI, MACD, Bollinger, ATR, Fibonacci, Volume Profile
 *   - You produce a confidence score and a signal object per coin
 *   - Your signal object is then displayed in the UI
 *
 * What changes:
 *   1. Pass your existing scores into ConfluenceInput.existingScores
 *   2. Optionally fetch OI from Binance futures API (see fetchOI below)
 *   3. Call buildTradeSetup() instead of your current scoring function
 *   4. The returned TradeSetup has the enhanced score, EV, and position size
 */

import { buildTradeSetup, computeConfluence, SIGNAL_THRESHOLD } from '../lib/scoring/confluence-engine'
import { computePositionDollars } from '../lib/risk/position-sizer'
import type { OHLCV, OISnapshot } from '../lib/types/market'
import type { ConfluenceInput } from '../lib/scoring/confluence-engine'
import { Timeframe } from '../lib/types/market'

// ─── Step 1: Fetch OI from Binance (add this to your data-fetching layer) ────

/**
 * Fetch open interest history from Binance futures.
 * Replace with your preferred exchange's API.
 *
 * @see https://binance-docs.github.io/apidocs/futures/en/#open-interest-statistics
 */
export async function fetchBinanceOI(
  symbol: string,         // e.g. 'BTCUSDT'
  interval: '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '12h' | '1d',
  limit = 90,
): Promise<OISnapshot[]> {
  const url = `https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=${interval}&limit=${limit}`
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Binance OI fetch failed: ${resp.status}`)
  const data: Array<{ timestamp: number; sumOpenInterest: string; sumOpenInterestValue: string }> =
    await resp.json()
  return data.map(d => ({
    timestamp: d.timestamp,
    openInterest: parseFloat(d.sumOpenInterest),
    openInterestValue: parseFloat(d.sumOpenInterestValue),
  }))
}

// ─── Step 2: Wire into your existing signal generator ────────────────────────

export interface ExistingNexusAlphaSignal {
  /** Your current EMA/trend score 0–100 */
  trendScore: number
  /** Your current S/R score 0–100 */
  srScore: number
  /** Your current funding rate score 0–100 */
  fundingScore: number
  /** Your current macro score 0–100 */
  macroScore: number
  /** Latest RSI 1D value */
  rsi1d: number
  entry: { low: number; high: number }
  stopLoss: number
  targets: Array<{ price: number; riskReward: number }>
  direction: 'long' | 'short'
}

/**
 * Drop-in replacement for your existing signal scoring.
 * Call this at the end of your signal generation pipeline.
 *
 * @param symbol   - Trading pair, e.g. 'BTCUSDT'
 * @param candles  - Primary TF candles (4H recommended)
 * @param existing - Scores already computed by your existing pipeline
 * @param accountBalance - User's account size in USD
 */
export async function generateEnhancedSignal(
  symbol: string,
  candles4H: OHLCV[],
  candles1D: OHLCV[],
  candles1W: OHLCV[],
  existing: ExistingNexusAlphaSignal,
  accountBalance = 10_000,
) {
  // ── Fetch OI (gracefully degrade if API fails) ──────────────────────────
  let oiSnapshots: OISnapshot[] | undefined
  try {
    oiSnapshots = await fetchBinanceOI(symbol, '4h', 90)
  } catch (err) {
    console.warn('[NexusAlpha] OI fetch failed — proceeding without OI data:', err)
  }

  // ── Build confluence input ───────────────────────────────────────────────
  const input: ConfluenceInput = {
    symbol,
    candles: candles4H,
    candlesByTF: {
      [Timeframe.H4]: candles4H,
      [Timeframe.D1]: candles1D,
      [Timeframe.W1]: candles1W,
    },
    oiSnapshots,
    existingScores: {
      trendScore: existing.trendScore,
      srScore: existing.srScore,
      fundingScore: existing.fundingScore,
      macroScore: existing.macroScore,
      rsi1d: existing.rsi1d,
      // fearGreedIndex: await fetchFearGreed(),  // optional
    },
    tradeDirection: existing.direction,
    entryRange: existing.entry,
    stopLoss: existing.stopLoss,
    targets: existing.targets,
    accountBalance,
  }

  // ── Generate the full enhanced setup ────────────────────────────────────
  const setup = buildTradeSetup(input)

  // ── Position sizing in dollar terms ─────────────────────────────────────
  const { dollarRisk, positionSizeUsd, positionSizeCoins } = computePositionDollars(
    accountBalance,
    { ...setup, riskFraction: setup.recommendedSizeFraction } as any,
    (existing.entry.low + existing.entry.high) / 2,
    existing.stopLoss,
  )

  return {
    // Enhanced score (replaces existing confidence score)
    confidenceScore: setup.confidence.total,
    isValid: setup.confidence.isValid,
    bias: setup.confidence.overallBias,

    // Detailed breakdown for UI display
    scoreBreakdown: {
      trend: setup.confidence.trend,
      confluence: setup.confidence.confluence,
      supportResistance: setup.confidence.supportResistance,
      volume: setup.confidence.volume,
      openInterest: setup.confidence.openInterest,
      sentiment: setup.confidence.sentiment,
      macro: setup.confidence.macro,
      patternBonus: setup.confidence.patternBonus,
    },

    // Expected Value for this trade
    expectedValue: setup.expectedValue,

    // Position sizing
    sizing: {
      riskFraction: setup.recommendedSizeFraction,
      dollarRisk: dollarRisk.toFixed(2),
      positionSizeUsd: positionSizeUsd.toFixed(2),
      positionSizeCoins: positionSizeCoins.toFixed(6),
    },

    // Liquidation magnet (show in UI as a price target)
    liquidationMagnet: setup.liquidationMagnet,

    // Original trade parameters
    entry: existing.entry,
    stopLoss: existing.stopLoss,
    targets: existing.targets,
  }
}

// ─── Step 3: UI display helper ────────────────────────────────────────────────

/**
 * Format the enhanced signal result for display in the NexusAlpha UI.
 * Adapt this to match your existing UI component structure.
 */
export function formatForUI(result: Awaited<ReturnType<typeof generateEnhancedSignal>>) {
  return {
    badge: result.isValid
      ? `✓ VALID (${result.confidenceScore}/100)`
      : `⚠ BELOW THRESHOLD (${result.confidenceScore}/${SIGNAL_THRESHOLD})`,

    evBadge: `EV: ${result.expectedValue.grade} (${result.expectedValue.evPerR >= 0 ? '+' : ''}${result.expectedValue.evPerR.toFixed(2)}R)`,

    sizingLine: `Risk ${(Number(result.sizing.riskFraction) * 100).toFixed(1)}% → $${result.sizing.dollarRisk} | Position: $${result.sizing.positionSizeUsd}`,

    magnetLine: result.liquidationMagnet
      ? `🧲 Liq magnet: $${result.liquidationMagnet.price.toFixed(0)} (${result.liquidationMagnet.distancePct.toFixed(1)}% away, ${result.liquidationMagnet.side} cluster)`
      : null,
  }
}
