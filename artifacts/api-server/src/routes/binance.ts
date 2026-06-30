import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

export const SYMBOL_TO_ID: Record<string, string> = {
  BTCUSDT: "bitcoin",
  ETHUSDT: "ethereum",
  BNBUSDT: "binancecoin",
  SUIUSDT: "sui",
  SOLUSDT: "solana",
  HYPEUSDT: "hyperliquid",
  LINKUSDT: "chainlink",
  XRPUSDT: "ripple",
  DOGEUSDT: "dogecoin",
  AVAXUSDT: "avalanche-2",
};

interface PriceEntry {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
}

let priceCache: { ts: number; data: Record<string, PriceEntry> } = {
  ts: 0,
  data: {},
};
let priceRefreshInflight: Promise<void> | null = null;

const CACHE_TTL_MS = 45 * 1000;

async function refreshPriceCache(): Promise<void> {
  const ids = Object.values(SYMBOL_TO_ID).join(",");
  const url = `${COINGECKO_BASE}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
  const r = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) {
    throw new Error(`coingecko ${r.status}`);
  }
  const json = (await r.json()) as Record<
    string,
    { usd: number; usd_24h_change: number }
  >;

  const next: Record<string, PriceEntry> = {};
  for (const [sym, id] of Object.entries(SYMBOL_TO_ID)) {
    const entry = json[id];
    next[sym] = {
      symbol: sym,
      lastPrice: entry ? String(entry.usd) : "0",
      priceChangePercent: entry ? String(entry.usd_24h_change ?? 0) : "0",
    };
  }
  priceCache = { ts: Date.now(), data: next };
}

async function getPrices(symbols: string[]): Promise<PriceEntry[]> {
  const isStale = Date.now() - priceCache.ts > CACHE_TTL_MS;
  if (isStale) {
    if (!priceRefreshInflight) {
      priceRefreshInflight = refreshPriceCache().finally(() => {
        priceRefreshInflight = null;
      });
    }
    try {
      await priceRefreshInflight;
    } catch {
      // fall back to last known cache
    }
  }
  return symbols
    .map((s) => priceCache.data[s])
    .filter((x): x is PriceEntry => Boolean(x));
}

router.get("/binance/tickers", async (req: Request, res: Response) => {
  const symbols = String(req.query["symbols"] ?? "");
  if (!symbols) return res.status(400).json({ error: "symbols required" });
  const list = symbols
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  try {
    const prices = await getPrices(list);
    return res.json(prices);
  } catch (err) {
    req.log.error({ err }, "price fetch failed");
    return res.status(500).json({ error: "price fetch failed" });
  }
});

interface OHLCData {
  timestamps: number[];
  closes: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
}

// Composite OHLC bundle: short-window hourly bars for intraday/4H analysis,
// long-window daily bars for trend/EMA200/swing-90 long-term context.
export interface OHLCBundle {
  hourly: OHLCData; // 1H × ~300 = ~12.5 days
  daily: OHLCData; // 1D × ~300 = ~300 days
}

const ohlcCache = new Map<string, { ts: number; data: OHLCBundle }>();
const OHLC_TTL_MS = 15 * 60 * 1000;
const ohlcInflight = new Map<string, Promise<OHLCBundle | null>>();

// OKX is our primary OHLC source. CoinGecko free tier aggressively
// rate-limits the market_chart endpoint (only BTC consistently returns
// 90d; ETH/SUI/BNB/etc. return 429 within seconds). OKX is geo-accessible
// from Replit, has no auth, no rate limits at our volume, and returns
// real per-bar OHLC (not derived from price points like CoinGecko).
async function fetchOkxBars(
  instId: string,
  bar: "1H" | "1D",
): Promise<OHLCData | null> {
  const url = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=300`;
  try {
    const r = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) return null;
    const json = (await r.json()) as {
      code: string;
      data?: string[][];
    };
    if (json.code !== "0" || !json.data?.length) return null;
    // OKX returns newest-first. Reverse to oldest-first to match what
    // downstream indicators (EMA, RSI, MACD, BB, swing levels) expect.
    // Each bar: [ts, open, high, low, close, volume_base, volume_quote, ...]
    const reversed = [...json.data].reverse();
    const timestamps = reversed.map((b) => Number(b[0]));
    const highs = reversed.map((b) => Number(b[2]));
    const lows = reversed.map((b) => Number(b[3]));
    const closes = reversed.map((b) => Number(b[4]));
    const volumes = reversed.map((b) => Number(b[6])); // quote volume (USDT)
    return { timestamps, closes, highs, lows, volumes };
  } catch {
    return null;
  }
}

async function fetchOkxBundle(symbol: string): Promise<OHLCBundle | null> {
  // SUIUSDT -> SUI-USDT. All our supported pairs use USDT quote.
  const base = symbol.replace(/USDT$/, "");
  const instId = `${base}-USDT`;
  // Fetch hourly + daily in parallel. Both return ~300ms each from OKX.
  const [hourly, daily] = await Promise.all([
    fetchOkxBars(instId, "1H"),
    fetchOkxBars(instId, "1D"),
  ]);
  if (!hourly || !daily) return null;
  return { hourly, daily };
}

