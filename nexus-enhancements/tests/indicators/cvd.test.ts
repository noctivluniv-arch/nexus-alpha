import { describe, it, expect } from 'vitest'
import { computeCVD, computeCandelDelta } from '../../lib/indicators/cvd'
import { trendingCandles, sidewaysCandles, makeCandle, bullishDataset } from '../fixtures'
import type { OHLCV } from '../../lib/types/market'

describe('computeCandelDelta', () => {
  it('returns positive delta for strong bullish candle', () => {
    // Close near top of range → strong buying pressure
    const candle = makeCandle(100, { open: 90, high: 101, low: 89, close: 100, volume: 1000 })
    const delta = computeCandelDelta(candle)
    expect(delta).toBeGreaterThan(0)
  })

  it('returns negative delta for strong bearish candle', () => {
    // Close near bottom of range → strong selling pressure
    const candle = makeCandle(90, { open: 100, high: 101, low: 89, close: 90, volume: 1000 })
    const delta = computeCandelDelta(candle)
    expect(delta).toBeLessThan(0)
  })

  it('returns zero for doji (high === low)', () => {
    const candle: OHLCV = { timestamp: 0, open: 100, high: 100, low: 100, close: 100, volume: 1000 }
    expect(computeCandelDelta(candle)).toBe(0)
  })

  it('returns near-zero for perfectly neutral candle (close at midpoint)', () => {
    const candle: OHLCV = { timestamp: 0, open: 95, high: 110, low: 90, close: 100, volume: 1000 }
    const delta = computeCandelDelta(candle)
    expect(Math.abs(delta)).toBeLessThan(100)  // small but not necessarily zero
  })

  it('scales with volume', () => {
    const base = makeCandle(100, { open: 90, high: 105, low: 89, close: 100, volume: 1000 })
    const doubled = { ...base, volume: 2000 }
    expect(computeCandelDelta(doubled)).toBeCloseTo(computeCandelDelta(base) * 2, 5)
  })
})

describe('computeCVD', () => {
  it('returns neutral score for insufficient data', () => {
    const result = computeCVD([makeCandle(100)])
    expect(result.score).toBe(50)
    expect(result.bias).toBe('neutral')
  })

  it('produces rising CVD for a sustained uptrend', () => {
    const { candles } = bullishDataset(60)
    const result = computeCVD(candles)
    expect(result.cvdTrend).toBe('rising')
    expect(result.score).toBeGreaterThan(55)
    expect(result.bias).toBe('bullish')
  })

  it('produces falling CVD for a sustained downtrend', () => {
    const candles = trendingCandles(60, 70_000, -200)
    const result = computeCVD(candles)
    expect(result.cvdTrend).toBe('falling')
    expect(result.score).toBeLessThan(45)
    expect(result.bias).toBe('bearish')
  })

  it('delta array aligns with cumulativeDelta length', () => {
    const candles = trendingCandles(50, 50_000, 100)
    const result = computeCVD(candles)
    expect(result.delta.length).toBe(candles.length)
    expect(result.cumulativeDelta.length).toBe(candles.length)
  })

  it('cumulativeDelta is a running sum of delta', () => {
    const candles = trendingCandles(50, 50_000, 100)
    const result = computeCVD(candles)
    let sum = 0
    for (let i = 0; i < result.delta.length; i++) {
      sum += result.delta[i]
      expect(result.cumulativeDelta[i]).toBeCloseTo(sum, 6)
    }
  })

  it('score is always in [0, 100]', () => {
    const datasets = [
      trendingCandles(60, 60_000, 100),
      trendingCandles(60, 60_000, -100),
      sidewaysCandles(60, 60_000, 2000),
    ]
    for (const candles of datasets) {
      const { score } = computeCVD(candles)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(100)
    }
  })

  it('has a reason string', () => {
    const { candles } = bullishDataset(60)
    const result = computeCVD(candles)
    expect(result.reason).toBeTruthy()
    expect(typeof result.reason).toBe('string')
  })
})
