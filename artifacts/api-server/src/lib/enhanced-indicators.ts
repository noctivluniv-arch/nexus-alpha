/**
 * @file enhanced-indicators.ts
 * Drop-in additions for the NexusAlpha api-server.
 *
 * Add this file to: artifacts/api-server/src/lib/enhanced-indicators.ts
 *
 * Implements (self-contained — no external imports needed):
 *   • CVD           — Cumulative Volume Delta + divergence
 *   • StochRSI      — Stochastic applied to RSI values
 *   • OI Regime     — Four-quadrant Open Interest regime
 *   • MTF Alignment — Multi-timeframe weighted bias score
 *   • EV Calculator — Expected Value per R for any setup
 *   • Position Sizer— Kelly + ATR dynamic sizing
 *
 * These are adapted from the nexus-enhancements library in the repo root
 * into a single file to avoid workspace import path issues.
 */

import type { AggregatedOHLC } from './indicators'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OHLCData {
  timestamps: number[]
  closes: number[]
  highs: number[]
  lows: number[]
  volumes: number[]
}

export interface CVDResult {
  cvdTrend: 'rising' | 'falling' | 'flat'
  divergence: 'bullish' | 'bearish' | 'none'
  score: number          // 0–100, bullish = high
  summary: string
}

export interface StochRSIResult {
  k: number
  d: number
  zone: 'oversold' | 'overbought' | 'neutral'
  crossover: 'bullish' | 'bearish' | 'none'
  score: number          // 0–100
  summary: string
}

export type OIRegime =
  | 'long_buildup'
  | 'short_squeeze'
  | 'short_buildup'
  | 'long_liquidation'
  | 'neutral'

export interface OIRegimeResult {
  regime: OIRegime
  score: number          // 0–100
  summary: string
}

export interface MTFResult {
  score: number          // 0–100
  agreementPct: number   // 0–100
  signals: Array<{ tf: string; bias: 'bullish' | 'bearish' | 'neutral' }>
  dissenter?: string
  summary: string
}

export interface EVResult {
  evPerR: number
  grade: 'A+' | 'A' | 'B' | 'C' | 'F'
  breakEvenWinRate: number
  assumedWinRate: number
  summary: string
}

export interface SizingResult {
  riskFraction: number     // fraction of account to risk
  atrRatio: number         // current ATR vs 20-period mean
  halfKelly: number
  recommendation: string
}

export interface EnhancedIndicators {
  cvd: CVDResult
  stochRsi4h: StochRSIResult
  stochRsiDaily: StochRSIResult
  oiRegime: OIRegimeResult
  mtf: MTFResult
  ev: (rr: number) => EVResult
  sizing: (rr: number, atr: number | null, price: number) => SizingResult
  /** Formatted section to append to the Gemini market data block */
  marketSection: string
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function smaArr(values: number[], period: number): number[] {
  return values.map((_, i) => {
    if (i < period - 1) return NaN
    let s = 0
    for (let j = i - period + 1; j <= i; j++) s += values[j]
    return s / period
  })
}

function emaArr(values: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const result: number[] = new Array(values.length).fill(NaN)
  let seed = 0
  for (let i = 0; i < period; i++) seed += values[i]
  result[period - 1] = seed / period
  for (let i = period; i < values.length; i++) {
    result[i] = values[i] * k + result[i - 1] * (1 - k)
  }
  return result
}

function rollingMax(values: number[], period: number): number[] {
  return values.map((_, i) => {
    if (i < period - 1) return NaN
    let m = -Infinity
    for (let j = i - period + 1; j <= i; j++) if (values[j] > m) m = values[j]
    return m
  })
}

function rollingMin(values: number[], period: number): number[] {
  return values.map((_, i) => {
    if (i < period - 1) return NaN
    let m = Infinity
    for (let j = i - period + 1; j <= i; j++) if (values[j] < m) m = values[j]
    return m
  })
}

function computeRSI(closes: number[], period = 14): number[] {
  if (closes.length < period + 1) return closes.map(() => NaN)
  const gains: number[] = [NaN]
  const losses: number[] = [NaN]
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    gains.push(d > 0 ? d : 0)
    losses.push(d < 0 ? -d : 0)
  }
  const k = 1 / period
  const ag = emaArr(gains.slice(1), period).map(v => isNaN(v) ? NaN : v)
  const al = emaArr(losses.slice(1), period).map(v => isNaN(v) ? NaN : v)
  const rsi: number[] = [NaN]
  for (let i = 0; i < ag.length; i++) {
    if (isNaN(ag[i])) { rsi.push(NaN); continue }
    if (al[i] === 0) { rsi.push(100); continue }
    rsi.push(100 - 100 / (1 + ag[i] / al[i]))
  }
  return rsi
}