async function fetchCoingeckoBundle(id: string): Promise<OHLCBundle | null> {
  // CoinGecko fallback — used only when OKX is unreachable. Single-call
  // approach: fetch one window and synthesize both hourly & daily views
  // from it. days=7 returns hourly bars and is one of the few free-tier
  // params not aggressively throttled.
  const url = `${COINGECKO_BASE}/coins/${id}/market_chart?vs_currency=usd&days=7`;
  try {
    const r = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    const json = (await r.json()) as {
      prices: [number, number][];
      total_volumes: [number, number][];
    };
    const closes = json.prices.map((p) => p[1]);
    const timestamps = json.prices.map((p) => p[0]);
    const volumes = json.total_volumes.map((v) => v[1]);
    // CoinGecko market_chart returns single price points (not OHLC), so
    // each bar has no intra-bar range. Set high = low = close per bar
    // (degraded vs OKX but NOT monotonic — important so downstream
    // aggregation, swing levels, and BOS aren't poisoned by ever-growing
    // running max/min). Indicators that need true intra-bar range will
    // simply collapse to close-based behavior on the fallback path.
    const highs: number[] = closes.slice();
    const lows: number[] = closes.slice();
    const hourly: OHLCData = { timestamps, closes, highs, lows, volumes };
    // No real daily data in this single fetch — use hourly as daily too.
    // Indicators that need long-term context (EMA200, swing90d) will be
    // limited but the model still gets a coherent (if short-window) view.
    return { hourly, daily: hourly };
  } catch {
    return null;
  }
}

export async function getOHLC(
  symbol: string,
  _days = 30,
): Promise<OHLCBundle | null> {
  const id = SYMBOL_TO_ID[symbol];
  if (!id) return null;
  // Single cache key per symbol — the bundle window is fixed.
  // The legacy `days` parameter is kept for API compat but ignored.
  const key = symbol;
  const cached = ohlcCache.get(key);
  if (cached && Date.now() - cached.ts < OHLC_TTL_MS) return cached.data;

  // Coalesce concurrent requests for the same symbol so a burst of
  // signal generations doesn't trigger N parallel upstream fetches.
  const inflight = ohlcInflight.get(key);
  if (inflight) return inflight;

  const promise = (async () => {
    let bundle = await fetchOkxBundle(symbol);
    if (!bundle) bundle = await fetchCoingeckoBundle(id);
    if (bundle) {
      ohlcCache.set(key, { ts: Date.now(), data: bundle });
    } else if (cached) {
      return cached.data;
    }
    return bundle;
  })().finally(() => {
    ohlcInflight.delete(key);
  });

  ohlcInflight.set(key, promise);
  return promise;
}

interface FearGreedPoint {
  value: number;
  classification: string;
  timestamp: number;
}
interface FearGreedResponse {
  current: FearGreedPoint;
  yesterday: FearGreedPoint | null;
  lastWeek: FearGreedPoint | null;
  lastMonth: FearGreedPoint | null;
  history: FearGreedPoint[];
  nextUpdateSeconds: number;
}

let fgCache: { ts: number; data: FearGreedResponse | null } = {
  ts: 0,
  data: null,
};
const FG_TTL_MS = 10 * 60 * 1000;

router.get("/binance/fear-greed", async (req: Request, res: Response) => {
  if (fgCache.data && Date.now() - fgCache.ts < FG_TTL_MS) {
    return res.json(fgCache.data);
  }
  try {
    const r = await fetch("https://api.alternative.me/fng/?limit=31", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`alt.me ${r.status}`);
    const json = (await r.json()) as {
      data: {
        value: string;
        value_classification: string;
        timestamp: string;
        time_until_update?: string;
      }[];
    };
    const points: FearGreedPoint[] = (json.data ?? []).map((d) => ({
      value: parseInt(d.value, 10),
      classification: d.value_classification,
      timestamp: parseInt(d.timestamp, 10) * 1000,
    }));
    if (points.length === 0) throw new Error("no data");

    const data: FearGreedResponse = {
      current: points[0],
      yesterday: points[1] ?? null,
      lastWeek: points[7] ?? null,
      lastMonth: points[30] ?? null,
      history: points.slice(0, 8),
      nextUpdateSeconds: parseInt(
        json.data[0]?.time_until_update ?? "0",
        10,
      ),
    };
    fgCache = { ts: Date.now(), data };
    return res.json(data);
  } catch (err: any) {
    req.log.error({ err: err?.message }, "fear-greed fetch failed");
    if (fgCache.data) return res.json(fgCache.data);
    return res
      .status(503)
      .json({ error: "Fear & Greed index tidak tersedia" });
  }
});

router.get("/binance/ticker", async (req: Request, res: Response) => {
  const symbol = String(req.query["symbol"] ?? "").toUpperCase();
  if (!symbol) return res.status(400).json({ error: "symbol required" });
  if (!SYMBOL_TO_ID[symbol]) {
    return res.status(404).json({ error: "unsupported symbol" });
  }
  try {
    const prices = await getPrices([symbol]);
    return res.json(prices[0] ?? null);
  } catch (err) {
    req.log.error({ err }, "price fetch failed");
    return res.status(500).json({ error: "price fetch failed" });
  }
});

export default router;
