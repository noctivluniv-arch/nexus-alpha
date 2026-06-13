/**
 * Pure Rule-Based Signal Engine — menggantikan Gemini AI
 * Deterministik, transparan, tidak perlu API key
 * 
 * SWING ENGINE: 1D + 4H confluence
 * SCALP ENGINE: 4H + 1H confluence
 */

export interface RuleBasedSignalInput {
  pair: string;
  price: number;
  // EMAs
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  // RSI
  rsi1h: number | null;
  rsi4h: number | null;
  rsi1d: number | null;
  rsi1w: number | null;
  rsiDivergence: string;
  // MACD 4H
  macd4h: { macd: number; signal: number; histogram: number } | null;
  // MACD 1D
  macd1d: { macd: number; signal: number; histogram: number } | null;
  // Bollinger Bands
  bb: { upper: number; middle: number; lower: number; bandwidth: number } | null;
  // Stochastic
  stoch4h: { k: number; d: number } | null;
  stoch1h: { k: number; d: number } | null;
  // Volume
  volAvg30: number;
  volRecent: number;
  volH1: number;
  volH6: number;
  // Structure
  trend4h: string;
  trend1d: string;
  bos: { direction: string; price: number };
  // S/R Levels
  sup1: number; sup2: number; sup3: number;
  res1: number; res2: number; res3: number;
  // Ichimoku
  ichimoku: {
    tenkan: number | null; kijun: number | null;
    cloudTop: number | null; cloudBottom: number | null;
    priceVsCloud: string; trend: string;
  } | null;
  // WaveTrend
  waveTrend: { wt1: number | null; wt2: number | null; cross: string; zone: string } | null;
  // VWAP
  vwap: { vwap: number; upperBand: number; lowerBand: number } | null;
  // Pivots
  pivots: { pp: number; r1: number; r2: number; s1: number; s2: number } | null;
  // Derivatives
  fundingRate: number | null;
  lsRatio: number | null;
  oiUsd: number | null;
  // Macro
  fgi: { value: number; label: string } | null;
  btcDom: number | null;
  // ATR
  atr14: number | null;
  // Change
  change24h: string;
  high24h: number;
  low24h: number;
}

export interface ScoreBreakdown {
  trend: number;        // /20
  confluence: number;   // /20
  srLevel: number;      // /20
  volume: number;       // /15
  sentiment: number;    // /10
  funding: number;      // /10
  macro: number;        // /5
  total: number;        // /100
}

export interface RuleBasedSignalOutput {
  side: "BUY" | "SELL" | "NO_TRADE";
  confidence: number;
  scoreBreakdown: ScoreBreakdown;
  entryRange: string;
  stopLoss: string;
  stopLossRiskPct: string;
  takeProfit: string[];
  takeProfitRR: string[];
  leverage: string;
  reasoning: string;
  confluences: string[];
  invalidation: string;
  traderStyle: string;
  expertMindset: string;
  timeframe: string;
  riskReward: string;
  // Scalp
  scalpSide: "LONG" | "SHORT" | "NO_SCALP";
  scalpEntry: string;
  scalpSL: string;
  scalpTP: string[];
  scalpLeverage: string;
  scalpTrigger: string;
  scalpNotes: string;
  // Spot
  spotEntry: string;
  longTermTarget: string;
  keySupport: string;
  keyResistance: string;
  // Scenarios
  bullishTarget: string;
  bearishTarget: string;
  baseCase: string;
  noTradeReason?: string;
  riskManagement: {
    stopDistancePct: string;
    suggestion: string;
  };
}

function fmt(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number): string {
  return `${n.toFixed(2)}%`;
}

