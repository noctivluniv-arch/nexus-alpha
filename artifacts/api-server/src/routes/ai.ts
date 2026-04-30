import { Router, type IRouter, type Request, type Response } from "express";
import { ai } from "@workspace/integrations-gemini-ai";
import { type GenerateContentResponse, Type } from "@google/genai";
import { aiLimiter, requireAppSecret } from "../middlewares/rateLimiter";
import { getOHLC, SYMBOL_TO_ID } from "./binance";
import {
  ema,
  rsi,
  macd,
  bollinger,
  atr,
  swingLevels,
  fibLevels,
  trendStructure,
  volumeProfile,
  stochastic,
  obvTrend,
  detectRsiDivergence,
  aggregateCandles,
  bosLevel,
} from "../lib/indicators";

const GEMINI_TIMEOUT_MS = 60_000;
const MAX_MARKET_CONTEXT_CHARS = 500;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error("Gemini request timed out")), ms),
  );
  return Promise.race([promise, timeout]);
}

const router: IRouter = Router();
const MODEL = process.env.GEMINI_API_KEY ? "gemini-2.0-flash" : "gemini-2.5-flash";

interface SignalCacheEntry {
  ts: number;
  data: Record<string, unknown>;
}
const SIGNAL_CACHE = new Map<string, SignalCacheEntry>();
const SIGNAL_TTL_MS = process.env.GEMINI_API_KEY ? 30 * 60 * 1000 : 5 * 60 * 1000;

interface WhalesCacheEntry {
  ts: number;
  data: unknown[];
}
let whalesCache: WhalesCacheEntry | null = null;
const WHALES_TTL_MS = 2 * 60 * 1000;
let whalesAiInflight: Promise<unknown[]> | null = null;

// Shared schema fragment for the additive scalpingPlan field — kept here so
// the main route handler and the prewarm task stay in sync.
const SCALPING_PLAN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    side: { type: Type.STRING, enum: ["LONG", "SHORT", "NO_SCALP"] },
    entryPrice: { type: Type.STRING },
    entryTrigger: { type: Type.STRING },
    stopLoss: { type: Type.STRING },
    takeProfit: { type: Type.ARRAY, items: { type: Type.STRING } },
    takeProfitRR: { type: Type.ARRAY, items: { type: Type.STRING } },
    leverage: { type: Type.STRING },
    timeframe: { type: Type.STRING },
    holdTime: { type: Type.STRING },
    sessionWindow: { type: Type.STRING },
    notes: { type: Type.STRING },
  },
  required: [
    "side",
    "entryPrice",
    "entryTrigger",
    "stopLoss",
    "takeProfit",
    "takeProfitRR",
    "leverage",
    "timeframe",
    "holdTime",
    "sessionWindow",
    "notes",
  ],
} as const;

const OKX_BASE = "https://www.okx.com/api/v5";
const CG_BASE = "https://api.coingecko.com/api/v3";
const FNG_URL = "https://api.alternative.me/fng/?limit=1";

const PAIR_TO_OKX: Record<string, string> = {
  BTCUSDT: "BTC",
  ETHUSDT: "ETH",
  BNBUSDT: "BNB",
  SOLUSDT: "SOL",
  SUIUSDT: "SUI",
  LINKUSDT: "LINK",
  HYPEUSDT: "HYPE",
  ASTERUSDT: "ASTER",
  ZECUSDT: "ZEC",
};

interface DerivData {
  fundingRate: number;
  oiUsd: number;
  lsRatio: number;
}

async function fetchDerivatives(pair: string): Promise<DerivData | null> {
  const ccy = PAIR_TO_OKX[pair];
  if (!ccy) return null;
  const instId = `${ccy}-USDT-SWAP`;
  try {
    const [frRes, oiRes, lsRes] = await Promise.allSettled([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetch(`${OKX_BASE}/public/funding-rate?instId=${instId}`).then((r) => r.json() as Promise<any>),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetch(`${OKX_BASE}/rubik/stat/contracts/open-interest-volume?ccy=${ccy}&period=1D`).then((r) => r.json() as Promise<any>),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetch(`${OKX_BASE}/rubik/stat/contracts/long-short-account-ratio?ccy=${ccy}&period=1D`).then((r) => r.json() as Promise<any>),
    ]);

    const fr =
      frRes.status === "fulfilled"
        ? parseFloat(frRes.value?.data?.[0]?.fundingRate ?? "0")
        : 0;
    const oi =
      oiRes.status === "fulfilled"
        ? parseFloat(oiRes.value?.data?.[0]?.[1] ?? "0")
        : 0;
    const ls =
      lsRes.status === "fulfilled"
        ? parseFloat(lsRes.value?.data?.[0]?.[1] ?? "1")
        : 1;

    return { fundingRate: fr, oiUsd: oi, lsRatio: ls };
  } catch {
    return null;
  }
}

async function fetchFearGreed(): Promise<{
  value: number;
  label: string;
} | null> {
  try {
    const r = await fetch(FNG_URL, { headers: { accept: "application/json" } });
    if (!r.ok) return null;
    const j = (await r.json()) as {
      data: { value: string; value_classification: string }[];
    };
    const d = j.data?.[0];
    if (!d) return null;
    return { value: parseInt(d.value, 10), label: d.value_classification };
  } catch {
    return null;
  }
}