function computeATR(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  const tr: number[] = [NaN]
  for (let i = 1; i < closes.length; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1])))
  }
  const result: number[] = new Array(closes.length).fill(NaN)
  let seed = 0, cnt = 0
  for (let i = 1; i <= period; i++) { if (!isNaN(tr[i])) { seed += tr[i]; cnt++ } }
  if (!cnt) return result
  result[period] = seed / cnt
  for (let i = period + 1; i < closes.length; i++) {
    if (!isNaN(tr[i])) result[i] = (result[i-1] * (period-1) + tr[i]) / period
    else result[i] = result[i-1]
  }
  return result
}

// ─── CVD ─────────────────────────────────────────────────────────────────────

export function computeCVD(data: OHLCData): CVDResult {
  const { closes, highs, lows, volumes } = data
  if (closes.length < 30) {
    return { cvdTrend: 'flat', divergence: 'none', score: 50, summary: 'Insufficient data' }
  }

  // Delta per candle using midpoint method
  const delta = closes.map((c, i) => {
    const range = highs[i] - lows[i]
    if (range === 0) return 0
    return ((c - lows[i]) / range - (highs[i] - c) / range) * volumes[i]
  })

  // Cumulative delta
  const cvd: number[] = []
  let running = 0
  for (const d of delta) { running += d; cvd.push(running) }

  // CVD trend: compare last 20 vs prior 20 means
  const win = Math.min(20, Math.floor(cvd.length / 2))
  const recentMean = cvd.slice(-win).reduce((a,b)=>a+b,0)/win
  const priorMean  = cvd.slice(-win*2,-win).reduce((a,b)=>a+b,0)/win
  const cvdTrend: 'rising' | 'falling' | 'flat' =
    recentMean > priorMean * 1.01 ? 'rising' :
    recentMean < priorMean * 0.99 ? 'falling' : 'flat'

  // Divergence (last 14 candles vs prior 14)
  const lb = 14
  const priceHighRecent = Math.max(...closes.slice(-lb))
  const priceHighPrior  = Math.max(...closes.slice(-lb*2,-lb))
  const priceLowRecent  = Math.min(...closes.slice(-lb))
  const priceLowPrior   = Math.min(...closes.slice(-lb*2,-lb))
  const cvdHighRecent   = Math.max(...cvd.slice(-lb))
  const cvdHighPrior    = Math.max(...cvd.slice(-lb*2,-lb))
  const cvdLowRecent    = Math.min(...cvd.slice(-lb))
  const cvdLowPrior     = Math.min(...cvd.slice(-lb*2,-lb))

  let divergence: 'bullish' | 'bearish' | 'none' = 'none'
  if (priceLowRecent < priceLowPrior && cvdLowRecent > cvdLowPrior) divergence = 'bullish'
  else if (priceHighRecent > priceHighPrior && cvdHighRecent < cvdHighPrior) divergence = 'bearish'

  // Score
  let score = 50
  if (cvdTrend === 'rising') score += 20
  else if (cvdTrend === 'falling') score -= 20
  if (divergence === 'bullish') score += 20
  if (divergence === 'bearish') score -= 20
  const cvdSmaLast = smaArr(cvd, 20)[cvd.length-1]
  if (!isNaN(cvdSmaLast)) score += cvd[cvd.length-1] > cvdSmaLast ? 10 : -10
  score = clamp(score, 0, 100)

  const parts = [`CVD trend: ${cvdTrend}`]
  if (divergence !== 'none') parts.push(`${divergence} divergence`)
  return { cvdTrend, divergence, score, summary: parts.join(' | ') }
}

// ─── StochRSI ────────────────────────────────────────────────────────────────