// ─── SWING ENGINE ─────────────────────────────────────────────────────────────
export function scoreSwing(inp: RuleBasedSignalInput): {
  score: ScoreBreakdown;
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  confluences: string[];
} {
  const score: ScoreBreakdown = {
    trend: 0, confluence: 0, srLevel: 0,
    volume: 0, sentiment: 0, funding: 0, macro: 0, total: 0
  };
  const confluences: string[] = [];
  let bullCount = 0;
  let bearCount = 0;

  // ── TREND SCORE (20 pts) ──────────────────────────────────────────────────
  // EMA Stack alignment
  if (inp.ema20 && inp.ema50 && inp.ema200) {
    if (inp.price > inp.ema20 && inp.ema20 > inp.ema50 && inp.ema50 > inp.ema200) {
      score.trend += 12; bullCount++;
      confluences.push(`EMA stack bullish: harga > EMA20 > EMA50 > EMA200`);
    } else if (inp.price < inp.ema20 && inp.ema20 < inp.ema50 && inp.ema50 < inp.ema200) {
      score.trend += 12; bearCount++;
      confluences.push(`EMA stack bearish: harga < EMA20 < EMA50 < EMA200`);
    } else if (inp.price > inp.ema200) {
      score.trend += 6; bullCount++;
      confluences.push(`Harga di atas EMA200 — bias bullish jangka panjang`);
    } else {
      score.trend += 4; bearCount++;
      confluences.push(`Harga di bawah EMA200 — bias bearish jangka panjang`);
    }
  }

  // Ichimoku
  if (inp.ichimoku) {
    if (inp.ichimoku.priceVsCloud === "ABOVE" && inp.ichimoku.trend === "BULLISH") {
      score.trend += 5; bullCount++;
      confluences.push(`Ichimoku: harga di atas cloud, trend BULLISH`);
    } else if (inp.ichimoku.priceVsCloud === "BELOW" && inp.ichimoku.trend === "BEARISH") {
      score.trend += 5; bearCount++;
      confluences.push(`Ichimoku: harga di bawah cloud, trend BEARISH`);
    } else {
      score.trend += 2;
    }
  }

  // 4H Trend structure
  if (inp.trend4h === "BULLISH") { score.trend += 3; bullCount++; }
  else if (inp.trend4h === "BEARISH") { score.trend += 3; bearCount++; }

  score.trend = Math.min(20, score.trend);

  // ── CONFLUENCE SCORE (20 pts) ─────────────────────────────────────────────
  // RSI 1D
  if (inp.rsi1d !== null) {
    if (inp.rsi1d > 50 && inp.rsi1d < 70) {
      score.confluence += 5; bullCount++;
      confluences.push(`RSI 1D ${inp.rsi1d.toFixed(1)} — momentum bullish zona optimal`);
    } else if (inp.rsi1d < 50 && inp.rsi1d > 30) {
      score.confluence += 5; bearCount++;
      confluences.push(`RSI 1D ${inp.rsi1d.toFixed(1)} — momentum bearish`);
    } else if (inp.rsi1d <= 30) {
      score.confluence += 3; bullCount++;
      confluences.push(`RSI 1D ${inp.rsi1d.toFixed(1)} — oversold, potensi reversal bullish`);
    } else if (inp.rsi1d >= 70) {
      score.confluence += 2; bearCount++;
      confluences.push(`RSI 1D ${inp.rsi1d.toFixed(1)} — overbought, hati-hati`);
    }
  }

  // MACD 4H
  if (inp.macd4h) {
    if (inp.macd4h.histogram > 0 && inp.macd4h.macd > inp.macd4h.signal) {
      score.confluence += 5; bullCount++;
      confluences.push(`MACD 4H bullish cross, histogram positif ${inp.macd4h.histogram.toFixed(4)}`);
    } else if (inp.macd4h.histogram < 0 && inp.macd4h.macd < inp.macd4h.signal) {
      score.confluence += 5; bearCount++;
      confluences.push(`MACD 4H bearish cross, histogram negatif ${inp.macd4h.histogram.toFixed(4)}`);
    } else {
      score.confluence += 2;
    }
  }

  // Stochastic 4H
  if (inp.stoch4h) {
    if (inp.stoch4h.k < 20 && inp.stoch4h.k > inp.stoch4h.d) {
      score.confluence += 4; bullCount++;
      confluences.push(`Stoch 4H oversold + bullish cross: K=${inp.stoch4h.k.toFixed(1)}`);
    } else if (inp.stoch4h.k > 80 && inp.stoch4h.k < inp.stoch4h.d) {
      score.confluence += 4; bearCount++;
      confluences.push(`Stoch 4H overbought + bearish cross: K=${inp.stoch4h.k.toFixed(1)}`);
    } else {
      score.confluence += 1;
    }
  }

  // WaveTrend
  if (inp.waveTrend) {
    if (inp.waveTrend.cross === "BULLISH" && inp.waveTrend.zone === "OVERSOLD") {
      score.confluence += 4; bullCount++;
      confluences.push(`WaveTrend bullish cross dari zona oversold`);
    } else if (inp.waveTrend.cross === "BEARISH" && inp.waveTrend.zone === "OVERBOUGHT") {
      score.confluence += 4; bearCount++;
      confluences.push(`WaveTrend bearish cross dari zona overbought`);
    } else if (inp.waveTrend.cross === "BULLISH") {
      score.confluence += 2; bullCount++;
    } else if (inp.waveTrend.cross === "BEARISH") {
      score.confluence += 2; bearCount++;
    }
  }

  // RSI Divergence
  if (inp.rsiDivergence === "BULLISH_DIVERGENCE") {
    score.confluence += 2; bullCount++;
    confluences.push(`RSI divergence bullish terdeteksi`);
  } else if (inp.rsiDivergence === "BEARISH_DIVERGENCE") {
    score.confluence += 2; bearCount++;
    confluences.push(`RSI divergence bearish terdeteksi`);
  }

  score.confluence = Math.min(20, score.confluence);

  // ── S/R LEVEL SCORE (20 pts) ──────────────────────────────────────────────
  const atr = inp.atr14 ?? (inp.price * 0.02);
  const nearSup = Math.abs(inp.price - inp.sup1) < atr * 1.5;
  const nearRes = Math.abs(inp.price - inp.res1) < atr * 1.5;
  const nearVwap = inp.vwap && Math.abs(inp.price - inp.vwap.vwap) < atr;
  const nearPivot = inp.pivots && Math.abs(inp.price - inp.pivots.pp) < atr;
  const nearBBLower = inp.bb && Math.abs(inp.price - inp.bb.lower) < atr;
  const nearBBUpper = inp.bb && Math.abs(inp.price - inp.bb.upper) < atr;

  if (nearSup) {
    score.srLevel += 10; bullCount++;
    confluences.push(`Harga dekat support kuat ${fmt(inp.sup1)}`);
  }
  if (nearRes) {
    score.srLevel += 10; bearCount++;
    confluences.push(`Harga dekat resistance kuat ${fmt(inp.res1)}`);
  }
  if (nearBBLower) { score.srLevel += 5; bullCount++; confluences.push(`Harga menyentuh BB lower band`); }
  if (nearBBUpper) { score.srLevel += 5; bearCount++; confluences.push(`Harga menyentuh BB upper band`); }
  if (nearVwap) { score.srLevel += 3; confluences.push(`Harga dekat VWAP ${fmt(inp.vwap!.vwap)}`); }
  if (nearPivot) { score.srLevel += 2; confluences.push(`Harga dekat Daily Pivot Point ${fmt(inp.pivots!.pp)}`); }

  // BOS confirmation
  if (inp.bos.direction === "BULLISH" && bullCount > bearCount) {
    score.srLevel += 5; bullCount++;
    confluences.push(`BOS bullish terkonfirmasi di ${fmt(inp.bos.price)}`);
  } else if (inp.bos.direction === "BEARISH" && bearCount > bullCount) {
    score.srLevel += 5; bearCount++;
    confluences.push(`BOS bearish terkonfirmasi di ${fmt(inp.bos.price)}`);
  }

  score.srLevel = Math.min(20, score.srLevel);

  // ── VOLUME SCORE (15 pts) ─────────────────────────────────────────────────
  const volRatio = inp.volAvg30 > 0 ? inp.volRecent / inp.volAvg30 : 0;
  const volAcc = inp.volH6 > 0 ? inp.volH1 / (inp.volH6 / 6) : 0;

  if (volRatio >= 1.5) { score.volume += 8; confluences.push(`Volume 1.5x di atas rata-rata 30D — konfirmasi kuat`); }
  else if (volRatio >= 1.0) { score.volume += 5; }
  else if (volRatio >= 0.7) { score.volume += 3; }
  else { confluences.push(`Volume lemah (${volRatio.toFixed(2)}x avg) — sinyal kurang valid`); }

  if (volAcc >= 3) { score.volume += 7; confluences.push(`Volume acceleration ${volAcc.toFixed(1)}x — akumulasi terdeteksi`); }
  else if (volAcc >= 1.5) { score.volume += 4; }

  score.volume = Math.min(15, score.volume);

  // ── SENTIMENT SCORE (10 pts) ──────────────────────────────────────────────
  if (inp.fgi) {
    // Contrarian: extreme fear = buy opportunity, extreme greed = sell opportunity
    if (inp.fgi.value <= 25 && bullCount > bearCount) {
      score.sentiment += 8;
      confluences.push(`Fear & Greed ${inp.fgi.value} (Extreme Fear) — contrarian BUY signal`);
    } else if (inp.fgi.value >= 75 && bearCount > bullCount) {
      score.sentiment += 8;
      confluences.push(`Fear & Greed ${inp.fgi.value} (Extreme Greed) — contrarian SELL signal`);
    } else if (inp.fgi.value >= 40 && inp.fgi.value <= 60) {
      score.sentiment += 4;
    } else {
      score.sentiment += 2;
    }
  }

  // L/S Ratio contrarian
  if (inp.lsRatio !== null) {
    if (inp.lsRatio > 2.0 && bearCount > bullCount) {
      score.sentiment += 2;
      confluences.push(`L/S Ratio ${inp.lsRatio.toFixed(2)} — terlalu banyak long, potential short squeeze`);
    } else if (inp.lsRatio < 0.5 && bullCount > bearCount) {
      score.sentiment += 2;
      confluences.push(`L/S Ratio ${inp.lsRatio.toFixed(2)} — terlalu banyak short, potential long squeeze`);
    }
  }

  score.sentiment = Math.min(10, score.sentiment);

  // ── FUNDING SCORE (10 pts) ────────────────────────────────────────────────
  if (inp.fundingRate !== null) {
    if (inp.fundingRate < 0 && bullCount > bearCount) {
      score.funding += 10;
      confluences.push(`Funding rate negatif ${fmtPct(inp.fundingRate * 100)} — longs dibayar, favorable untuk BUY`);
    } else if (inp.fundingRate > 0.001 && inp.fundingRate < 0.05) {
      score.funding += 6;
    } else if (inp.fundingRate >= 0.05 && inp.fundingRate < 0.15) {
      score.funding += 3;
      confluences.push(`Funding rate tinggi ${fmtPct(inp.fundingRate * 100)} — hati-hati untuk LONG`);
    } else if (inp.fundingRate >= 0.15 && bullCount > bearCount) {
      score.funding = 0;
      confluences.push(`REJECT: Funding rate ${fmtPct(inp.fundingRate * 100)} terlalu tinggi untuk LONG`);
    } else {
      score.funding += 5;
    }
  } else {
    score.funding += 5;
  }

  score.funding = Math.min(10, score.funding);

  // ── MACRO SCORE (5 pts) ───────────────────────────────────────────────────
  if (inp.btcDom !== null) {
    // BTC dom rising + bearish = altcoin weakness
    // BTC dom falling + bullish = altcoin season
    if (inp.btcDom < 50 && bullCount > bearCount && inp.pair !== "BTCUSDT") {
      score.macro += 3;
      confluences.push(`BTC dominance ${inp.btcDom.toFixed(1)}% rendah — altcoin season`);
    } else if (inp.btcDom > 55 && inp.pair !== "BTCUSDT") {
      score.macro += 1;
    } else {
      score.macro += 3;
    }
  }
  score.macro += 2; // base macro score
  score.macro = Math.min(5, score.macro);

  score.total = score.trend + score.confluence + score.srLevel +
    score.volume + score.sentiment + score.funding + score.macro;

  const bias: "BULLISH" | "BEARISH" | "NEUTRAL" =
    bullCount > bearCount + 1 ? "BULLISH" :
    bearCount > bullCount + 1 ? "BEARISH" : "NEUTRAL";

  return { score, bias, confluences: confluences.slice(0, 6) };
}