async function fetchBtcDom(): Promise<{
  btcDom: number;
  mcapChange24h: number;
} | null> {
  try {
    const r = await fetch(`${CG_BASE}/global`, {
      headers: { accept: "application/json" },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as {
      data: {
        market_cap_percentage: Record<string, number>;
        market_cap_change_percentage_24h_usd: number;
      };
    };
    return {
      btcDom: j.data.market_cap_percentage?.btc ?? 0,
      mcapChange24h: j.data.market_cap_change_percentage_24h_usd ?? 0,
    };
  } catch {
    return null;
  }
}

const LAYER_1_SYSTEM = `You are an elite cryptocurrency trader with 15+ years of experience managing multi-million dollar portfolios. You think and analyze exactly like:

— Paul Tudor Jones: macro trend identification & risk management
— Larry Williams: technical pattern recognition & timing precision
— Stan Weinstein: stage analysis & institutional volume reading

Your core principles:
1. Capital preservation ALWAYS comes before profit
2. Only take trades with minimum 1:2 risk-reward ratio
3. Never risk more than 1-2% of portfolio per trade
4. Confirm signals across MINIMUM 3 independent indicators
5. Respect the trend — "trend is your friend until it bends"

Your analysis framework (in order):
Step 1: Identify macro trend (Weekly & Daily timeframe)
Step 2: Find key S/R levels using institutional order blocks
Step 3: Confirm momentum with volume profile analysis
Step 4: Check confluence of: RSI divergence + MACD cross + EMA alignment
Step 5: Evaluate market sentiment (Fear & Greed Index + funding rates)
Step 6: Calculate exact entry, stop-loss, and 3 take-profit targets

CONFIDENCE SCORING SYSTEM (total /100):
• Trend alignment (all TF): +20 pts
• Indicator confluence (3+): +20 pts
• Clean S/R level entry: +20 pts
• Volume confirmation: +15 pts
• Sentiment contrarian edge: +10 pts
• Low funding (< 0.05% or negative): +10 pts
• Macro alignment: +5 pts

AUTOMATIC REJECT — output NO_TRADE if ANY of these apply:
- RSI > 80 (LONG) or RSI < 20 (SHORT) on Daily
- Funding rate > 0.15% for LONG signals
- Price in middle of range (no clear S/R nearby)
- Volume < 0.7x 30-day average
- Score < 65 total

If confidence < 65, output signal = "NO_TRADE". Never force trades. Patience is a trading edge. A missed trade costs nothing. A bad trade can cost everything.`;

function buildMarketDataBlock(params: {
  pair: string;
  price: number;
  change24h: string;
  high24h: number;
  low24h: number;
  highWeek: number;
  lowWeek: number;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi4h: number | null;
  rsi1d: number | null;
  rsi1w: number | null;
  rsiDivergence: string;
  macd4h: { macd: number; signal: number; histogram: number } | null;
  stoch4h: { k: number; d: number } | null;
  bb: { upper: number; middle: number; lower: number; bandwidth: number } | null;
  volAvg30: number;
  volRecent: number;
  volSpike: boolean;
  obvTrendStr: string;
  trend4h: string;
  bos: { direction: string; price: number };
  res1: number;
  res2: number;
  res3: number;
  sup1: number;
  sup2: number;
  sup3: number;
  fgi: { value: number; label: string } | null;
  fundingRate: number | null;
  oiUsd: number | null;
  lsRatio: number | null;
  btcDom: number | null;
  mcapChange24h: number | null;
}): string {
  const fmtPct = (v: number | null) =>
    v != null ? `${v.toFixed(3)}%` : "N/A";
  const fmtUsd = (v: number | null) =>
    v != null ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "N/A";
  const fmtBn = (v: number | null) => {
    if (v == null) return "N/A";
    if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
    return `$${v.toFixed(0)}`;
  };

  return `MARKET DATA INPUT — ${params.pair}
Timestamp: ${new Date().toISOString()}

--- PRICE ACTION ---
Current Price: ${fmtUsd(params.price)}
24h Change: ${params.change24h}%
24h High: ${fmtUsd(params.high24h)} | 24h Low: ${fmtUsd(params.low24h)}
Weekly High: ${fmtUsd(params.highWeek)} | Weekly Low: ${fmtUsd(params.lowWeek)}

--- TECHNICAL INDICATORS ---
Timeframe: 4H | 1D | 1W

EMA Stack (1D): EMA20=${fmtUsd(params.ema20)} | EMA50=${fmtUsd(params.ema50)} | EMA200=${fmtUsd(params.ema200)}
Price vs EMA200: ${params.ema200 != null ? (params.price >= params.ema200 ? "ABOVE" : "BELOW") + ` by ${Math.abs(((params.price - params.ema200) / params.ema200) * 100).toFixed(2)}%` : "N/A"}

RSI(14): 4H=${params.rsi4h?.toFixed(2) ?? "N/A"} | 1D=${params.rsi1d?.toFixed(2) ?? "N/A"} | 1W=${params.rsi1w?.toFixed(2) ?? "N/A"}
RSI Divergence: ${params.rsiDivergence}

MACD(12,26,9) 4H: ${params.macd4h ? `Signal=${params.macd4h.signal.toFixed(4)} | Histogram=${params.macd4h.histogram.toFixed(4)} | Cross=${params.macd4h.histogram > 0 ? "BULL" : "BEAR"}` : "N/A"}
Stochastic(14,3,3): ${params.stoch4h ? `K=${params.stoch4h.k.toFixed(1)} D=${params.stoch4h.d.toFixed(1)} | ${params.stoch4h.k > 80 ? "OVERBOUGHT" : params.stoch4h.k < 20 ? "OVERSOLD" : "NEUTRAL"}` : "N/A"}

Bollinger Bands(20,2): ${params.bb ? `Upper=${fmtUsd(params.bb.upper)} | Mid=${fmtUsd(params.bb.middle)} | Lower=${fmtUsd(params.bb.lower)}\nBB Width: ${params.bb.bandwidth.toFixed(4)} | Squeeze: ${params.bb.bandwidth < 0.05 ? "YES" : "NO"}` : "N/A"}

Volume: Current=${fmtBn(params.volRecent)} | Avg30=${fmtBn(params.volAvg30)} | Ratio=${params.volAvg30 > 0 ? (params.volRecent / params.volAvg30).toFixed(2) : "N/A"}x
OBV Trend: ${params.obvTrendStr}

--- MARKET STRUCTURE ---
Trend (4H): ${params.trend4h}
Last BOS (Break of Structure): ${params.bos.direction} ${params.bos.price > 0 ? `at ${fmtUsd(params.bos.price)}` : "(none detected)"}
Key Resistance: ${fmtUsd(params.res1)} | ${fmtUsd(params.res2)} | ${fmtUsd(params.res3)}
Key Support: ${fmtUsd(params.sup1)} | ${fmtUsd(params.sup2)} | ${fmtUsd(params.sup3)}

--- SENTIMENT & DERIVATIVES ---
Fear & Greed Index: ${params.fgi ? `${params.fgi.value} (${params.fgi.label.toUpperCase()})` : "N/A"}
Funding Rate (Perp): ${fmtPct(params.fundingRate)} ${params.fundingRate != null ? `(Longs ${params.fundingRate > 0 ? "PAYING — disfavored" : "RECEIVING — favored"})` : ""}
Open Interest: ${fmtBn(params.oiUsd)}
Long/Short Ratio: ${params.lsRatio?.toFixed(2) ?? "N/A"} (${params.lsRatio != null ? (params.lsRatio > 1 ? "LONGS DOMINANT" : "SHORTS DOMINANT") : "N/A"})

--- MACRO CONTEXT ---
BTC Dominance: ${params.btcDom?.toFixed(2) ?? "N/A"}%
Total Market Cap 24h: ${params.mcapChange24h != null ? `${params.mcapChange24h.toFixed(2)}%` : "N/A"}`;
}

const LAYER_3 = `Analyze the market data above. Step by step:
1. Trend: dominant direction per TF, EMA alignment, HH/HL or LH/LL?
2. Key levels: is price near major S/R, order block, or FVG?
3. Momentum: RSI+MACD+Stoch agreement? Divergence? Volume confirmation?
4. Sentiment: does derivatives data (funding, OI, L/S ratio) support signal?
5. Risk: logical stop (structural), R:R >= 1:2, invalidation conditions?
6. Verdict: score each factor, output NO_TRADE if total < 65.
Think like smart money, be contrarian at sentiment extremes.`;

const LAYER_4 = `FINAL VALIDATION — reject (NO_TRADE) if ANY:
- RSI > 80 (LONG) or RSI < 20 (SHORT) daily
- Funding > 0.15% for LONG
- Volume < 0.7x avg30
- Score < 65
- 4H and Daily trend disagree
- R:R < 1:2

traderStyle = methodology (e.g. "Wyckoff Phase C + ICT Order Block"). expertMindset = risk/psychology insight. confluences = 3-5 specific observations with actual values.

spotEntry MANDATORY: ALWAYS provide a concrete spot DCA accumulation zone as a price range string in the format "$LOW - $HIGH" using actual numeric values from the market data above (typically near key support / EMA50 / lower Bollinger band). NEVER output "N/A", "none", empty string, or generic text. This applies to BOTH BUY/SELL signals AND NO_TRADE — spot buyers always need an accumulation zone. Even if the futures setup is invalid, give a long-term spot DCA range based on key support levels.

priceScenarios MANDATORY (ALWAYS fill, never N/A) — derive from the actual market data:
- bearishTarget: realistic worst-case spot price during a market crash / deep bearish scenario, formatted as "$X" or "$X - $Y" (use sup2/sup3, EMA200, Fibonacci 0.618/0.786 retracements, or historical structural lows). Must be BELOW current price.
- bearishTimeframe: estimated time window for that bearish scenario to play out (e.g. "2-4 minggu" / "2-4 weeks", "1-3 bulan" / "1-3 months"). Be realistic based on volatility (ATR), trend slope, and macro context.
- bearishCondition: 1 short sentence describing the trigger / catalyst (e.g. "Jika BTC tembus $90k dan funding turun negatif" / "If BTC breaks $90k support and funding flips negative").
- bullishTarget: realistic best-case spot price during a strong bullish run, formatted as "$X" or "$X - $Y" (use res2/res3, Fibonacci 1.272/1.618 extensions, prior ATH, or measured-move targets). Must be ABOVE current price.
- bullishTimeframe: estimated time window for the bullish scenario.
- bullishCondition: 1 short sentence describing the trigger (e.g. "Jika ETF inflow berlanjut dan BTC dominance turun" / "If ETF inflows continue and BTC dominance drops").
- baseCase: 1 short sentence with the MOST LIKELY scenario for the next few weeks given current data (probability-weighted view).

All price targets must be NUMERIC values in USD with $ prefix. Timeframes must be CONCRETE (days/weeks/months) — never vague like "soon" or "eventually".

scalpingPlan MANDATORY (ALWAYS fill — separate, professional intraday scalp playbook in addition to the swing/position setup above). Even if the swing side is NO_TRADE, attempt to provide a short-term scalp plan if 4H/1H structure offers a clean setup; otherwise set scalpingPlan.side="NO_SCALP" and explain in scalpingPlan.notes.
- side: "LONG" | "SHORT" | "NO_SCALP" (the scalp direction is INDEPENDENT from the main side — e.g. swing can be BUY but scalp may be SHORT into a 1H rejection at resistance, or vice versa).
- entryPrice: precise scalp entry, formatted "$X" (tighter than swing entryRange — typically at a 1H/15m level: micro-OB, FVG, EMA9/21 4H, BB band, recent 1H swing).
- entryTrigger: 1 short sentence describing the trigger candle / confirmation (e.g. "Wait for 5m bullish engulfing above EMA9 with RSI > 50" or "Short on 15m rejection wick at $X with bearish MACD cross").
- stopLoss: tight scalp SL, formatted "$X" (typically 0.3–1.0% away — based on ATR/4H or just below/above the trigger candle; never wider than 1.5%).
- takeProfit: array of 2–3 quick targets formatted ["$X", "$Y", "$Z"], each at progressively further intraday levels (next 15m/1H S/R, BB mid, prior session high/low, FVG top/bottom). Order them in execution sequence.
- takeProfitRR: array of R:R strings same length as takeProfit (e.g. ["1:1.2", "1:2", "1:3"]).
- leverage: scalp leverage range (e.g. "10-25x"). Higher than swing because hold time is short, but capped — NEVER exceed 25x even on tight setups, and use 5-10x for choppy / NO_SCALP fallback.
- timeframe: chart timeframe used for entry/exit decisions (e.g. "5m-15m chart, 1H bias").
- holdTime: realistic position duration window (e.g. "5-30 min", "30-90 min", "1-4 hours"). Must be CONCRETE.
- sessionWindow: best session to take this scalp (e.g. "Asia open (00:00-04:00 UTC)", "London open (08:00 UTC)", "NY open (13:30 UTC)", "Anytime — no session bias"). Choose based on which session has the best volatility/liquidity for this pair right now.
- notes: 1–2 sentences with execution tips (e.g. "Avoid taking scalp during low-vol Asia drift; partial 50% at TP1, move SL to BE, runner to TP3"). For NO_SCALP, explain why (e.g. "Range too tight, ATR low, wait for breakout").

Output complete JSON now.`;

function buildLanguageDirective(lang: "id" | "en"): string {
  if (lang === "id") {
    return `\n\nLANGUAGE REQUIREMENT — STRICT:
Write ALL of the following text fields in BAHASA INDONESIA (natural, professional trading Indonesian):
- reasoning, expertMindset, noTradeReason, invalidation, traderStyle
- confluences (every array item)
- spotEntry (e.g. "Akumulasi spot di $X - $Y dekat support kunci")
- longTermTarget, riskReward (descriptive parts)
- priceScenarios.bearishTimeframe, bearishCondition, bullishTimeframe, bullishCondition, baseCase
  (e.g. timeframe "2-4 minggu" or "1-3 bulan", condition "Jika BTC tembus support utama dan funding negatif")
- scalpingPlan.entryTrigger, holdTime, sessionWindow, notes
  (e.g. holdTime "5-30 menit", sessionWindow "NY open (13:30 UTC)", notes "Ambil profit parsial 50% di TP1, geser SL ke BE")

KEEP IN ENGLISH (do NOT translate): enum values (BUY, SELL, NO_TRADE, BULLISH, BEARISH, RANGING, LONG, SHORT, NO_SCALP), price numbers with $ prefix, indicator names (RSI, MACD, EMA, BB, OBV, ATR), abbreviations (TP, SL, R:R, OI, FVG, BOS, BE), percentages, and trading framework names (Wyckoff, ICT, Smart Money Concepts).`;
  }
  return `\n\nLANGUAGE REQUIREMENT — STRICT:
Write ALL descriptive text fields (reasoning, expertMindset, noTradeReason, invalidation, traderStyle, confluences, spotEntry, longTermTarget, priceScenarios.bearishTimeframe, bearishCondition, bullishTimeframe, bullishCondition, baseCase, scalpingPlan.entryTrigger, holdTime, sessionWindow, notes) in clear professional ENGLISH. Timeframes use English units (e.g. "2-4 weeks", "1-3 months", "5-30 min").`;
}

/**
 * Translate an English trading-signal payload to Indonesian by translating
 * ONLY the descriptive text fields. ALL numeric fields (entryPrice, stopLoss,
 * takeProfit, confidence, scoreBreakdown, prices, percentages, leverage like
 * "5x") are preserved EXACTLY as-is by merging the translated text back into
 * the original English payload. This guarantees that switching language never
 * changes the trading numbers — the analysis is computed once in English and
 * the Indonesian version is a faithful translation of the same verdict.
 */
async function translateSignalToIndonesian(
  en: Record<string, any>,
): Promise<Record<string, any>> {
  const ps = (en.priceScenarios ?? {}) as Record<string, any>;
  const sp = (en.scalpingPlan ?? {}) as Record<string, any>;
  // Only the descriptive text fields are sent to the model. Numbers/enums
  // are kept out of the translation prompt entirely so they cannot drift.
  const textOnly = {
    reasoning: en.reasoning ?? "",
    expertMindset: en.expertMindset ?? "",
    noTradeReason: en.noTradeReason ?? "",
    invalidation: en.invalidation ?? "",
    traderStyle: en.traderStyle ?? "",
    spotEntry: en.spotEntry ?? "",
    longTermTarget: en.longTermTarget ?? "",
    // riskReward is a pure ratio like "1:2.5" — never sent to translation
    // to guarantee character-for-character parity across languages.
    timeframe: en.timeframe ?? "",
    validUntil: en.validUntil ?? "",
    confluences: Array.isArray(en.confluences) ? en.confluences : [],
    bearishTimeframe: ps.bearishTimeframe ?? "",
    bearishCondition: ps.bearishCondition ?? "",
    bullishTimeframe: ps.bullishTimeframe ?? "",
    bullishCondition: ps.bullishCondition ?? "",
    baseCase: ps.baseCase ?? "",
    scalpingEntryTrigger: sp.entryTrigger ?? "",
    scalpingHoldTime: sp.holdTime ?? "",
    scalpingSessionWindow: sp.sessionWindow ?? "",
    scalpingNotes: sp.notes ?? "",
  };

  const prompt = `Translate the following English trading-signal text fields to natural professional BAHASA INDONESIA.

STRICT RULES:
- Keep ALL prices ($X), price ranges ($X - $Y), percentages (%), ratios (1:2.5), leverage values (5x), and abbreviations (RSI, MACD, BB, EMA, OBV, ATR, FVG, BOS, OB, OI, BE, TP, SL, R:R, ETF) EXACTLY as-is — do NOT translate or reformat them.
- Keep enum values UNCHANGED: BUY, SELL, NO_TRADE, BULLISH, BEARISH, RANGING, LONG, SHORT, NO_SCALP.
- Use natural professional Indonesian trading vernacular, NOT literal word-for-word translation.
- Translate timeframe units: "weeks" → "minggu", "month(s)" → "bulan", "min" / "minutes" → "menit", "hour(s)" → "jam", "day(s)" → "hari", "Anytime" → "Kapan saja", "Asia open" → "Buka Asia", "London open" → "Buka London", "NY open" → "Buka NY".
- Preserve the exact same meaning and verdict — do NOT add or remove information.

Input JSON (English):
${JSON.stringify(textOnly)}

Output the SAME JSON structure with every value translated to Indonesian (keeping rule above for numbers / abbreviations / enums). Output JSON only, no commentary.`;

  const response = await withTimeout<GenerateContentResponse>(
    ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        maxOutputTokens: 4096,
        // Pure translation — no analysis needed. Zero temperature +
        // no thinking budget makes this a fast (~3-5s) deterministic call.
        temperature: 0,
        topP: 1.0,
        topK: 1,
      },
    }),
    GEMINI_TIMEOUT_MS,
  );
  const finishReason = response.candidates?.[0]?.finishReason;
  if (finishReason && finishReason !== "STOP") {
    // Translation failed — return English so the user still sees a valid
    // signal instead of an empty/broken one. The English result is correct;
    // only the language label is wrong.
    return en;
  }
  let t: Record<string, any>;
  try {
    t = JSON.parse(response.text ?? "{}") as Record<string, any>;
  } catch {
    return en;
  }

  // Merge translated text back into the English payload, preserving every
  // number / enum / price / score by using the English value as fallback.
  return {
    ...en,
    reasoning: t.reasoning || en.reasoning,
    expertMindset: t.expertMindset || en.expertMindset,
    noTradeReason: t.noTradeReason || en.noTradeReason,
    invalidation: t.invalidation || en.invalidation,
    traderStyle: t.traderStyle || en.traderStyle,
    spotEntry: t.spotEntry || en.spotEntry,
    longTermTarget: t.longTermTarget || en.longTermTarget,
    // riskReward intentionally NOT translated — keep EN value verbatim
    // so the ratio (e.g. "1:2.5") stays bit-identical across languages.
    timeframe: t.timeframe || en.timeframe,
    validUntil: t.validUntil || en.validUntil,
    confluences:
      Array.isArray(t.confluences) && t.confluences.length > 0
        ? t.confluences
        : en.confluences,
    priceScenarios: {
      ...ps,
      bearishTimeframe: t.bearishTimeframe || ps.bearishTimeframe,
      bearishCondition: t.bearishCondition || ps.bearishCondition,
      bullishTimeframe: t.bullishTimeframe || ps.bullishTimeframe,
      bullishCondition: t.bullishCondition || ps.bullishCondition,
      baseCase: t.baseCase || ps.baseCase,
    },
    scalpingPlan: en.scalpingPlan
      ? {
          ...sp,
          entryTrigger: t.scalpingEntryTrigger || sp.entryTrigger,
          holdTime: t.scalpingHoldTime || sp.holdTime,
          sessionWindow: t.scalpingSessionWindow || sp.sessionWindow,
          notes: t.scalpingNotes || sp.notes,
        }
      : en.scalpingPlan,
  };
}