export function computeStochRSI(
  closes: number[],
  rsiPeriod = 14,
  stochPeriod = 14,
  smoothK = 3,
  smoothD = 3,
): StochRSIResult {
  const neutral: StochRSIResult = { k: 50, d: 50, zone: 'neutral', crossover: 'none', score: 50, summary: 'Insufficient data' }
  if (closes.length < rsiPeriod + stochPeriod + smoothK + smoothD + 5) return neutral

  const rsiValues = computeRSI(closes, rsiPeriod)
  const rsiMax = rollingMax(rsiValues, stochPeriod)
  const rsiMin = rollingMin(rsiValues, stochPeriod)
  const rawStoch = rsiValues.map((v, i) => {
    const range = rsiMax[i] - rsiMin[i]
    if (isNaN(v) || isNaN(rsiMax[i])) return NaN
    if (range === 0) return v >= 50 ? 100 : 0
    return ((v - rsiMin[i]) / range) * 100
  })

  const kLine = smaArr(rawStoch, smoothK)
  const dLine = smaArr(kLine, smoothD)
  const kLast = kLine[kLine.length-1]
  const dLast = dLine[dLine.length-1]
  const kPrev = kLine[kLine.length-2]
  const dPrev = dLine[dLine.length-2]
  if (isNaN(kLast) || isNaN(dLast)) return neutral

  const zone: 'oversold'|'overbought'|'neutral' = kLast < 20 ? 'oversold' : kLast > 80 ? 'overbought' : 'neutral'
  const crossover: 'bullish'|'bearish'|'none' =
    !isNaN(kPrev) && !isNaN(dPrev)
      ? (kPrev <= dPrev && kLast > dLast ? 'bullish' : kPrev >= dPrev && kLast < dLast ? 'bearish' : 'none')
      : 'none'

  let score = 50
  score += (kLast - 50) * 0.4
  if (crossover === 'bullish' && zone === 'oversold') score += 20
  else if (crossover === 'bullish') score += 10
  if (crossover === 'bearish' && zone === 'overbought') score -= 20
  else if (crossover === 'bearish') score -= 10
  if (kLast > dLast) score += 5; else score -= 5
  score = clamp(score, 0, 100)

  const summary = `K=${kLast.toFixed(1)} D=${dLast.toFixed(1)} | ${zone}${crossover !== 'none' ? ` | ${crossover} crossover` : ''}`
  return { k: kLast, d: dLast, zone, crossover, score, summary }
}

// ─── OI Regime ───────────────────────────────────────────────────────────────

export function inferOIRegime(
  oiUsd: number | null,
  closes: number[],
  volumes: number[],
): OIRegimeResult {
  if (closes.length < 10 || oiUsd === null) {
    return { regime: 'neutral', score: 50, summary: 'OI data unavailable' }
  }

  // Price direction: last 5 vs prior 5 closes
  const lb = Math.min(5, Math.floor(closes.length / 2))
  const recentPrice = closes.slice(-lb).reduce((a,b)=>a+b,0)/lb
  const priorPrice  = closes.slice(-lb*2,-lb).reduce((a,b)=>a+b,0)/lb
  const priceRising = recentPrice > priorPrice * 1.001

  // OI proxy: use volume momentum as a relative OI change signal
  // (volume rising = more contracts being opened)
  const recentVol = volumes.slice(-lb).reduce((a,b)=>a+b,0)/lb
  const priorVol  = volumes.slice(-lb*2,-lb).reduce((a,b)=>a+b,0)/lb
  const oiRising  = recentVol > priorVol * 1.02

  let regime: OIRegime
  if (priceRising && oiRising)   regime = 'long_buildup'
  else if (priceRising && !oiRising)  regime = 'short_squeeze'
  else if (!priceRising && oiRising)  regime = 'short_buildup'
  else                                 regime = 'long_liquidation'

  const regimeScore: Record<OIRegime, number> = {
    long_buildup: 78, short_squeeze: 62, neutral: 50, long_liquidation: 38, short_buildup: 22,
  }
  const score = regimeScore[regime]

  const descMap: Record<OIRegime, string> = {
    long_buildup:     'Price ↑ + OI ↑ — new longs entering (strong bullish)',
    short_squeeze:    'Price ↑ + OI ↓ — short squeeze (bullish but fading)',
    neutral:          'Mixed signals',
    long_liquidation: 'Price ↓ + OI ↓ — long liquidation (bearish, potential reversal near)',
    short_buildup:    'Price ↓ + OI ↑ — new shorts entering (strong bearish)',
  }
  return { regime, score, summary: descMap[regime] }
}

// ─── MTF Alignment ───────────────────────────────────────────────────────────

