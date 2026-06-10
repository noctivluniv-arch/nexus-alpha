import { describe, it, expect } from 'vitest'
import { computeOIDelta, syntheticOIFromVolume } from '../../lib/indicators/open-interest'
import { bullishDataset, bearishDataset, makeOISnapshots, trendingCandles } from '../fixtures'

describe('computeOIDelta', () => {
  it('returns neutral for insufficient data', () => {
    const candles = trendingCandles(5, 60_000, 100)
    const snapshots = makeOISnapshots(candles, 1e9, 'rising')
    const result = computeOIDelta(candles, snapshots)
    expect(result.score).toBe(50)
    expect(result.bias).toBe('neutral')
  })

  it('detects long_buildup for rising price + rising OI', () => {
    const { candles, oiSnapshots } = bullishDataset(50)
    const result = computeOIDelta(candles, oiSnapshots)
    expect(result.regime).toBe('long_buildup')
    expect(result.score).toBeGreaterThan(60)
    expect(result.bias).toBe('bullish')
  })

  it('detects short_buildup for falling price + rising OI', () => {
    const { candles, oiSnapshots } = bearishDataset(50)
    const result = computeOIDelta(candles, oiSnapshots)
    expect(result.regime).toBe('short_buildup')
    expect(result.score).toBeLessThan(40)
    expect(result.bias).toBe('bearish')
  })

  it('detects long_liquidation for falling price + falling OI', () => {
    const candles = trendingCandles(50, 70_000, -300)
    const snapshots = makeOISnapshots(candles, 1e9, 'falling')
    const result = computeOIDelta(candles, snapshots)
    expect(result.regime).toBe('long_liquidation')
  })

  it('detects short_squeeze for rising price + falling OI', () => {
    const candles = trendingCandles(50, 60_000, 300)
    const snapshots = makeOISnapshots(candles, 1e9, 'falling')
    const result = computeOIDelta(candles, snapshots)
    expect(result.regime).toBe('short_squeeze')
  })

  it('score always in [0, 100]', () => {
    const scenarios = [
      bullishDataset(50),
      bearishDataset(50),
      { candles: trendingCandles(50, 60_000, 300), oiSnapshots: makeOISnapshots(trendingCandles(50, 60_000, 300), 1e9, 'falling') },
    ]
    for (const { candles, oiSnapshots } of scenarios) {
      const { score } = computeOIDelta(candles, oiSnapshots)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(100)
    }
  })

  it('oiChangeSeries has correct length', () => {
    const { candles, oiSnapshots } = bullishDataset(50)
    const result = computeOIDelta(candles, oiSnapshots)
    expect(result.oiChangeSeries.length).toBe(Math.min(candles.length, oiSnapshots.length))
  })

  it('isOISpike is true when OI exceeds 2σ', () => {
    const candles = trendingCandles(50, 60_000, 100)
    // Create an OI series with a massive spike at the end
    const snapshots = makeOISnapshots(candles, 1e9, 'flat')
    const spikedSnapshots = snapshots.map((s, i) =>
      i === snapshots.length - 1
        ? { ...s, openInterest: s.openInterest * 5 }  // 5× spike
        : s,
    )
    const result = computeOIDelta(candles, spikedSnapshots)
    expect(result.isOISpike).toBe(true)
  })
})

describe('syntheticOIFromVolume', () => {
  it('returns same length as input candles', () => {
    const candles = trendingCandles(20, 60_000, 100)
    const result = syntheticOIFromVolume(candles)
    expect(result.length).toBe(candles.length)
  })

  it('OI is monotonically increasing (cumulative volume)', () => {
    const candles = trendingCandles(20, 60_000, 100)
    const result = syntheticOIFromVolume(candles)
    for (let i = 1; i < result.length; i++) {
      expect(result[i].openInterest).toBeGreaterThanOrEqual(result[i - 1].openInterest)
    }
  })
})
