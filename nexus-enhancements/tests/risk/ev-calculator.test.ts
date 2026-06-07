import { describe, it, expect } from 'vitest'
import {
  computeEV,
  estimateWinRate,
  computeBlendedEV,
  maxConsecutiveLosses,
} from '../../lib/risk/ev-calculator'

describe('estimateWinRate', () => {
  it('returns ~50% at confluence score 50', () => {
    expect(estimateWinRate(50)).toBeCloseTo(0.50, 1)
  })

  it('returns ~80% at confluence score 100 (max bound)', () => {
    expect(estimateWinRate(100)).toBeCloseTo(0.80, 3)
  })

  it('returns ~20% at confluence score 0 (min bound)', () => {
    expect(estimateWinRate(0)).toBeCloseTo(0.20, 3)
  })

  it('is monotonically increasing', () => {
    const scores = [0, 20, 40, 60, 80, 100]
    const rates = scores.map(estimateWinRate)
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i]).toBeGreaterThan(rates[i - 1])
    }
  })

  it('clamps scores outside [0,100]', () => {
    expect(estimateWinRate(-10)).toBe(estimateWinRate(0))
    expect(estimateWinRate(150)).toBe(estimateWinRate(100))
  })
})

describe('computeEV', () => {
  it('correctly computes positive EV for good setup', () => {
    // RR=2.5, winRate=0.55 → EV = 0.55×2.5 − 0.45×1 = 1.375 − 0.45 = 0.925R
    const result = computeEV({ riskRewardRatio: 2.5, winRate: 0.55 })
    expect(result.evPerR).toBeCloseTo(0.925, 3)
    expect(result.grade).toBe('A+')
  })

  it('computes negative EV for bad setup', () => {
    // RR=1.0, winRate=0.30 → EV = 0.30×1 − 0.70×1 = −0.40R
    const result = computeEV({ riskRewardRatio: 1.0, winRate: 0.30 })
    expect(result.evPerR).toBeCloseTo(-0.40, 3)
    expect(result.grade).toBe('F')
  })

  it('uses confluenceScore to estimate winRate when winRate not provided', () => {
    const score75 = computeEV({ riskRewardRatio: 2.5, confluenceScore: 75 })
    const score50 = computeEV({ riskRewardRatio: 2.5, confluenceScore: 50 })
    // Higher confluence → higher win rate → higher EV
    expect(score75.evPerR).toBeGreaterThan(score50.evPerR)
  })

  it('breakEvenWinRate formula is correct: 1/(1+RR)', () => {
    const result = computeEV({ riskRewardRatio: 2.5, winRate: 0.5 })
    expect(result.breakEvenWinRate).toBeCloseTo(1 / 3.5, 5)
  })

  it('throws for invalid RR', () => {
    expect(() => computeEV({ riskRewardRatio: 0, winRate: 0.5 })).toThrow(RangeError)
    expect(() => computeEV({ riskRewardRatio: -1, winRate: 0.5 })).toThrow(RangeError)
  })

  it('grade A+ when EV ≥ 0.5R', () => {
    const result = computeEV({ riskRewardRatio: 3, winRate: 0.60 })
    expect(result.grade).toBe('A+')
  })

  it('grade A when 0.3 ≤ EV < 0.5R', () => {
    // RR=2, winRate=0.55 → EV = 0.55×2 - 0.45 = 0.65R ... let me recalculate
    // Need EV in [0.3, 0.5): RR=2, winRate=0.45 → EV = 0.45×2 - 0.55 = 0.35
    const result = computeEV({ riskRewardRatio: 2, winRate: 0.45 })
    expect(result.evPerR).toBeCloseTo(0.35, 3)
    expect(result.grade).toBe('A')
  })

  it('grade B when 0.1 ≤ EV < 0.3R', () => {
    // RR=1.5, winRate=0.45 → EV = 0.45×1.5 - 0.55 = 0.675 - 0.55 = 0.125
    const result = computeEV({ riskRewardRatio: 1.5, winRate: 0.45 })
    expect(result.evPerR).toBeCloseTo(0.125, 3)
    expect(result.grade).toBe('B')
  })

  it('grade C when EV is near zero positive', () => {
    // breakEven for RR=2 is 1/3 = 0.3333...
    // Use 0.335 to be clearly above break-even → tiny positive EV → grade C
    const result = computeEV({ riskRewardRatio: 2, winRate: 0.335 })
    expect(result.evPerR).toBeGreaterThanOrEqual(0)
    expect(result.evPerR).toBeLessThan(0.1)
    expect(result.grade).toBe('C')
  })

  it('summary is a non-empty string', () => {
    const result = computeEV({ riskRewardRatio: 2.5, winRate: 0.55 })
    expect(result.summary.length).toBeGreaterThan(20)
  })
})

describe('computeBlendedEV', () => {
  it('produces correct weighted RR', () => {
    // 50% at TP1 RR=2, 30% at TP2 RR=3, 20% at TP3 RR=4
    // Blended = 2×0.5 + 3×0.3 + 4×0.2 = 1 + 0.9 + 0.8 = 2.7
    const result = computeBlendedEV(
      [{ rr: 2, fraction: 0.5 }, { rr: 3, fraction: 0.3 }, { rr: 4, fraction: 0.2 }],
      0.55,
    )
    expect(result.riskRewardRatio).toBeCloseTo(2.7, 3)
  })

  it('throws when fractions do not sum to 1', () => {
    expect(() =>
      computeBlendedEV([{ rr: 2, fraction: 0.5 }, { rr: 3, fraction: 0.3 }], 0.55),
    ).toThrow()
  })
})

describe('maxConsecutiveLosses', () => {
  it('computes correctly for 2% risk, 20% drawdown limit', () => {
    // (1-0.02)^n ≥ 0.80 → n ≤ log(0.80)/log(0.98) ≈ 11.2 → 11
    const result = maxConsecutiveLosses(0.02, 0.20)
    expect(result).toBe(11)
  })

  it('increases with smaller risk per trade', () => {
    const n1 = maxConsecutiveLosses(0.02, 0.20)
    const n2 = maxConsecutiveLosses(0.01, 0.20)
    expect(n2).toBeGreaterThan(n1)
  })

  it('throws for invalid riskPerTrade', () => {
    expect(() => maxConsecutiveLosses(0, 0.20)).toThrow(RangeError)
    expect(() => maxConsecutiveLosses(1, 0.20)).toThrow(RangeError)
  })
})
