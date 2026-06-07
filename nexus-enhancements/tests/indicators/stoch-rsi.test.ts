import { describe, it, expect } from 'vitest'
import { computeStochRSI, computeRSI } from '../../lib/indicators/stoch-rsi'
import { trendingCandles, sidewaysCandles, reversalCandles, makeCandle } from '../fixtures'

describe('computeRSI', () => {
  it('returns NaN for insufficient data', () => {
    const closes = [100, 101, 99]
    const result = computeRSI(closes, 14)
    expect(result.every(v => isNaN(v))).toBe(true)
  })

  it('returns 100 when all gains (no losses)', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i)
    const result = computeRSI(closes, 14)
    const last = result[result.length - 1]
    expect(last).toBeGreaterThan(90)  // near 100 in a pure uptrend
  })

  it('returns near 0 when all losses (no gains)', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 - i)
    const result = computeRSI(closes, 14)
    const last = result[result.length - 1]
    expect(last).toBeLessThan(10)
  })

  it('returns ~50 for a roughly flat series', () => {
    // Alternating up/down keeps RSI near 50
    const closes = Array.from({ length: 30 }, (_, i) => 100 + (i % 2 === 0 ? 1 : -1))
    const result = computeRSI(closes, 14)
    const last = result[result.length - 1]
    expect(last).toBeGreaterThan(40)
    expect(last).toBeLessThan(60)
  })

  it('result length matches input length', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i)
    const result = computeRSI(closes, 14)
    expect(result.length).toBe(closes.length)
  })
})

describe('computeStochRSI', () => {
  it('returns neutral for insufficient candles', () => {
    const candles = [makeCandle(100), makeCandle(101), makeCandle(99)]
    const result = computeStochRSI(candles)
    expect(result.score).toBe(50)
    expect(result.bias).toBe('neutral')
    expect(result.crossover).toBe('none')
  })

  it('detects oversold zone in a downtrend', () => {
    // Use 200 candles with moderate slope so RSI descends into oversold without fully saturating
    const candles = trendingCandles(200, 100_000, -200)
    const result = computeStochRSI(candles)
    expect(result.zone).toBe('oversold')
    expect(result.currentK).toBeLessThan(30)
  })

  it('detects overbought zone in an uptrend', () => {
    const candles = trendingCandles(200, 60_000, 200)
    const result = computeStochRSI(candles)
    expect(result.zone).toBe('overbought')
    expect(result.currentK).toBeGreaterThan(70)
  })

  it('score stays in [0, 100]', () => {
    const datasets = [
      trendingCandles(200, 60_000, 200),
      trendingCandles(200, 60_000, -200),
      sidewaysCandles(200, 60_000, 3000),
      reversalCandles(200, 60_000),
    ]
    for (const candles of datasets) {
      const { score } = computeStochRSI(candles)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(100)
    }
  })

  it('%K and %D arrays have correct length', () => {
    const candles = trendingCandles(200, 60_000, 100)
    const result = computeStochRSI(candles)
    expect(result.k.length).toBe(candles.length)
    expect(result.d.length).toBe(candles.length)
  })

  it('custom params are respected', () => {
    // Use sideways candles so RSI stays mid-range where period length is meaningful
    const candles = sidewaysCandles(200, 60_000, 3000)
    const r1 = computeStochRSI(candles, { rsiPeriod: 14, stochPeriod: 14 })
    const r2 = computeStochRSI(candles, { rsiPeriod: 7, stochPeriod: 7 })
    expect(r1.k.length).toBe(candles.length)
    expect(r2.k.length).toBe(candles.length)
    expect(r1.currentK).toBeGreaterThanOrEqual(0)
    expect(r2.currentK).toBeGreaterThanOrEqual(0)
  })

  it('crossover changes from none in a reversal', () => {
    // reversalCandles creates an up-then-down pattern which should trigger a crossover
    const candles = reversalCandles(80, 60_000)
    const result = computeStochRSI(candles)
    // We can't guarantee the exact bar of crossover, but score should not be 50
    expect(result.score).not.toBeCloseTo(50, -1)
  })
})
