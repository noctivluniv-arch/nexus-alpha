import { describe, it, expect } from 'vitest'
import { computeMTFAlignment } from '../../lib/indicators/mtf-alignment'
import { trendingCandles, sidewaysCandles } from '../fixtures'
import { Timeframe } from '../../lib/types/market'

describe('computeMTFAlignment', () => {
  it('returns neutral for empty input', () => {
    const result = computeMTFAlignment({})
    expect(result.score).toBe(50)
    expect(result.bias).toBe('neutral')
    expect(result.agreementRatio).toBe(0)
  })

  it('returns bullish when all TFs are uptrending', () => {
    const upCandles = trendingCandles(250, 60_000, 200)
    const result = computeMTFAlignment({
      [Timeframe.H4]: upCandles,
      [Timeframe.D1]: upCandles,
      [Timeframe.W1]: upCandles,
    })
    expect(result.bias).toBe('bullish')
    expect(result.score).toBeGreaterThan(60)
    expect(result.agreementRatio).toBeGreaterThan(0.6)
  })

  it('returns bearish when all TFs are downtrending', () => {
    const downCandles = trendingCandles(250, 80_000, -300)
    const result = computeMTFAlignment({
      [Timeframe.H4]: downCandles,
      [Timeframe.D1]: downCandles,
      [Timeframe.W1]: downCandles,
    })
    expect(result.bias).toBe('bearish')
    expect(result.score).toBeLessThan(40)
  })

  it('identifies a dissenter when high-weight TF opposes', () => {
    const upCandles = trendingCandles(250, 60_000, 200)
    const downCandles = trendingCandles(250, 80_000, -400)
    const result = computeMTFAlignment({
      [Timeframe.H4]: upCandles,
      [Timeframe.H1]: upCandles,
      [Timeframe.M15]: upCandles,
      [Timeframe.D1]: downCandles,  // 1D disagrees — should be flagged
    })
    expect(result.dissenter).toBe(Timeframe.D1)
  })

  it('score is always in [0, 100]', () => {
    const candles = trendingCandles(250, 60_000, 100)
    const result = computeMTFAlignment({
      [Timeframe.M15]: candles,
      [Timeframe.H1]: candles,
      [Timeframe.H4]: candles,
      [Timeframe.D1]: candles,
      [Timeframe.W1]: candles,
    })
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
  })

  it('signals array contains one entry per provided TF', () => {
    const candles = trendingCandles(250, 60_000, 100)
    const result = computeMTFAlignment({
      [Timeframe.H4]: candles,
      [Timeframe.D1]: candles,
    })
    expect(result.signals.length).toBe(2)
  })

  it('produces a reason string that mentions TF codes', () => {
    const candles = trendingCandles(250, 60_000, 100)
    const result = computeMTFAlignment({ [Timeframe.H4]: candles })
    expect(result.reason).toContain('4h')
  })

  it('handles sideways market with mixed signals gracefully', () => {
    const sideways = sidewaysCandles(250, 60_000, 2000)
    const result = computeMTFAlignment({
      [Timeframe.H4]: sideways,
      [Timeframe.D1]: sideways,
    })
    // Should not throw and score should be defined
    expect(result.score).toBeDefined()
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
  })
})
