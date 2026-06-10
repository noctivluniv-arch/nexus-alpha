/**
 * @module types/market
 * Core market data types shared across all NexusAlpha modules.
 */

/** Supported trading timeframes in ascending order */
export enum Timeframe {
  M15 = '15m',
  H1 = '1h',
  H4 = '4h',
  D1 = '1d',
  W1 = '1w',
}

/** Weight assigned to each timeframe when computing MTF alignment scores */
export const TIMEFRAME_WEIGHTS: Record<Timeframe, number> = {
  [Timeframe.M15]: 0.08,
  [Timeframe.H1]: 0.14,
  [Timeframe.H4]: 0.28,
  [Timeframe.D1]: 0.32,
  [Timeframe.W1]: 0.18,
}

/** Single OHLCV candlestick */
export interface OHLCV {
  /** Unix timestamp in milliseconds */
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** Open Interest snapshot from a futures exchange */
export interface OISnapshot {
  timestamp: number
  /** Raw contract count or coin amount */
  openInterest: number
  /** USD-denominated OI value */
  openInterestValue: number
}

/** Liquidation estimate at a given price level */
export interface LiquidationLevel {
  price: number
  /** Estimated notional USD value of positions that liquidate here */
  estimatedUsd: number
  side: 'long' | 'short'
  /** Distance from current price as a percentage */
  distancePct: number
}

/** Directional bias produced by any indicator or scoring module */
export type Bias = 'bullish' | 'bearish' | 'neutral'

/** Generic scored output every indicator returns */
export interface IndicatorResult {
  /** 0–100 bullish conviction. 50 = neutral */
  score: number
  bias: Bias
  /** Human-readable reason for the score */
  reason: string
}