function scoreTF(closes: number[], highs: number[], lows: number[]): { score: number; bias: 'bullish'|'bearish'|'neutral' } {
  if (closes.length < 27) return { score: 50, bias: 'neutral' }
  const lastClose = closes[closes.length-1]

  // EMA score
  const e20 = emaArr(closes, 20)[closes.length-1]
  const e50 = closes.length >= 50 ? emaArr(closes, 50)[closes.length-1] : e20
  const e200 = closes.length >= 200 ? emaArr(closes, 200)[closes.length-1] : e50
  let emaScore = 0
  if (lastClose > e20) emaScore += 0.33
  if (lastClose > e50) emaScore += 0.34
  if (lastClose > e200) emaScore += 0.33
  if (e20 > e50) emaScore += 0.17
  if (e50 > e200) emaScore += 0.17
  emaScore = emaScore * 2 - 1

  // MACD
  const fast = emaArr(closes, 12)
  const slow = emaArr(closes, 26)
  const macdLine = fast.map((v,i) => isNaN(v)||isNaN(slow[i]) ? NaN : v - slow[i])
  const validMacd = macdLine.filter(v => !isNaN(v))
  const signalLine = validMacd.length >= 9 ? emaArr(validMacd, 9) : []
  const lastMacd = macdLine[macdLine.length-1]
  const lastSignal = signalLine[signalLine.length-1]
  const macdHist = (!isNaN(lastMacd) && lastSignal !== undefined && !isNaN(lastSignal)) ? lastMacd - lastSignal : 0
  const macdScore = macdHist > 0 ? 1 : -1

  // RSI
  const rsiVals = computeRSI(closes, 14)
  const rsiLast = rsiVals[rsiVals.length-1] ?? 50
  const rsiScore = rsiLast > 55 ? 1 : rsiLast < 45 ? -1 : (rsiLast-50)/5

  const composite = emaScore * 0.5 + macdScore * 0.3 + rsiScore * 0.2
  const score = clamp((composite + 1) / 2 * 100, 0, 100)
  const bias: 'bullish'|'bearish'|'neutral' = score > 55 ? 'bullish' : score < 45 ? 'bearish' : 'neutral'
  return { score, bias }
}

export function computeMTFAlignment(
  candles4h: AggregatedOHLC,
  daily: OHLCData,
): MTFResult {
  const noData: MTFResult = { score: 50, agreementPct: 0, signals: [], summary: 'Insufficient data' }
  if (!candles4h.closes.length || !daily.closes.length) return noData

  const weights = { '4H': 0.35, '1D': 0.50, '1W': 0.15 }

  const tf4h  = scoreTF(candles4h.closes, candles4h.highs, candles4h.lows)
  const tfD   = scoreTF(daily.closes,     daily.highs,     daily.lows)

  const signals = [
    { tf: '4H', bias: tf4h.bias },
    { tf: '1D', bias: tfD.bias },
  ]

  let weightedSum = tf4h.score * weights['4H'] + tfD.score * weights['1D']
  let totalWeight  = weights['4H'] + weights['1D']

  const bullCount = signals.filter(s => s.bias === 'bullish').length
  const bearCount = signals.filter(s => s.bias === 'bearish').length
  const dominant  = bullCount >= bearCount ? 'bullish' : 'bearish'
  const agreementPct = (Math.max(bullCount, bearCount) / signals.length) * 100

  // Penalty if 1D opposes
  const daily1dBias = tfD.bias
  const daily4hBias = tf4h.bias
  let score = weightedSum / totalWeight
  if (daily1dBias !== 'neutral' && daily4hBias !== 'neutral' && daily1dBias !== daily4hBias) {
    score *= 0.85
  }

  score = clamp(score, 0, 100)
  const dissenter = daily1dBias !== dominant && daily1dBias !== 'neutral' ? '1D' : undefined

  const tfStr = signals.map(s => `${s.tf}:${s.bias[0].toUpperCase()}`).join(' ')
  const summary = `${tfStr} | Agreement ${agreementPct.toFixed(0)}%${dissenter ? ` | ⚠ Dissenter: ${dissenter}` : ''}`
  return { score, agreementPct, signals, dissenter, summary }
}

// ─── EV Calculator ───────────────────────────────────────────────────────────

export function computeEV(rr: number, confluenceScore: number): EVResult {
  if (rr <= 0) rr = 2.5
  // Win rate estimate: 0.20 + 0.60 × (score/100)
  const winRate    = clamp(0.20 + 0.60 * (confluenceScore / 100), 0.20, 0.80)
  const evPerR     = winRate * rr - (1 - winRate)
  const breakEven  = 1 / (1 + rr)
  const grade: EVResult['grade'] =
    evPerR >= 0.5 ? 'A+' : evPerR >= 0.3 ? 'A' : evPerR >= 0.1 ? 'B' : evPerR >= 0 ? 'C' : 'F'

  const sign = evPerR >= 0 ? '+' : ''
  const summary = `EV=${sign}${evPerR.toFixed(2)}R | WinRate~${(winRate*100).toFixed(0)}% | Break-even ${(breakEven*100).toFixed(0)}% | Grade ${grade}`
  return { evPerR, grade, breakEvenWinRate: breakEven, assumedWinRate: winRate, summary }
}

// ─── Position Sizer ──────────────────────────────────────────────────────────