// ─── SCALP ENGINE ─────────────────────────────────────────────────────────────
function scoreScalp(inp: RuleBasedSignalInput): {
  side: "LONG" | "SHORT" | "NO_SCALP";
  entry: number;
  sl: number;
  tps: number[];
  leverage: string;
  trigger: string;
  notes: string;
} {
  const atr = inp.atr14 ?? (inp.price * 0.015);
  const atr1h = atr * 0.4; // smaller ATR for 1H

  // Scalp conditions — need 1H + 4H alignment
  const rsi1hOversold = inp.rsi1h !== null && inp.rsi1h < 35;
  const rsi1hOverbought = inp.rsi1h !== null && inp.rsi1h > 65;
  const rsi4hBull = inp.rsi4h !== null && inp.rsi4h > 45 && inp.rsi4h < 70;
  const rsi4hBear = inp.rsi4h !== null && inp.rsi4h < 55 && inp.rsi4h > 30;
  const macd4hBull = inp.macd4h !== null && inp.macd4h.histogram > 0;
  const macd4hBear = inp.macd4h !== null && inp.macd4h.histogram < 0;
  const stoch1hBull = inp.stoch1h !== null && inp.stoch1h.k < 25 && inp.stoch1h.k > inp.stoch1h.d;
  const stoch1hBear = inp.stoch1h !== null && inp.stoch1h.k > 75 && inp.stoch1h.k < inp.stoch1h.d;
  const wtBull = inp.waveTrend?.cross === "BULLISH";
  const wtBear = inp.waveTrend?.cross === "BEARISH";
  const nearSupport = Math.abs(inp.price - inp.sup1) < atr1h * 2;
  const nearResistance = Math.abs(inp.price - inp.res1) < atr1h * 2;
  const vwapBull = inp.vwap && inp.price > inp.vwap.vwap;
  const vwapBear = inp.vwap && inp.price < inp.vwap.vwap;
  const fundingOkLong = inp.fundingRate === null || inp.fundingRate < 0.1;
  const fundingOkShort = inp.fundingRate === null || inp.fundingRate > -0.05;

  // LONG scalp: oversold 1H + 4H bullish + near support
  const longSignals = [rsi1hOversold, rsi4hBull, macd4hBull, stoch1hBull, wtBull, nearSupport, vwapBull as boolean, fundingOkLong]
    .filter(Boolean).length;

  // SHORT scalp: overbought 1H + 4H bearish + near resistance
  const shortSignals = [rsi1hOverbought, rsi4hBear, macd4hBear, stoch1hBear, wtBear, nearResistance, vwapBear as boolean, fundingOkShort]
    .filter(Boolean).length;

  if (longSignals >= 4) {
    const entry = inp.price;
    const sl = Math.min(entry - atr1h * 1.5, inp.sup1 * 0.998);
    const risk = entry - sl;
    return {
      side: "LONG",
      entry,
      sl,
      tps: [entry + risk * 1.5, entry + risk * 2.5, entry + risk * 4],
      leverage: "10-15x",
      trigger: `1H RSI oversold + 4H MACD bullish + dekat support ${fmt(inp.sup1)}`,
      notes: `Entry di ${fmt(entry)}, SL di ${fmt(sl)} (-${((risk/entry)*100).toFixed(2)}%). Ambil 50% profit di TP1.`
    };
  }

  if (shortSignals >= 4) {
    const entry = inp.price;
    const sl = Math.max(entry + atr1h * 1.5, inp.res1 * 1.002);
    const risk = sl - entry;
    return {
      side: "SHORT",
      entry,
      sl,
      tps: [entry - risk * 1.5, entry - risk * 2.5, entry - risk * 4],
      leverage: "10-15x",
      trigger: `1H RSI overbought + 4H MACD bearish + dekat resistance ${fmt(inp.res1)}`,
      notes: `Entry di ${fmt(entry)}, SL di ${fmt(sl)} (+${((risk/entry)*100).toFixed(2)}%). Ambil 50% profit di TP1.`
    };
  }

  return {
    side: "NO_SCALP",
    entry: inp.price,
    sl: inp.price,
    tps: [],
    leverage: "1x",
    trigger: "Konfluensi scalp tidak cukup",
    notes: "Tunggu setup lebih jelas. Minimal 4 dari 8 kondisi harus terpenuhi."
  };
}