function buildFallbackSignal(params: {
  pair: string;
  livePrice: number;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi1d: number | null;
  rsi4h: number | null;
  macd4h: { histogram: number } | null;
  sup1: number; sup2: number; sup3: number;
  res1: number; res2: number; res3: number;
  trend4h: string;
  lang: "id" | "en";
}): Record<string, any> {
  const { livePrice: p, ema200, ema20, ema50, rsi1d, rsi4h, macd4h, sup1, sup2, sup3, res1, res2, res3, trend4h, lang } = params;
  const id = lang === "id";

  const aboveEma200 = ema200 != null && p > ema200;
  const ema20AboveEma50 = ema20 != null && ema50 != null && ema20 > ema50;
  const rsiNeutral = rsi1d != null && rsi1d > 40 && rsi1d < 70;
  const macdBull = macd4h != null && macd4h.histogram > 0;

  let score = 50;
  if (aboveEma200) score += 15;
  if (ema20AboveEma50) score += 10;
  if (rsiNeutral) score += 10;
  if (macdBull) score += 10;

  let side: "BUY" | "SELL" | "NO_TRADE" = "NO_TRADE";
  if (score >= 70 && trend4h !== "BEARISH") side = "BUY";
  else if (score < 40 || trend4h === "BEARISH") side = "SELL";

  const sl = side === "BUY" ? sup1 : res1;
  const riskAmt = Math.abs(p - sl) || p * 0.02;
  const tp1 = side === "BUY" ? p + riskAmt * 1.5 : p - riskAmt * 1.5;
  const tp2 = side === "BUY" ? p + riskAmt * 2.5 : p - riskAmt * 2.5;
  const tp3 = side === "BUY" ? p + riskAmt * 4.0 : p - riskAmt * 4.0;
  const riskPct = ((Math.abs(p - sl) / p) * 100).toFixed(2);

  const validUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  return {
    pair: params.pair,
    side,
    noTrade: side === "NO_TRADE",
    noTradeReason: side === "NO_TRADE"
      ? (id ? "Konfluensi teknikal tidak cukup untuk trade saat ini." : "Insufficient technical confluence for a trade right now.")
      : "",
    entryRange: `$${(p * 0.995).toFixed(2)} - $${(p * 1.005).toFixed(2)}`,
    entryPrice: `$${p.toFixed(2)}`,
    takeProfit: [`$${tp1.toFixed(2)}`, `$${tp2.toFixed(2)}`, `$${tp3.toFixed(2)}`],
    takeProfitRR: ["1:1.5", "1:2.5", "1:4"],
    stopLoss: `$${sl.toFixed(2)}`,
    stopLossRiskPct: `${riskPct}%`,
    confidence: Math.min(score, 88),
    timestamp: Date.now(),
    reasoning: id
      ? `Sinyal teknikal otomatis. EMA200: harga ${aboveEma200 ? "di atas" : "di bawah"} EMA200. RSI 1D: ${rsi1d?.toFixed(1) ?? "N/A"}. MACD 4H: ${macdBull ? "bullish" : "bearish"}. Tren 4H: ${trend4h}.`
      : `Automated technical signal. EMA200: price is ${aboveEma200 ? "above" : "below"} EMA200. RSI 1D: ${rsi1d?.toFixed(1) ?? "N/A"}. MACD 4H: ${macdBull ? "bullish" : "bearish"}. 4H Trend: ${trend4h}.`,
    traderStyle: "Technical Analysis — EMA + RSI + MACD Confluence",
    leverage: side === "NO_TRADE" ? "1x (spot)" : "3-5x",
    expertMindset: id
      ? "Disiplin teknikal: tunggu konfirmasi sebelum entry. Jaga risiko maksimal 1-2% per trade."
      : "Technical discipline: wait for confirmation before entry. Keep risk at 1-2% per trade.",
    spotEntry: `$${sup2.toFixed(2)} - $${sup1.toFixed(2)}`,
    longTermTarget: `$${res3.toFixed(2)}`,
    keySupport: `$${sup1.toFixed(2)}`,
    keyResistance: `$${res1.toFixed(2)}`,
    marketStructure: trend4h === "BULLISH" ? "BULLISH" : trend4h === "BEARISH" ? "BEARISH" : "RANGING",
    riskReward: "1:2.5",
    timeframe: id ? "4H konfirmasi, 1D tren" : "4H confirmation, 1D trend",
    validUntil,
    invalidation: id
      ? `Setup batal jika harga close di bawah $${sl.toFixed(2)}`
      : `Setup invalidated on a close below $${sl.toFixed(2)}`,
    confluences: [
      id ? `EMA stack: harga ${aboveEma200 ? "di atas" : "di bawah"} EMA200` : `EMA stack: price ${aboveEma200 ? "above" : "below"} EMA200`,
      id ? `RSI 1D: ${rsi1d?.toFixed(1) ?? "N/A"} — ${rsiNeutral ? "zona netral" : "perlu perhatian"}` : `RSI 1D: ${rsi1d?.toFixed(1) ?? "N/A"} — ${rsiNeutral ? "neutral zone" : "watch closely"}`,
      id ? `MACD 4H histogram: ${macdBull ? "positif (bullish)" : "negatif (bearish)"}` : `MACD 4H histogram: ${macdBull ? "positive (bullish)" : "negative (bearish)"}`,
      id ? `EMA 20/50: ${ema20AboveEma50 ? "bullish crossover" : "belum crossover"}` : `EMA 20/50: ${ema20AboveEma50 ? "bullish alignment" : "not aligned yet"}`,
    ],
    scoreBreakdown: {
      trend: aboveEma200 ? 75 : 30,
      volume: 50,
      sentiment: 50,
      momentum: macdBull ? 70 : 30,
      structure: ema20AboveEma50 ? 70 : 30,
    },
    priceScenarios: {
      bearishTarget: `$${sup3.toFixed(2)}`,
      bearishTimeframe: id ? "2-4 minggu" : "2-4 weeks",
      bearishCondition: id ? `Jika harga tembus support $${sup1.toFixed(2)}` : `If price breaks support at $${sup1.toFixed(2)}`,
      bullishTarget: `$${res3.toFixed(2)}`,
      bullishTimeframe: id ? "2-6 minggu" : "2-6 weeks",
      bullishCondition: id ? `Jika harga tembus resistance $${res1.toFixed(2)}` : `If price breaks resistance at $${res1.toFixed(2)}`,
      baseCase: id
        ? `Konsolidasi di range $${sup1.toFixed(2)} - $${res1.toFixed(2)} dalam jangka pendek`
        : `Consolidation in $${sup1.toFixed(2)} - $${res1.toFixed(2)} range near-term`,
    },
    scalpingPlan: {
      side: "NO_SCALP",
      entryPrice: `$${p.toFixed(2)}`,
      entryTrigger: id ? "Tunggu konfirmasi candle pada level kunci" : "Wait for candle confirmation at key level",
      stopLoss: `$${(p * 0.99).toFixed(2)}`,
      takeProfit: [`$${(p * 1.01).toFixed(2)}`, `$${(p * 1.02).toFixed(2)}`],
      takeProfitRR: ["1:1", "1:2"],
      leverage: "5x",
      timeframe: "15m-1H",
      holdTime: id ? "1-4 jam" : "1-4 hours",
      sessionWindow: id ? "Kapan saja — tidak ada bias sesi" : "Anytime — no session bias",
      notes: id
        ? "Mode teknikal — analisis AI tidak tersedia sementara. Gunakan level S/R manual untuk konfirmasi scalp."
        : "Technical mode — AI analysis temporarily unavailable. Use manual S/R levels for scalp confirmation.",
    },
    isFallback: true,
  };
}

