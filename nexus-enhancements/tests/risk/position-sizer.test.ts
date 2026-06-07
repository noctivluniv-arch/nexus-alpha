import { describe, it, expect } from 'vitest'
import {
  computePositionSize,
  computePositionDollars,
  computeATR,
  computeKelly,
} from '../../lib/risk/position-sizer'
import { trendingCandles, sidewaysCandles } from '../fixtures'

describe('computeATR', () => {
  it('returns NaN for first period candles', () => {
    const candles = trendingCandles(20, 60_000, 100)
    const atr = computeATR(candles, 14)
    expect(isNaN(atr[0])).toBe(true)
    expect(isNaN(atr[13])).toBe(true)
    expect(isNaN(atr[14])).toBe(false)
  })

  it('returns larger ATR for more volatile candles', () => {
    const quietCandles = trendingCandles(30, 60_000, 50)
    const volatileCandles = trendingCandles(30, 60_000, 500)
    const atrQuiet = computeATR(quietCandles, 14)
    const atrVolatile = computeATR(volatileCandles, 14)
    const lastQuiet = atrQuiet.filter(v => !isNaN(v)).pop()!
    const lastVolatile = atrVolatile.filter(v => !isNaN(v)).pop()!
    expect(lastVolatile).toBeGreaterThan(lastQuiet)
  })

  it('result length matches input', () => {
    const candles = trendingCandles(50, 60_000, 100)
    expect(computeATR(candles, 14).length).toBe(50)
  })

  it('ATR is always non-negative', () => {
    const candles = trendingCandles(50, 60_000, 100)
    const atr = computeATR(candles, 14)
    atr.filter(v => !isNaN(v)).forEach(v => expect(v).toBeGreaterThanOrEqual(0))
  })
})

describe('computeKelly', () => {
  it('computes correct Kelly fraction', () => {
    // b=2.5, p=0.55, q=0.45 → f = (2.5×0.55 - 0.45)/2.5 = (1.375-0.45)/2.5 = 0.37
    expect(computeKelly(0.55, 2.5)).toBeCloseTo(0.37, 2)
  })

  it('returns 0 for negative EV setup', () => {
    // RR=1, p=0.30 → Kelly negative → clamped to 0
    expect(computeKelly(0.30, 1.0)).toBe(0)
  })

  it('is always ≥ 0', () => {
    const cases = [
      [0.30, 1.0], [0.40, 2.0], [0.60, 3.0], [0.20, 5.0],
    ] as const
    for (const [p, b] of cases) {
      expect(computeKelly(p, b)).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('computePositionSize', () => {
  const baseInput = {
    confluenceScore: 75,
    winRate: 0.55,
    riskRewardRatio: 2.5,
    candles: trendingCandles(60, 60_000, 100),
    maxRiskFraction: 0.02,
  }

  it('returns a riskFraction within hard limits [0.001, 0.03]', () => {
    const result = computePositionSize(baseInput)
    expect(result.riskFraction).toBeGreaterThanOrEqual(0.001)
    expect(result.riskFraction).toBeLessThanOrEqual(0.03)
  })

  it('reduces risk for low confluence scores', () => {
    const lowScore = computePositionSize({ ...baseInput, confluenceScore: 55 })
    const highScore = computePositionSize({ ...baseInput, confluenceScore: 85 })
    expect(highScore.riskFraction).toBeGreaterThan(lowScore.riskFraction)
  })

  it('reduces position size during high-volatility (high ATR) periods', () => {
    const normalCandles = trendingCandles(60, 60_000, 100)
    const volatileCandles = trendingCandles(60, 60_000, 2000)  // extreme moves
    const normal = computePositionSize({ ...baseInput, candles: normalCandles })
    const volatile = computePositionSize({ ...baseInput, candles: volatileCandles })
    expect(volatile.riskFraction).toBeLessThanOrEqual(normal.riskFraction)
  })

  it('fullKellyFraction and halfKellyFraction are consistent', () => {
    const result = computePositionSize(baseInput)
    expect(result.halfKellyFraction).toBeCloseTo(result.fullKellyFraction / 2, 5)
  })

  it('atrRatio is close to 1.0 for consistent trend candles', () => {
    const result = computePositionSize({ ...baseInput, candles: trendingCandles(60, 60_000, 100) })
    // For a consistent low-noise trend, ATR should be near mean
    expect(result.atrRatio).toBeGreaterThan(0.5)
    expect(result.atrRatio).toBeLessThan(3.0)
  })

  it('returns a non-empty recommendation string', () => {
    const result = computePositionSize(baseInput)
    expect(result.recommendation.length).toBeGreaterThan(10)
  })

  it('zero Kelly when EV is negative → uses fixed fractional', () => {
    const badSetup = { ...baseInput, riskRewardRatio: 1.0, winRate: 0.30 }
    const result = computePositionSize(badSetup)
    expect(result.fullKellyFraction).toBe(0)
    // Should still return a non-zero (fallback to fixed fractional)
    expect(result.riskFraction).toBeGreaterThan(0)
  })
})

describe('computePositionDollars', () => {
  it('computes correct dollar risk', () => {
    const sizing = {
      riskFraction: 0.02,
      positionFraction: 0.07,
      fullKellyFraction: 0.37,
      halfKellyFraction: 0.185,
      atrAdjustedRiskFraction: 0.02,
      atrRatio: 1.0,
      recommendation: '',
    }
    const { dollarRisk } = computePositionDollars(10_000, sizing, 60_000, 57_000)
    expect(dollarRisk).toBeCloseTo(200)  // 2% of $10,000
  })

  it('computes correct position size from SL distance', () => {
    // Entry $60,000, SL $57,000 → SL distance = 5%
    // Dollar risk = $200
    // Position = $200 / 0.05 = $4,000
    const sizing = {
      riskFraction: 0.02,
      positionFraction: 0.07,
      fullKellyFraction: 0.37,
      halfKellyFraction: 0.185,
      atrAdjustedRiskFraction: 0.02,
      atrRatio: 1.0,
      recommendation: '',
    }
    const { positionSizeUsd, stopDistancePct } = computePositionDollars(
      10_000,
      sizing,
      60_000,
      57_000,
    )
    expect(stopDistancePct).toBeCloseTo(0.05, 5)
    expect(positionSizeUsd).toBeCloseTo(4_000, 0)
  })

  it('positionSizeCoins = positionSizeUsd / entryPrice', () => {
    const sizing = {
      riskFraction: 0.02,
      positionFraction: 0.07,
      fullKellyFraction: 0.37,
      halfKellyFraction: 0.185,
      atrAdjustedRiskFraction: 0.02,
      atrRatio: 1.0,
      recommendation: '',
    }
    const result = computePositionDollars(10_000, sizing, 60_000, 57_000)
    expect(result.positionSizeCoins).toBeCloseTo(result.positionSizeUsd / 60_000, 8)
  })
})
