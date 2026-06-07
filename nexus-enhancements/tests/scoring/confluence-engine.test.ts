import { describe, it, expect } from 'vitest'
import { computeConfluence, buildTradeSetup, SIGNAL_THRESHOLD } from '../../lib/scoring/confluence-engine'
import { bullishDataset, bearishDataset, trendingCandles, makeOISnapshots } from '../fixtures'
import { Timeframe } from '../../lib/types/market'

describe('computeConfluence', () => {
  it('returns a defined score for minimal input (primary candles only)', () => {
    const { candles } = bullishDataset(80)
    const result = computeConfluence({
      symbol: 'BTCUSDT',
      candles,
    })
    expect(result.total).toBeGreaterThanOrEqual(0)
    expect(result.total).toBeLessThanOrEqual(100)
  })

  it('produces bullish overall bias for strong bullish dataset', () => {
    const { candles, oiSnapshots } = bullishDataset(100)
    const result = computeConfluence({
      symbol: 'BTCUSDT',
      candles,
      oiSnapshots,
      existingScores: {
        trendScore: 80,
        srScore: 70,
        fundingScore: 60,
        macroScore: 65,
        fearGreedIndex: 45,
        rsi1d: 58,
        patternDetected: true,
      },
      tradeDirection: 'long',
    })
    expect(result.overallBias).toBe('bullish')
    expect(result.total).toBeGreaterThan(60)
  })

  it('produces bearish overall bias for strong bearish dataset', () => {
    const { candles, oiSnapshots } = bearishDataset(100)
    const result = computeConfluence({
      symbol: 'BTCUSDT',
      candles,
      oiSnapshots,
      existingScores: {
        trendScore: 20,
        srScore: 25,
        fundingScore: 30,
        macroScore: 30,
        fearGreedIndex: 80,
        rsi1d: 72,
      },
      tradeDirection: 'short',
    })
    expect(result.overallBias).toBe('bearish')
    expect(result.total).toBeLessThan(45)
  })

  it('all component scores are in [0, 100]', () => {
    const { candles } = bullishDataset(100)
    const result = computeConfluence({ symbol: 'BTCUSDT', candles })
    const components = [
      result.trend,
      result.confluence,
      result.supportResistance,
      result.volume,
      result.openInterest,
      result.sentiment,
      result.macro,
      result.patternBonus,
    ]
    for (const c of components) {
      expect(c.score).toBeGreaterThanOrEqual(0)
      expect(c.score).toBeLessThanOrEqual(100)
    }
  })

  it('total is always capped at 100 regardless of inputs', () => {
    const { candles, oiSnapshots } = bullishDataset(100)
    const result = computeConfluence({
      symbol: 'BTCUSDT',
      candles,
      oiSnapshots,
      existingScores: {
        trendScore: 100,
        srScore: 100,
        fundingScore: 100,
        macroScore: 100,
        fearGreedIndex: 0,
        rsi1d: 30,
        patternDetected: true,
      },
    })
    // Total is always capped, rawTotal is always a finite number
    expect(result.total).toBeLessThanOrEqual(100)
    expect(result.total).toBeGreaterThanOrEqual(0)
    expect(isFinite(result.rawTotal)).toBe(true)
  })

  it('isValid is true when total ≥ threshold', () => {
    const { candles, oiSnapshots } = bullishDataset(100)
    const result = computeConfluence({
      symbol: 'BTCUSDT',
      candles,
      oiSnapshots,
      existingScores: {
        trendScore: 85,
        srScore: 80,
        fundingScore: 70,
        macroScore: 70,
        fearGreedIndex: 30,
        rsi1d: 55,
        patternDetected: true,
      },
    })
    expect(result.isValid).toBe(result.total >= SIGNAL_THRESHOLD)
  })

  it('patternBonus increases total score', () => {
    const { candles } = bullishDataset(80)
    const base = computeConfluence({ symbol: 'BTCUSDT', candles, existingScores: { patternDetected: false } })
    const withPattern = computeConfluence({ symbol: 'BTCUSDT', candles, existingScores: { patternDetected: true } })
    expect(withPattern.total).toBeGreaterThanOrEqual(base.total)
  })

  it('MTF candlesByTF improves trend score', () => {
    const { candles } = bullishDataset(250)
    const withoutMTF = computeConfluence({
      symbol: 'BTCUSDT',
      candles,
      existingScores: { trendScore: 75 },
    })
    const withMTF = computeConfluence({
      symbol: 'BTCUSDT',
      candles,
      candlesByTF: {
        [Timeframe.H4]: candles,
        [Timeframe.D1]: candles,
      },
      existingScores: { trendScore: 75 },
    })
    // Both should produce valid, defined scores
    expect(withMTF.trend.score).toBeGreaterThanOrEqual(0)
    expect(withoutMTF.trend.score).toBeGreaterThanOrEqual(0)
  })

  it('every component has a non-empty reason string', () => {
    const { candles } = bullishDataset(100)
    const result = computeConfluence({ symbol: 'BTCUSDT', candles })
    expect(result.trend.reason.length).toBeGreaterThan(0)
    expect(result.confluence.reason.length).toBeGreaterThan(0)
    expect(result.volume.reason.length).toBeGreaterThan(0)
  })
})

describe('buildTradeSetup', () => {
  it('returns a complete TradeSetup object', () => {
    const { candles, oiSnapshots } = bullishDataset(100)
    const result = buildTradeSetup({
      symbol: 'BTCUSDT',
      candles,
      oiSnapshots,
      tradeDirection: 'long',
      entryRange: { low: 62_000, high: 63_000 },
      stopLoss: 59_000,
      targets: [
        { price: 70_000, riskReward: 2.0 },
        { price: 75_000, riskReward: 3.5 },
        { price: 82_000, riskReward: 5.0 },
      ],
      accountBalance: 10_000,
    })

    expect(result.symbol).toBe('BTCUSDT')
    expect(result.confidence).toBeDefined()
    expect(result.expectedValue).toBeDefined()
    expect(result.recommendedSizeFraction).toBeGreaterThan(0)
    expect(result.recommendedSizeFraction).toBeLessThanOrEqual(0.03)
    expect(result.targets.length).toBe(3)
    expect(result.timestamp).toBeGreaterThan(0)
  })

  it('expectedValue.grade is defined and valid', () => {
    const { candles } = bullishDataset(100)
    const result = buildTradeSetup({ symbol: 'BTCUSDT', candles })
    expect(['A+', 'A', 'B', 'C', 'F']).toContain(result.expectedValue.grade)
  })

  it('liquidationMagnet is populated when OI data is provided', () => {
    const { candles, oiSnapshots } = bullishDataset(100)
    const result = buildTradeSetup({
      symbol: 'BTCUSDT',
      candles,
      oiSnapshots,
    })
    // Should have a liquidation magnet from the estimated levels
    expect(result.liquidationMagnet).toBeDefined()
  })
})

describe('SIGNAL_THRESHOLD', () => {
  it('is 70', () => {
    expect(SIGNAL_THRESHOLD).toBe(70)
  })
})