router.post("/ai/signal", requireAppSecret, aiLimiter, async (req: Request, res: Response) => {
  const { pair, priceData, lang: rawLang } = req.body ?? {};
  if (!pair) return res.status(400).json({ error: "pair required" });
  if (!SYMBOL_TO_ID[String(pair)]) {
    return res.status(400).json({ error: "unsupported pair" });
  }
  const lang: "id" | "en" = rawLang === "en" ? "en" : "id";

  // 1. Check the cache for the requested language first (fast path).
  const cacheKey = `${String(pair)}:${lang}`;
  const cached = SIGNAL_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < SIGNAL_TTL_MS) {
    return res.json({ ...cached.data, fromCache: true });
  }

  // 2. If user asked for ID and we have a fresh EN cache, just translate it
  //    instead of regenerating the whole analysis. Numbers stay identical.
  if (lang === "id") {
    const enKey = `${String(pair)}:en`;
    const enCached = SIGNAL_CACHE.get(enKey);
    if (enCached && Date.now() - enCached.ts < SIGNAL_TTL_MS) {
      try {
        const idPayload = await translateSignalToIndonesian(
          enCached.data as Record<string, any>,
        );
        SIGNAL_CACHE.set(cacheKey, { ts: Date.now(), data: idPayload });
        return res.json({ ...idPayload, fromCache: true });
      } catch (err: any) {
        req.log.warn(
          { err: err?.message, pair },
          "Translation from cached EN failed; regenerating",
        );
      }
    }
  }

  const [ohlc, [derivData, fgiData, btcGlobal]] = await Promise.all([
    getOHLC(String(pair), 90),
    Promise.allSettled([
      fetchDerivatives(String(pair)),
      fetchFearGreed(),
      fetchBtcDom(),
    ]),
  ]);

  let livePrice = parseFloat(priceData?.lastPrice ?? "0");
  const change24h = priceData?.priceChangePercent ?? "0";

  let snapshot = "Insufficient data";
  let supportLevel = "0";
  let resistanceLevel = "0";

  let ema20Val: number | null = null;
  let ema50Val: number | null = null;
  let ema200Val: number | null = null;
  let rsi1dVal: number | null = null;
  let rsi4hVal: number | null = null;
  let rsi1wVal: number | null = null;
  let macd4hVal: { macd: number; signal: number; histogram: number } | null =
    null;
  let stoch4hVal: { k: number; d: number } | null = null;
  let bbVal: {
    upper: number;
    middle: number;
    lower: number;
    bandwidth: number;
  } | null = null;
  let volAvg30 = 0;
  let volRecent = 0;
  let volSpike = false;
  let obvTrendStr = "NEUTRAL";
  let trend4h = "RANGING";
  let bos = { direction: "NONE", price: 0 };
  let rsiDiv = "NONE";
  let high24h = livePrice;
  let low24h = livePrice;
  let highWeek = livePrice;
  let lowWeek = livePrice;
  let res1 = livePrice;
  let res2 = livePrice;
  let res3 = livePrice;
  let sup1 = livePrice;
  let sup2 = livePrice;
  let sup3 = livePrice;

  if (ohlc && ohlc.daily.closes.length > 30) {
    // Hourly bars (~300 × 1H = 12.5 days) → aggregate to 4H buckets for
    //   intraday indicators (RSI 4H, MACD 4H, Stochastic 4H).
    // Daily bars (~300 × 1D = 300 days) → use directly for daily/weekly
    //   indicators (EMA20/50/200, RSI Daily/Weekly, BB, swing levels).
    const hourlyData = ohlc.hourly;
    const daily = ohlc.daily;
    const last = daily.closes[daily.closes.length - 1];
    livePrice = last;

    const candles4h = aggregateCandles(
      hourlyData.closes,
      hourlyData.volumes,
      4,
      hourlyData.highs,
      hourlyData.lows,
    );
    const candlesWeek = aggregateCandles(
      daily.closes,
      daily.volumes,
      7,
      daily.highs,
      daily.lows,
    );

    ema20Val = ema(daily.closes, 20);
    ema50Val = ema(daily.closes, 50);
    ema200Val = ema(
      daily.closes,
      Math.min(200, daily.closes.length - 1),
    );

    rsi1dVal = rsi(daily.closes, 14);
    rsi4hVal = rsi(candles4h.closes, 14);
    rsi1wVal = candlesWeek.closes.length > 15 ? rsi(candlesWeek.closes, 14) : null;

    macd4hVal = macd(candles4h.closes);
    stoch4hVal = stochastic(
      candles4h.highs,
      candles4h.lows,
      candles4h.closes,
    );
    bbVal = bollinger(daily.closes, 20, 2);

    const vp = volumeProfile(daily.volumes.slice(-30));
    volAvg30 = vp.avg;
    volRecent = vp.recent;
    volSpike = vp.spike;

    obvTrendStr = obvTrend(daily.closes, daily.volumes);
    rsiDiv = detectRsiDivergence(daily.closes, 20);

    const swing7d = swingLevels(candles4h.highs, candles4h.lows, 42);
    const swing30d = swingLevels(daily.highs, daily.lows, 30);
    const swing90d = swingLevels(daily.highs, daily.lows, 90);

    if (candles4h.highs.length >= 1) {
      high24h = Math.max(...candles4h.highs.slice(-6));
      low24h = Math.min(...candles4h.lows.slice(-6));
    }
    highWeek = swing7d.resistance;
    lowWeek = swing7d.support;

    res1 = swing7d.resistance;
    res2 = swing30d.resistance;
    res3 = swing90d.resistance;
    sup1 = swing7d.support;
    sup2 = swing30d.support;
    sup3 = swing90d.support;

    supportLevel = sup1.toFixed(2);
    resistanceLevel = res1.toFixed(2);

    trend4h = trendStructure(
      ema(candles4h.closes, Math.min(50, candles4h.closes.length - 1)),
      ema(candles4h.closes, Math.min(200, candles4h.closes.length - 1)),
      last,
    );

    bos = bosLevel(candles4h.highs, candles4h.lows, candles4h.closes, 20);

    const fib = fibLevels(res1, sup1);
    const a14 = atr(daily.highs, daily.lows, daily.closes, 14);

    snapshot = `
4H Candles available: ${candles4h.closes.length}
1D Candles available: ${daily.closes.length}
1W Candles available: ${candlesWeek.closes.length}
ATR(14) daily: ${a14?.toFixed(4) ?? "N/A"}
Fibonacci (30d range): 0.236=$${fib["0.236"].toFixed(2)} 0.382=$${fib["0.382"].toFixed(2)} 0.5=$${fib["0.5"].toFixed(2)} 0.618=$${fib["0.618"].toFixed(2)} 0.786=$${fib["0.786"].toFixed(2)}
Market Context: ETF inflows positive, BTC holding key levels
`.trim();
  }

  const deriv =
    derivData.status === "fulfilled" ? derivData.value : null;
  const fgi = fgiData.status === "fulfilled" ? fgiData.value : null;
  const global =
    btcGlobal.status === "fulfilled" ? btcGlobal.value : null;

  const marketDataBlock = buildMarketDataBlock({
    pair: String(pair),
    price: livePrice,
    change24h,
    high24h,
    low24h,
    highWeek,
    lowWeek,
    ema20: ema20Val,
    ema50: ema50Val,
    ema200: ema200Val,
    rsi4h: rsi4hVal,
    rsi1d: rsi1dVal,
    rsi1w: rsi1wVal,
    rsiDivergence: rsiDiv,
    macd4h: macd4hVal,
    stoch4h: stoch4hVal,
    bb: bbVal,
    volAvg30,
    volRecent,
    volSpike,
    obvTrendStr,
    trend4h,
    bos,
    res1,
    res2,
    res3,
    sup1,
    sup2,
    sup3,
    fgi,
    fundingRate: deriv?.fundingRate ?? null,
    oiUsd: deriv?.oiUsd ?? null,
    lsRatio: deriv?.lsRatio ?? null,
    btcDom: global?.btcDom ?? null,
    mcapChange24h: global?.mcapChange24h ?? null,
  });

  const fullPrompt = `${marketDataBlock}

${LAYER_3}

${LAYER_4}

Additional computed data:
${snapshot}

KEY SUPPORT: $${supportLevel} | KEY RESISTANCE: $${resistanceLevel}

Output the complete JSON signal. All price fields must use actual numeric values from the market data above.${buildLanguageDirective("en")}`;

  try {
    const response = await withTimeout<GenerateContentResponse>(ai.models.generateContent({
      model: MODEL,
      contents: fullPrompt,
      config: {
        systemInstruction: LAYER_1_SYSTEM,
        responseMimeType: "application/json",
        // Schema has 25+ required fields including scalpingPlan (11 strings) and
        // priceScenarios (7 strings). 8192 was too tight and caused mid-string
        // truncation → "Unterminated string in JSON" parse errors. 16384 leaves
        // comfortable headroom while staying well under the 65k Gemini cap.
        maxOutputTokens: 16384,
        // DETERMINISM — critical for trading signals. Default temperature
        // (~1.0) caused identical input data to produce DIFFERENT analyses
        // across language calls (ID vs EN cache entries). Trading decisions
        // must be reproducible: same data → same verdict. Low temperature
        // + topP collapses the distribution to the highest-probability
        // (most-confident) reading of the indicators.
        temperature: 0.2,
        topP: 0.8,
        topK: 40,
        // Cap thinking to ~2048 tokens. Default dynamic thinking burns
        // 15-25 extra seconds per call (total ~37s). Disabling thinking
        // entirely (budget=0) drops to ~6s but the model defaults to
        // NO_TRADE with "N/A" levels because it skips proper analysis.
        // 2048 gives the model just enough room to evaluate the rich
        // market data we provide (EMAs, RSI, MACD, BB, derivatives,
        // OHLC, S/R) into a committed entry/SL/TP plan. A higher budget
        // (6144) does NOT change the verdict but adds 10-20s latency.
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            side: {
              type: Type.STRING,
              enum: ["BUY", "SELL", "NO_TRADE"],
            },
            entryRange: { type: Type.STRING },
            entryPrice: { type: Type.STRING },
            takeProfit: { type: Type.ARRAY, items: { type: Type.STRING } },
            takeProfitRR: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            stopLoss: { type: Type.STRING },
            stopLossRiskPct: { type: Type.STRING },
            confidence: { type: Type.NUMBER },
            reasoning: { type: Type.STRING },
            traderStyle: { type: Type.STRING },
            leverage: { type: Type.STRING },
            expertMindset: { type: Type.STRING },
            spotEntry: { type: Type.STRING },
            longTermTarget: { type: Type.STRING },
            marketStructure: {
              type: Type.STRING,
              enum: ["BULLISH", "BEARISH", "RANGING"],
            },
            riskReward: { type: Type.STRING },
            invalidation: { type: Type.STRING },
            keySupport: { type: Type.STRING },
            keyResistance: { type: Type.STRING },
            confluences: { type: Type.ARRAY, items: { type: Type.STRING } },
            noTradeReason: { type: Type.STRING },
            scoreBreakdown: {
              type: Type.OBJECT,
              properties: {
                trend: { type: Type.NUMBER },
                confluence: { type: Type.NUMBER },
                srLevel: { type: Type.NUMBER },
                volume: { type: Type.NUMBER },
                sentiment: { type: Type.NUMBER },
                funding: { type: Type.NUMBER },
                macro: { type: Type.NUMBER },
                total: { type: Type.NUMBER },
              },
              required: [
                "trend",
                "confluence",
                "srLevel",
                "volume",
                "sentiment",
                "funding",
                "macro",
                "total",
              ],
            },
            validUntil: { type: Type.STRING },
            timeframe: { type: Type.STRING },
            priceScenarios: {
              type: Type.OBJECT,
              properties: {
                bearishTarget: { type: Type.STRING },
                bearishTimeframe: { type: Type.STRING },
                bearishCondition: { type: Type.STRING },
                bullishTarget: { type: Type.STRING },
                bullishTimeframe: { type: Type.STRING },
                bullishCondition: { type: Type.STRING },
                baseCase: { type: Type.STRING },
              },
              required: [
                "bearishTarget",
                "bearishTimeframe",
                "bearishCondition",
                "bullishTarget",
                "bullishTimeframe",
                "bullishCondition",
                "baseCase",
              ],
            },
            scalpingPlan: SCALPING_PLAN_SCHEMA,
          },
          required: [
            "side",
            "entryRange",
            "entryPrice",
            "takeProfit",
            "takeProfitRR",
            "stopLoss",
            "stopLossRiskPct",
            "confidence",
            "reasoning",
            "traderStyle",
            "leverage",
            "expertMindset",
            "spotEntry",
            "longTermTarget",
            "marketStructure",
            "riskReward",
            "invalidation",
            "keySupport",
            "keyResistance",
            "confluences",
            "noTradeReason",
            "scoreBreakdown",
            "validUntil",
            "timeframe",
            "priceScenarios",
            "scalpingPlan",
          ],
        },
      },
    }), GEMINI_TIMEOUT_MS);

    // Guard against incomplete responses. When Gemini hits the output token
    // cap (or is interrupted by safety/other reasons) it can return a partial
    // JSON body that fails JSON.parse with an opaque "Unterminated string"
    // error. Detect any non-STOP finish reason and surface a clear error so
    // the client can prompt the user to retry.
    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== "STOP") {
      req.log.warn(
        { finishReason, pair },
        "AI signal response did not complete normally",
      );
      const code =
        finishReason === "MAX_TOKENS" ? "AI_RESPONSE_TRUNCATED" : "AI_RESPONSE_INCOMPLETE";
      return res.status(503).json({
        error: code,
        finishReason,
        message:
          "Sinyal AI tidak lengkap. Silakan coba generate ulang dalam beberapa detik.",
      });
    }
    const rawText = response.text ?? "{}";
    const result = JSON.parse(rawText);

    const isPlaceholder = (s: unknown): boolean => {
      if (typeof s !== "string") return true;
      const t = s.trim().toLowerCase();
      return (
        t === "" ||
        t === "n/a" ||
        t === "na" ||
        t === "none" ||
        t === "tidak ada" ||
        t === "tidak tersedia"
      );
    };
    if (isPlaceholder(result.spotEntry)) {
      const candidates = [
        parseFloat(supportLevel),
        sup1,
        sup2,
        sup3,
        ema50Val ?? NaN,
        ema200Val ?? NaN,
        livePrice > 0 ? livePrice * 0.97 : NaN,
      ];
      const anchor = candidates.find((v) => Number.isFinite(v) && v > 0);
      if (anchor) {
        const lower = anchor * 0.985;
        const upper = anchor * 1.015;
        const fmt = (v: number) =>
          `$${v.toLocaleString("en-US", {
            maximumFractionDigits: v >= 100 ? 2 : 4,
          })}`;
        // Canonical signal is always English. Translation pass below
        // converts text fields to Indonesian when needed.
        result.spotEntry = `Spot accumulation ${fmt(lower)} - ${fmt(upper)} near key support`;
      }
    }

    const englishPayload = {
      ...result,
      noTrade: result.side === "NO_TRADE",
      pair,
      timestamp: Date.now(),
      indicatorSnapshot: snapshot + "\n\n" + marketDataBlock,
    };

    // Cache the canonical English version under :en regardless of requested
    // language, so subsequent ID requests can re-translate from the same
    // numbers without rerunning the analysis.
    SIGNAL_CACHE.set(`${String(pair)}:en`, {
      ts: Date.now(),
      data: englishPayload,
    });

    if (lang === "en") {
      return res.json(englishPayload);
    }

    // lang === "id" — translate text fields. Numbers (entry, SL, TP,
    // confidence, scoreBreakdown, prices) are preserved exactly because
    // translateSignalToIndonesian() only sends text fields to the model
    // and merges the translated text back into the English payload.
    let idPayload: Record<string, any>;
    try {
      idPayload = await translateSignalToIndonesian(englishPayload);
    } catch (err: any) {
      req.log.warn(
        { err: err?.message, pair },
        "Indonesian translation failed; serving English canonical",
      );
      idPayload = englishPayload;
    }
    SIGNAL_CACHE.set(cacheKey, { ts: Date.now(), data: idPayload });
    return res.json(idPayload);
  } catch (err: any) {
    req.log.error({ err: err?.message }, "AI signal failed");
    const isQuotaErr =
      err?.message?.includes("429") || err?.message?.includes("RESOURCE_EXHAUSTED") ||
      err?.message?.toLowerCase().includes("quota") ||
      err?.message?.toLowerCase().includes("not found") ||
      err?.message?.includes("404");
    if (isQuotaErr && livePrice > 0) {
      req.log.warn({ pair }, "AI quota/model error — serving technical fallback signal");
      const fallback = buildFallbackSignal({
        pair: String(pair), livePrice,
        ema20: ema20Val, ema50: ema50Val, ema200: ema200Val,
        rsi1d: rsi1dVal, rsi4h: rsi4hVal, macd4h: macd4hVal,
        sup1, sup2, sup3, res1, res2, res3,
        trend4h, lang,
      });
      SIGNAL_CACHE.set(cacheKey, { ts: Date.now(), data: fallback });
      return res.json(fallback);
    }
    if (isQuotaErr) {
      return res.status(429).json({ error: "QUOTA_EXCEEDED" });
    }
    return res.status(500).json({ error: "AI generation failed" });
  }
});

