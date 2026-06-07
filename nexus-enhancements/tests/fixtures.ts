/**
 * Test fixtures: synthetic OHLCV generators for deterministic unit tests.
 * All candles generated here have realistic bid/ask spreads and volume profiles.
 */

import type { OHLCV, OISnapshot } from '../../lib/types/market'

/** Generate N candles with a linear price trend */
export function trendingCandles(
  n: number,
  startPrice: number,
  slopePerCandle: number,
  baseVolume = 1000,
): OHLCV[] {
  // Direction of candle body must follow slope direction so that
  // volume-delta indicators (CVD) correctly pick up buying/selling pressure.
  const direction = slopePerCandle >= 0 ? 1 : -1
  return Array.from({ length: n }, (_, i) => {
    const mid = startPrice + slopePerCandle * i
    const noise = Math.abs(mid) * 0.002  // 0.2% noise
    const open = mid - direction * noise * 0.5
    const close = mid + direction * noise * 0.5
    return {
      timestamp: Date.now() - (n - i) * 3_600_000,
      open,
      high: Math.max(open, close) + noise,
      low: Math.min(open, close) - noise,
      close,
      volume: baseVolume * (1 + Math.sin(i * 0.3) * 0.3),
    }
  })
}

/** Generate N candles with a sinusoidal sideways pattern */
export function sidewaysCandles(n: number, centerPrice: number, amplitude: number): OHLCV[] {
  return Array.from({ length: n }, (_, i) => {
    const mid = centerPrice + amplitude * Math.sin(i * 0.4)
    const spread = mid * 0.003
    const open = mid - spread * 0.3
    const close = mid + spread * 0.3
    return {
      timestamp: Date.now() - (n - i) * 3_600_000,
      open,
      high: Math.max(open, close) + spread,
      low: Math.min(open, close) - spread,
      close,
      volume: 800 + Math.abs(Math.sin(i * 0.5)) * 400,
    }
  })
}

/** Generate a candle series that trends up then sharply reverses */
export function reversalCandles(n: number, startPrice: number): OHLCV[] {
  const half = Math.floor(n / 2)
  const upLeg = trendingCandles(half, startPrice, startPrice * 0.005)
  const peak = upLeg[upLeg.length - 1].close
  const downLeg = trendingCandles(n - half, peak, -peak * 0.007)
  return [...upLeg, ...downLeg]
}

/** Construct a single OHLCV candle */
export function makeCandle(
  close: number,
  opts: Partial<Omit<OHLCV, 'close'>> = {},
): OHLCV {
  const spread = close * 0.002
  return {
    timestamp: opts.timestamp ?? Date.now(),
    open: opts.open ?? close - spread * 0.5,
    high: opts.high ?? close + spread,
    low: opts.low ?? close - spread,
    close,
    volume: opts.volume ?? 1000,
  }
}

/** Generate OI snapshots aligned with candles */
export function makeOISnapshots(
  candles: OHLCV[],
  baseOI: number,
  trend: 'rising' | 'falling' | 'flat' = 'rising',
): OISnapshot[] {
  const trendSlope = trend === 'rising' ? 1.002 : trend === 'falling' ? 0.998 : 1
  let oi = baseOI
  return candles.map(c => {
    oi *= trendSlope
    return {
      timestamp: c.timestamp,
      openInterest: oi,
      openInterestValue: oi * c.close,
    }
  })
}

/** A full bullish-context dataset: uptrend + rising OI + high volume */
export function bullishDataset(n = 100): { candles: OHLCV[]; oiSnapshots: OISnapshot[] } {
  const candles = trendingCandles(n, 60_000, 200)
  const oiSnapshots = makeOISnapshots(candles, 1_000_000_000, 'rising')
  return { candles, oiSnapshots }
}

/** A full bearish-context dataset: downtrend + rising OI */
export function bearishDataset(n = 100): { candles: OHLCV[]; oiSnapshots: OISnapshot[] } {
  const candles = trendingCandles(n, 70_000, -300)
  const oiSnapshots = makeOISnapshots(candles, 1_000_000_000, 'rising')
  return { candles, oiSnapshots }
}