export function computeSizing(
  confluenceScore: number,
  rr: number,
  atrValue: number | null,
  closes: number[],
  highs: number[],
  lows: number[],
  maxRisk = 0.02,
): SizingResult {
  // Fixed fractional baseline adjusted by confidence
  const confScalar  = clamp((confluenceScore - 50) / 50, 0, 1)
  const baseRisk    = maxRisk * (0.6 + 0.4 * confScalar)

  // Kelly fraction
  const winRate = clamp(0.20 + 0.60 * (confluenceScore / 100), 0.20, 0.80)
  const q = 1 - winRate
  const kelly = Math.max(0, (rr * winRate - q) / rr)
  const halfKelly = kelly / 2

  // ATR volatility adjustment
  const atrSeries = computeATR(highs, lows, closes, 14)
  const validATR = atrSeries.filter(v => !isNaN(v))
  const currentATR = atrValue ?? (validATR[validATR.length-1] ?? 0)
  const meanATR = validATR.slice(-20).reduce((a,b)=>a+b,0) / Math.min(20, validATR.length)
  const atrRatio = meanATR > 0 ? currentATR / meanATR : 1
  let atrScalar = 1
  if (atrRatio > 1.5) atrScalar = clamp(1 - (atrRatio-1)*0.5, 0.5, 1)
  else if (atrRatio < 0.8) atrScalar = clamp(1 + (1-atrRatio)*0.25, 1, 1.25)

  const riskFraction = clamp(Math.min(baseRisk, baseRisk * atrScalar), 0.005, 0.03)

  let recommendation: string
  if (confluenceScore < 70)
    recommendation = `Score di bawah threshold — skip atau max ${(riskFraction*100).toFixed(1)}% risk`
  else if (atrRatio > 1.5)
    recommendation = `Volatilitas tinggi (ATR ${atrRatio.toFixed(1)}× rata-rata) — kurangi ke ${(riskFraction*100).toFixed(1)}% risk`
  else if (kelly === 0)
    recommendation = `Kelly negatif (EV negatif) — tidak disarankan entry`
  else
    recommendation = `Risk ${(riskFraction*100).toFixed(1)}% dari akun | Half-Kelly: ${(halfKelly*100).toFixed(1)}%`

  return { riskFraction, atrRatio, halfKelly, recommendation }
}

// ─── Main: Compute All Enhanced Indicators ───────────────────────────────────

export function computeEnhancedIndicators(params: {
  hourly: OHLCData
  candles4h: AggregatedOHLC
  daily: OHLCData
  currentOIUsd: number | null
  currentPrice: number
  currentATR: number | null
  confidence: number     // existing confidence score 0–100
  rr: number             // primary risk-reward ratio
}): EnhancedIndicators {
  const { hourly, candles4h, daily, currentOIUsd, currentATR, confidence, rr } = params

  const cvd          = computeCVD(hourly)
  const stochRsi4h   = computeStochRSI(candles4h.closes)
  const stochRsiDaily= computeStochRSI(daily.closes)
  const oiRegime     = inferOIRegime(currentOIUsd, daily.closes, daily.volumes)
  const mtf          = computeMTFAlignment(candles4h, daily)

  const ev      = (rrVal: number) => computeEV(rrVal, confidence)
  const sizing  = (rrVal: number, atr: number | null, _price: number) =>
    computeSizing(confidence, rrVal, atr, daily.closes, daily.highs, daily.lows)

  // ── Build market section string (appended to Gemini prompt) ──────────────
  const evResult  = ev(rr)
  const sizeResult = sizing(rr, currentATR, params.currentPrice)

  const marketSection = `
--- ENHANCED INDICATORS ---
CVD (Volume Delta): ${cvd.summary}
StochRSI 4H: ${stochRsi4h.summary}
StochRSI 1D: ${stochRsiDaily.summary}
OI Regime: ${oiRegime.regime.replace('_',' ').toUpperCase()} — ${oiRegime.summary}
MTF Alignment: ${mtf.summary}

--- EXPECTED VALUE & POSITION SIZING ---
EV at 1:${rr.toFixed(1)} R:R: ${evResult.summary}
Recommended Risk: ${sizeResult.recommendation}
ATR Volatility Ratio: ${sizeResult.atrRatio.toFixed(2)}× (${sizeResult.atrRatio > 1.5 ? 'HIGH — reduce size' : sizeResult.atrRatio < 0.8 ? 'LOW — can increase slightly' : 'NORMAL'})`.trim()

  return { cvd, stochRsi4h, stochRsiDaily, oiRegime, mtf, ev, sizing, marketSection }
}