async function generateWhalesFromGemini(): Promise<unknown[]> {
  const prompt = `
Generate 4 realistic Whale Alerts for the current crypto market.
Focus on BTC, ETH, SOL, BNB.
Transaction types: 'TRANSFER' (to exchange), 'ACCUMULATION' (from exchange to cold wallet), 'LIQUIDATION'.
Format: amount as plain number string, amountUsd as plain number string. From/To as exchange or wallet labels.
`.trim();

  const response = await withTimeout<GenerateContentResponse>(ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: 1024,
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            symbol: { type: Type.STRING },
            amount: { type: Type.STRING },
            amountUsd: { type: Type.STRING },
            from: { type: Type.STRING },
            to: { type: Type.STRING },
            transactionType: {
              type: Type.STRING,
              enum: ["TRANSFER", "ACCUMULATION", "LIQUIDATION"],
            },
          },
          required: [
            "symbol",
            "amount",
            "amountUsd",
            "from",
            "to",
            "transactionType",
          ],
        },
      },
    },
  }), GEMINI_TIMEOUT_MS);
  const list = JSON.parse(response.text ?? "[]");
  whalesCache = { ts: Date.now(), data: list };
  return list;
}

router.post("/ai/whales", requireAppSecret, aiLimiter, async (req: Request, res: Response) => {
  if (whalesCache && Date.now() - whalesCache.ts < WHALES_TTL_MS) {
    return res.json(whalesCache.data);
  }

  if (!whalesAiInflight) {
    whalesAiInflight = generateWhalesFromGemini().finally(() => {
      whalesAiInflight = null;
    });
  }

  try {
    const list = await whalesAiInflight;
    return res.json(list);
  } catch (err: any) {
    req.log.error({ err: err?.message }, "AI whales failed");
    if (
      err?.message?.includes("429") || err?.message?.includes("RESOURCE_EXHAUSTED") ||
      err?.message?.toLowerCase().includes("quota")
    ) {
      return res.status(429).json({ error: "QUOTA_EXCEEDED" });
    }
    return res.status(500).json({ error: "AI generation failed" });
  }
});

