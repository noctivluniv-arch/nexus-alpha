import { describe, it, expect } from 'vitest'
import {
  sma,
  ema,
  rollingMax,
  rollingMin,
  stdDev,
  clamp,
  percentChange,
  normalise,
  detectDivergence,
  hasSufficientData,
} from '../../lib/utils/math'

describe('sma', () => {
  it('returns correct SMA for simple series', () => {
    const result = sma([1, 2, 3, 4, 5], 3)
    expect(result[2]).toBeCloseTo(2)
    expect(result[3]).toBeCloseTo(3)
    expect(result[4]).toBeCloseTo(4)
  })

  it('returns NaN for positions with insufficient history', () => {
    const result = sma([1, 2, 3], 3)
    expect(isNaN(result[0])).toBe(true)
    expect(isNaN(result[1])).toBe(true)
    expect(result[2]).toBeCloseTo(2)
  })

  it('throws for period ≤ 0', () => {
    expect(() => sma([1, 2, 3], 0)).toThrow(RangeError)
    expect(() => sma([1, 2, 3], -1)).toThrow(RangeError)
  })

  it('handles period of 1 (identity)', () => {
    const input = [3, 1, 4, 1, 5]
    const result = sma(input, 1)
    input.forEach((v, i) => expect(result[i]).toBeCloseTo(v))
  })
})

describe('ema', () => {
  it('seeds with SMA of first period values', () => {
    const result = ema([1, 2, 3, 4, 5], 3)
    // Seed at index 2 = SMA(1,2,3) = 2
    expect(result[2]).toBeCloseTo(2)
    expect(isNaN(result[0])).toBe(true)
    expect(isNaN(result[1])).toBe(true)
  })

  it('EMA responds faster than SMA on a spike', () => {
    const data = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 100]
    const smaResult = sma(data, 5)
    const emaResult = ema(data, 5)
    // EMA last value should be higher than SMA last value
    expect(emaResult[emaResult.length - 1]).toBeGreaterThan(smaResult[smaResult.length - 1])
  })

  it('converges toward input values', () => {
    const constant = Array(30).fill(50)
    const result = ema(constant, 10)
    expect(result[result.length - 1]).toBeCloseTo(50, 3)
  })
})

describe('rollingMax', () => {
  it('returns the maximum in the window', () => {
    const result = rollingMax([1, 3, 2, 5, 4], 3)
    expect(result[2]).toBe(3)
    expect(result[3]).toBe(5)
    expect(result[4]).toBe(5)
  })

  it('returns NaN before window is full', () => {
    const result = rollingMax([1, 2, 3], 3)
    expect(isNaN(result[0])).toBe(true)
    expect(isNaN(result[1])).toBe(true)
    expect(result[2]).toBe(3)
  })
})

describe('rollingMin', () => {
  it('returns the minimum in the window', () => {
    const result = rollingMin([5, 3, 4, 1, 2], 3)
    expect(result[2]).toBe(3)
    expect(result[3]).toBe(1)
    expect(result[4]).toBe(1)
  })
})

describe('stdDev', () => {
  it('returns 0 for empty array', () => {
    expect(stdDev([])).toBe(0)
  })

  it('returns 0 for all-same values', () => {
    expect(stdDev([5, 5, 5, 5])).toBeCloseTo(0)
  })

  it('computes population std dev correctly', () => {
    // [2,4,4,4,5,5,7,9] has mean=5, variance=4, stdDev=2
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 5)
  })
})

describe('clamp', () => {
  it('clamps below min', () => expect(clamp(-5, 0, 10)).toBe(0))
  it('clamps above max', () => expect(clamp(15, 0, 10)).toBe(10))
  it('passes through values in range', () => expect(clamp(5, 0, 10)).toBe(5))
  it('handles equal min/max', () => expect(clamp(7, 5, 5)).toBe(5))
})

describe('percentChange', () => {
  it('calculates positive change', () => {
    expect(percentChange(100, 120)).toBeCloseTo(20)
  })
  it('calculates negative change', () => {
    expect(percentChange(100, 80)).toBeCloseTo(-20)
  })
  it('returns 0 when from is 0', () => {
    expect(percentChange(0, 100)).toBe(0)
  })
  it('handles negative base correctly', () => {
    // -100 to -80: moved 20 units in positive direction relative to |base|=100 → +20%
    expect(percentChange(-100, -80)).toBeCloseTo(20)
  })
})

describe('normalise', () => {
  it('maps min to outMin', () => {
    expect(normalise(0, 0, 100)).toBe(0)
  })
  it('maps max to outMax', () => {
    expect(normalise(100, 0, 100)).toBe(100)
  })
  it('maps midpoint correctly', () => {
    expect(normalise(50, 0, 100)).toBe(50)
  })
  it('returns outMin when range collapses', () => {
    expect(normalise(5, 5, 5, 0, 100)).toBe(0)
  })
  it('maps to custom output range', () => {
    expect(normalise(5, 0, 10, -1, 1)).toBeCloseTo(0)
  })
})

describe('detectDivergence', () => {
  it('returns none for insufficient data', () => {
    const result = detectDivergence([1, 2, 3], [1, 2, 3], 14)
    expect(result).toBe('none')
  })

  it('detects bearish divergence', () => {
    // Price makes higher high, momentum makes lower high
    const prices = Array(30).fill(100)
    prices[14] = 105  // prior high
    prices[29] = 110  // new higher high

    const momentum = Array(30).fill(50)
    momentum[14] = 70  // prior momentum high
    momentum[29] = 60  // momentum lower despite higher price

    expect(detectDivergence(prices, momentum, 14)).toBe('bearish')
  })

  it('detects bullish divergence', () => {
    // Price makes lower low, momentum makes higher low
    const prices = Array(30).fill(100)
    prices[14] = 90   // prior low
    prices[29] = 85   // new lower low

    const momentum = Array(30).fill(50)
    momentum[14] = 30  // prior momentum low
    momentum[29] = 35  // momentum higher despite lower price

    expect(detectDivergence(prices, momentum, 14)).toBe('bullish')
  })
})

describe('hasSufficientData', () => {
  it('returns false when array is shorter than required', () => {
    expect(hasSufficientData([1, 2], 3)).toBe(false)
  })

  it('returns false when tail contains NaN', () => {
    expect(hasSufficientData([1, NaN, 3], 3)).toBe(false)
  })

  it('returns true for valid data', () => {
    expect(hasSufficientData([1, 2, 3, 4, 5], 3)).toBe(true)
  })

  it('returns false for Infinity', () => {
    expect(hasSufficientData([Infinity, 2, 3], 3)).toBe(false)
  })
})