// ─── HARD REJECT RULES ────────────────────────────────────────────────────────
function checkHardRejects(inp: RuleBasedSignalInput, bias: "BULLISH" | "BEARISH" | "NEUTRAL"): string | null {
  // RSI extremes
  if (bias === "BULLISH" && inp.rsi1d !== null && inp.rsi1d > 80) {
    return `RSI 1D ${inp.rsi1d.toFixed(1)} overbought — terlalu berisiko untuk BUY`;
  }
  if (bias === "BEARISH" && inp.rsi1d !== null && inp.rsi1d < 20) {
    return `RSI 1D ${inp.rsi1d.toFixed(1)} oversold — terlalu berisiko untuk SELL`;
  }
  // High funding for long
  if (bias === "BULLISH" && inp.fundingRate !== null && inp.fundingRate > 0.15) {
    return `Funding rate ${fmtPct(inp.fundingRate * 100)} terlalu tinggi untuk LONG`;
  }
  // Low volume
  const volRatio = inp.volAvg30 > 0 ? inp.volRecent / inp.volAvg30 : 1;
  if (volRatio < 0.5) {
    return `Volume ${volRatio.toFixed(2)}x terlalu rendah — sinyal tidak valid`;
  }
  // 4H and 1D disagree completely
  if (inp.trend4h === "BULLISH" && bias === "BEARISH" && inp.rsi1d !== null && inp.rsi1d > 50) {
    return `4H trend bullish tapi bias bearish — konflik timeframe, tunggu konfirmasi`;
  }
  if (inp.trend4h === "BEARISH" && bias === "BULLISH" && inp.rsi1d !== null && inp.rsi1d < 50) {
    return `4H trend bearish tapi bias bullish — konflik timeframe, tunggu konfirmasi`;
  }
  return null;
}