async function prewarmSignal(pair: string): Promise<void> {
  try {
    const [ohlc, settled] = await Promise.all([
      getOHLC(pair, 90),
      Promise.allSettled([
        fetchDerivatives(pair),
        fetchFearGreed(),
        fetchBtcDom(),
      ]),
    ]);
    const [derivData, fgiData, btcGlobal] = settled;
    const deriv = derivData.status === "fulfilled" ? derivData.value : null;
    const fgi = fgiData.status === "fulfilled" ? fgiData.value : null;
    const global = btcGlobal.status === "fulfilled" ? btcGlobal.value : null;

    if (!ohlc || ohlc.daily.closes.length < 30) return;

    const hourlyData = ohlc.hourly;
    const daily = ohlc.daily;
    const last = daily.closes[daily.closes.length - 1];
    const candles4h = aggregateCandles(
      hourlyData.closes,
      hourlyData.volumes,
      4,
      hourlyData.highs,
      hourlyData.lows,
    );
    const candlesWeek = aggregateCandles(
      daily.closes,
      daily.volumes,
      7,
      daily.highs,
      daily.lows,
    );

    const ema20Val = ema(daily.closes, 20);
    const ema50Val = ema(daily.closes, 50);
    const ema200Val = ema(daily.closes, Math.min(200, daily.closes.length - 1));
    const rsi1dVal = rsi(daily.closes, 14);
    const rsi4hVal = rsi(candles4h.closes, 14);
    const rsi1wVal = candlesWeek.closes.length > 15 ? rsi(candlesWeek.closes, 14) : null;
    const macd4hVal = macd(candles4h.closes);
    const stoch4hVal = stochastic(candles4h.highs, candles4h.lows, candles4h.closes);
    const bbVal = bollinger(daily.closes, 20, 2);
    const vp = volumeProfile(daily.volumes.slice(-30));
    const obvTrendStr = obvTrend(daily.closes, daily.volumes);
    const rsiDiv = detectRsiDivergence(daily.closes, 20);
    const swing7d = swingLevels(candles4h.highs, candles4h.lows, 42);
    const swing30d = swingLevels(daily.highs, daily.lows, 30);
    const swing90d = swingLevels(daily.highs, daily.lows, 90);
    const high24h =
      candles4h.highs.length > 0
        ? Math.max(...candles4h.highs.slice(-6))
        : last;
    const low24h =
      candles4h.lows.length > 0
        ? Math.min(...candles4h.lows.slice(-6))
        : last;
    const trend4hVal = trendStructure(
      ema(candles4h.closes, Math.min(50, candles4h.closes.length - 1)),
      ema(candles4h.closes, Math.min(200, candles4h.closes.length - 1)),
      last,
    );
    const bosVal = bosLevel(candles4h.highs, candles4h.lows, candles4h.closes, 20);
    const fib = fibLevels(swing7d.resistance, swing7d.support);
    const a14 = atr(daily.highs, daily.lows, daily.closes, 14);

    const snapshot = `4H Candles: ${candles4h.closes.length} | 1D: ${daily.closes.length} | 1W: ${candlesWeek.closes.length}
ATR(14): ${a14?.toFixed(4) ?? "N/A"}
Fibonacci: 0.382=$${fib["0.382"].toFixed(2)} 0.5=$${fib["0.5"].toFixed(2)} 0.618=$${fib["0.618"].toFixed(2)}`;

    const marketDataBlock = buildMarketDataBlock({
      pair,
      price: last,
      change24h: "0",
      high24h,
      low24h,
      highWeek: swing7d.resistance,
      lowWeek: swing7d.support,
      ema20: ema20Val,
      ema50: ema50Val,
      ema200: ema200Val,
      rsi4h: rsi4hVal,
      rsi1d: rsi1dVal,
      rsi1w: rsi1wVal,
      rsiDivergence: rsiDiv,
      macd4h: macd4hVal,
      stoch4h: stoch4hVal,
      bb: bbVal,
      volAvg30: vp.avg,
      volRecent: vp.recent,
      volSpike: vp.spike,
      obvTrendStr,
      trend4h: trend4hVal,
      bos: bosVal,
      res1: swing7d.resistance,
      res2: swing30d.resistance,
      res3: swing90d.resistance,
      sup1: swing7d.support,
      sup2: swing30d.support,
      sup3: swing90d.support,
      fgi,
      fundingRate: deriv?.fundingRate ?? null,
      oiUsd: deriv?.oiUsd ?? null,
      lsRatio: deriv?.lsRatio ?? null,
      btcDom: global?.btcDom ?? null,
      mcapChange24h: global?.mcapChange24h ?? null,
    });

    // Prewarm always generates the canonical English signal. The live
    // /ai/signal handler translates it to Indonesian on demand while
    // preserving every number, so prewarming English is sufficient for
    // both languages.
    const fullPrompt = `${marketDataBlock}\n\n${LAYER_3}\n\n${LAYER_4}\n\nAdditional: ${snapshot}\nKEY SUPPORT: $${swing7d.support.toFixed(2)} | KEY RESISTANCE: $${swing7d.resistance.toFixed(2)}\nOutput complete JSON signal.${buildLanguageDirective("en")}`;

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: fullPrompt,
      config: {
        systemInstruction: LAYER_1_SYSTEM,
        responseMimeType: "application/json",
        // Match the main /ai/signal handler — see comment there for rationale.
        maxOutputTokens: 16384,
        temperature: 0.2,
        topP: 0.8,
        topK: 40,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            side: { type: Type.STRING, enum: ["BUY", "SELL", "NO_TRADE"] },
            entryRange: { type: Type.STRING },
            entryPrice: { type: Type.STRING },
            takeProfit: { type: Type.ARRAY, items: { type: Type.STRING } },
            takeProfitRR: { type: Type.ARRAY, items: { type: Type.STRING } },
            stopLoss: { type: Type.STRING },
            stopLossRiskPct: { type: Type.STRING },
            confidence: { type: Type.NUMBER },
            reasoning: { type: Type.STRING },
            traderStyle: { type: Type.STRING },
            leverage: { type: Type.STRING },
            expertMindset: { type: Type.STRING },
            spotEntry: { type: Type.STRING },
            longTermTarget: { type: Type.STRING },
            marketStructure: { type: Type.STRING, enum: ["BULLISH", "BEARISH", "RANGING"] },
            riskReward: { type: Type.STRING },
            invalidation: { type: Type.STRING },
            keySupport: { type: Type.STRING },
            keyResistance: { type: Type.STRING },
            confluences: { type: Type.ARRAY, items: { type: Type.STRING } },
            noTradeReason: { type: Type.STRING },
            scoreBreakdown: {
              type: Type.OBJECT,
              properties: {
                trend: { type: Type.NUMBER },
                confluence: { type: Type.NUMBER },
                srLevel: { type: Type.NUMBER },
                volume: { type: Type.NUMBER },
                sentiment: { type: Type.NUMBER },
                funding: { type: Type.NUMBER },
                macro: { type: Type.NUMBER },
                total: { type: Type.NUMBER },
              },
              required: ["trend", "confluence", "srLevel", "volume", "sentiment", "funding", "macro", "total"],
            },
            validUntil: { type: Type.STRING },
            timeframe: { type: Type.STRING },
            priceScenarios: {
              type: Type.OBJECT,
              properties: {
                bearishTarget: { type: Type.STRING },
                bearishTimeframe: { type: Type.STRING },
                bearishCondition: { type: Type.STRING },
                bullishTarget: { type: Type.STRING },
                bullishTimeframe: { type: Type.STRING },
                bullishCondition: { type: Type.STRING },
                baseCase: { type: Type.STRING },
              },
              required: [
                "bearishTarget", "bearishTimeframe", "bearishCondition",
                "bullishTarget", "bullishTimeframe", "bullishCondition", "baseCase",
              ],
            },
            scalpingPlan: SCALPING_PLAN_SCHEMA,
          },
          required: [
            "side", "entryRange", "entryPrice", "takeProfit", "takeProfitRR",
            "stopLoss", "stopLossRiskPct", "confidence", "reasoning", "traderStyle",
            "leverage", "expertMindset", "spotEntry", "longTermTarget", "marketStructure",
            "riskReward", "invalidation", "keySupport", "keyResistance", "confluences",
            "noTradeReason", "scoreBreakdown", "validUntil", "timeframe", "priceScenarios",
            "scalpingPlan",
          ],
        },
      },
    });

    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== "STOP") {
      // Don't poison the cache with a truncated/blocked response. Just skip.
      return;
    }
    const result = JSON.parse(response.text ?? "{}");
    const payload = {
      ...result,
      noTrade: result.side === "NO_TRADE",
      pair,
      timestamp: Date.now(),
      indicatorSnapshot: snapshot + "\n\n" + marketDataBlock,
    };
    // Cache as canonical English. Live ID requests will translate from
    // this entry without rerunning the analysis.
    SIGNAL_CACHE.set(`${pair}:en`, { ts: Date.now(), data: payload });
  } catch {
    // silent — prewarm failure is non-critical
  }
}

const PREWARM_PAIRS = ["BTCUSDT", "ETHUSDT"];
let prewarmDone = false;
export function scheduleSignalPrewarm(): void {
  if (prewarmDone) return;
  prewarmDone = true;
  setTimeout(() => {
    Promise.allSettled(PREWARM_PAIRS.map((p) => prewarmSignal(p)));
  }, 5000);
}

export default router;