// ─── MAIN SIGNAL GENERATOR ───────────────────────────────────────────────────
export function generateRuleBasedSignal(inp: RuleBasedSignalInput): RuleBasedSignalOutput {
  const { score, bias, confluences } = scoreSwing(inp);
  const atr = inp.atr14 ?? (inp.price * 0.02);
  const scalp = scoreScalp(inp);

  // Determine side
  let side: "BUY" | "SELL" | "NO_TRADE" = "NO_TRADE";
  let noTradeReason = "";

  // Zona "sweet spot" 45-55 dipilih berdasarkan backtest 2024-2026 (4 pair, 3 horizon):
  // zona ini konsisten net-positive (setelah fee+funding) di train & out-of-sample test,
  // sementara zona >=55 (confluence tinggi) cenderung "late entry" / lemah, dan <45
  // cenderung negatif. Lihat scripts/backtest-rule-engine.ts untuk detail.
  if (score.total >= 45 && score.total < 55) {
    const rejectReason = checkHardRejects(inp, bias);
    if (rejectReason) {
      side = "NO_TRADE";
      noTradeReason = rejectReason;
    } else if (bias === "BULLISH") {
      side = "BUY";
    } else if (bias === "BEARISH") {
      side = "SELL";
    } else {
      side = "NO_TRADE";
      noTradeReason = "Bias netral — konfluensi tidak cukup mengarah ke satu arah";
    }
  } else if (score.total < 45) {
    noTradeReason = `Skor ${score.total}/100 di bawah zona sweet-spot (45-55) — confidence terlalu rendah berdasarkan backtest`;
  } else {
    noTradeReason = `Skor ${score.total}/100 di atas zona sweet-spot (45-55) — confluence terlalu tinggi, secara historis sering jadi late-entry`;
  }

  // Calculate levels
  const riskPct = (atr / inp.price) * 100;
  let entryLow: number, entryHigh: number, sl: number, tp1: number, tp2: number, tp3: number;

  if (side === "BUY") {
    entryLow = Math.max(inp.price * 0.997, inp.sup1 * 0.999);
    entryHigh = inp.price * 1.003;
    sl = Math.min(entryLow * (1 - atr / inp.price * 1.2), inp.sup1 * 0.99);
    const risk = entryLow - sl;
    tp1 = entryLow + risk * 2;
    tp2 = entryLow + risk * 3;
    tp3 = Math.min(entryLow + risk * 5, inp.res2);
  } else if (side === "SELL") {
    entryLow = inp.price * 0.997;
    entryHigh = Math.min(inp.price * 1.003, inp.res1 * 1.001);
    sl = Math.max(entryHigh * (1 + atr / inp.price * 1.2), inp.res1 * 1.01);
    const risk = sl - entryHigh;
    tp1 = entryHigh - risk * 2;
    tp2 = entryHigh - risk * 3;
    tp3 = Math.max(entryHigh - risk * 5, inp.sup2);
  } else {
    entryLow = inp.price * 0.995;
    entryHigh = inp.price * 1.005;
    sl = inp.sup1;
    tp1 = inp.res1;
    tp2 = inp.res2;
    tp3 = inp.res3;
  }

  const risk = side === "BUY" ? entryLow - sl : side === "SELL" ? sl - entryHigh : atr;
  const rr = risk > 0 ? ((tp2 - entryLow) / risk).toFixed(1) : "N/A";

  // Spot accumulation zone
  const spotLow = Math.min(inp.sup1, inp.sup2) * 0.995;
  const spotHigh = inp.sup1 * 1.005;

  // Price scenarios
  const bullishTarget = fmt(inp.res3 * 1.05);
  const bearishTarget = fmt(inp.sup3 * 0.95);
  const baseCase = score.total >= 70
    ? `Setup ${side === "BUY" ? "bullish" : side === "SELL" ? "bearish" : "netral"} dengan skor ${score.total}/100 — tunggu konfirmasi di ${fmt(side === "BUY" ? entryLow : entryHigh)}`
    : `Konsolidasi di range ${fmt(inp.sup1)} - ${fmt(inp.res1)} dalam jangka pendek`;

  // Reasoning
  const topConfluences = confluences.slice(0, 4);
  const reasoning = topConfluences.length > 0
    ? topConfluences.join(". ")
    : `Analisis rule-based: skor ${score.total}/100, bias ${bias}`;

  // Trader style based on dominant indicators
  const traderStyle = score.trend > 15
    ? "Trend Following — EMA Stack + Ichimoku Confirmation"
    : score.srLevel > 15
    ? "Support/Resistance Trading — Key Level Entry"
    : "Multi-Indicator Confluence — Balanced Approach";

  const expertMindset = side === "BUY"
    ? "Beli di zona support dengan volume konfirmasi. Risk 1-2% dari portfolio. Geser SL ke BE setelah TP1 tercapai."
    : side === "SELL"
    ? "Short di zona resistance dengan momentum negatif. Jaga risk ketat, altcoin bisa squeeze kapan saja."
    : "Tidak ada setup yang cukup jelas. Modal tersimpan adalah modal yang aman. Tunggu setup A+ berikutnya.";

  return {
    side,
    confidence: score.total,
    scoreBreakdown: score,
    entryRange: `${fmt(entryLow)} - ${fmt(entryHigh)}`,
    stopLoss: fmt(sl),
    stopLossRiskPct: `${riskPct.toFixed(2)}%`,
    takeProfit: [fmt(tp1), fmt(tp2), fmt(tp3)],
    takeProfitRR: [`1:2`, `1:3`, `1:5`],
    leverage: side === "NO_TRADE" ? "1x (spot only)" : score.total >= 80 ? "5-10x" : "3-5x",
    reasoning,
    confluences: topConfluences,
    invalidation: side === "BUY"
      ? `Setup batal jika harga close di bawah ${fmt(sl)}`
      : side === "SELL"
      ? `Setup batal jika harga close di atas ${fmt(sl)}`
      : `Tunggu setup valid dengan skor di zona 45-55/100 (sweet spot berdasarkan backtest)`,
    traderStyle,
    expertMindset,
    timeframe: "4H konfirmasi, 1D tren",
    riskReward: `1:${rr}`,
    // Scalp
    scalpSide: scalp.side,
    scalpEntry: fmt(scalp.entry),
    scalpSL: fmt(scalp.sl),
    scalpTP: scalp.tps.map(fmt),
    scalpLeverage: scalp.leverage,
    scalpTrigger: scalp.trigger,
    scalpNotes: scalp.notes,
    // Spot
    spotEntry: `${fmt(spotLow)} - ${fmt(spotHigh)}`,
    longTermTarget: fmt(inp.res3),
    keySupport: fmt(inp.sup1),
    keyResistance: fmt(inp.res1),
    // Scenarios
    bullishTarget,
    bearishTarget,
    baseCase,
    noTradeReason: side === "NO_TRADE" ? noTradeReason : undefined,
    riskManagement: (() => {
      // stopDistancePct: jarak SL aktual dari entry, dalam % (fallback ke ATR jika NO_TRADE)
      const stopDistPct = side === "BUY"
        ? ((entryLow - sl) / entryLow) * 100
        : side === "SELL"
        ? ((sl - entryHigh) / entryHigh) * 100
        : riskPct; // ATR-based fallback untuk NO_TRADE

      const example1pct = stopDistPct > 0 ? (1 / stopDistPct) : 0;
      const example2pct = stopDistPct > 0 ? (2 / stopDistPct) : 0;

      return {
        stopDistancePct: `${stopDistPct.toFixed(2)}%`,
        suggestion:
          `Risk-based sizing (BUKAN leverage ke seluruh modal): tentukan dulu berapa % modal ` +
          `yang siap dipertaruhkan per trade (umum: 1-2%). Position size = (modal x risk%) / ${stopDistPct.toFixed(2)}%. ` +
          `Contoh modal $1000: risk 1% -> position size \u2248 ${(example1pct * 1000).toFixed(0)} ` +
          `(leverage efektif \u2248 ${example1pct.toFixed(1)}x dari modal). ` +
          `Risk 2% -> position size \u2248 ${(example2pct * 1000).toFixed(0)} ` +
          `(leverage efektif \u2248 ${example2pct.toFixed(1)}x). ` +
          `Leverage exchange bisa lebih tinggi dari ini — tapi JANGAN dipakai untuk ` +
          `memperbesar position size di atas hasil hitungan risk% ini.`,
      };
    })(),
  };
}
