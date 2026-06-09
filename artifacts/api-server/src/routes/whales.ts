import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

const OKX_BASE = "https://www.okx.com/api/v5";
const BINANCE_BASE = "https://fapi.binance.com/futures/data";
const TTL_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const REFRESH_TIMEOUT_MS = 25_000;
const WHALE_MIN_USD = 100_000;

const PAIRS_OKX = ["BTC-USDT", "ETH-USDT", "SOL-USDT"] as const;
const PAIRS_BINANCE = ["BTCUSDT", "ETHUSDT", "SOLUSDT"] as const;
type PairOkx = (typeof PAIRS_OKX)[number];

interface OkxLiqDetail {
  bkPx: string;
  sz: string;
  side: string;
  posSide: string;
  ts: string;
}
interface OkxLiqRow {
  uly?: string;
  details: OkxLiqDetail[];
}
interface OkxFunding {
  fundingRate: string;
  nextFundingRate?: string;
  fundingTime: string;
  instId: string;
}
interface OkxOI {
  oi: string;
  oiUsd: string;
  ts: string;
  instId: string;
}
interface OkxLSRatio {
  longShortRatio: string;
  longAccount: string;
  shortAccount: string;
  ts: string;
}

interface WhaleAlert {
  symbol: string;
  amount: string;
  amountUsd: string;
  from: string;
  to: string;
  transactionType: "TRANSFER" | "LIQUIDATION" | "ACCUMULATION";
  timestamp: number;
  isWhale: boolean;
}

interface DerivStat {
  symbol: string;
  fundingRate: number;
  fundingRateNext: number | null;
  nextFundingTime: number;
  oiUsd: number;
  bias: "LONG_HEAVY" | "SHORT_HEAVY" | "BALANCED";
}

interface LongShortData {
  symbol: string;
  longPct: number;
  shortPct: number;
  ratio: number;
  source: "OKX" | "BINANCE";
  type: "GLOBAL" | "TOP_TRADER";
}

interface NexusFeed {
  alerts: WhaleAlert[];
  whales: WhaleAlert[];
  derivatives: DerivStat[];
  longShortOkx: LongShortData[];
  longShortBinance: LongShortData[];
  totalLiquidatedUsd24h: number;
  longsLiquidatedUsd: number;
  shortsLiquidatedUsd: number;
  generatedAt: number;
}

let cache: { ts: number; data: NexusFeed | null } = { ts: 0, data: null };
let whalesInflight: Promise<NexusFeed> | null = null;

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "NexusAlpha/1.0" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timed out")), ms)),
  ]);
}

async function fetchLiquidations(uly: PairOkx): Promise<WhaleAlert[]> {
  const url = `${OKX_BASE}/public/liquidation-orders?instType=SWAP&state=filled&uly=${uly}&limit=100`;
  const data = await fetchJson<{ code: string; data: OkxLiqRow[] }>(url);
  if (!data?.data) return [];
  const symbol = uly.split("-")[0]!;
  const out: WhaleAlert[] = [];
  for (const row of data.data) {
    for (const d of row.details ?? []) {
      const px = parseFloat(d.bkPx);
      const sz = parseFloat(d.sz);
      if (!isFinite(px) || !isFinite(sz)) continue;
      const usd = px * sz;
      if (usd < 5_000) continue;
      const liquidatedSide = d.posSide?.toUpperCase() ?? "?";
      out.push({
        symbol,
        amount: sz.toString(),
        amountUsd: usd.toFixed(0),
        from: liquidatedSide === "LONG" ? "Long Trader (Liquidated)" : liquidatedSide === "SHORT" ? "Short Trader (Liquidated)" : "Trader",
        to: `OKX ${uly} SWAP`,
        transactionType: "LIQUIDATION",
        timestamp: parseInt(d.ts || "0", 10) || Date.now(),
        isWhale: usd >= WHALE_MIN_USD,
      });
    }
  }
  return out;
}

async function fetchOkxLongShort(uly: PairOkx): Promise<LongShortData | null> {
  const url = `${OKX_BASE}/rubik/stat/contracts/long-short-account-ratio?instId=${uly}-SWAP&period=5m&limit=1`;
  const data = await fetchJson<{ code: string; data: OkxLSRatio[] }>(url);
  const row = data?.data?.[0];
  if (!row) return null;
  const longPct = parseFloat(row.longAccount) * 100;
  const shortPct = parseFloat(row.shortAccount) * 100;
  return {
    symbol: uly.split("-")[0]!,
    longPct,
    shortPct,
    ratio: parseFloat(row.longShortRatio),
    source: "OKX",
    type: "GLOBAL",
  };
}

async function fetchBinanceLongShort(symbol: string): Promise<{ global: LongShortData | null; top: LongShortData | null }> {
  const [globalData, topData] = await Promise.all([
    fetchJson<{ longAccount: string; shortAccount: string; longShortRatio: string }[]>(
      `${BINANCE_BASE}/globalLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`
    ),
    fetchJson<{ longAccount: string; shortAccount: string; longShortRatio: string }[]>(
      `${BINANCE_BASE}/topLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`
    ),
  ]);

  const sym = symbol.replace("USDT", "");

  const global = globalData?.[0] ? {
    symbol: sym,
    longPct: parseFloat(globalData[0].longAccount) * 100,
    shortPct: parseFloat(globalData[0].shortAccount) * 100,
    ratio: parseFloat(globalData[0].longShortRatio),
    source: "BINANCE" as const,
    type: "GLOBAL" as const,
  } : null;

  const top = topData?.[0] ? {
    symbol: sym,
    longPct: parseFloat(topData[0].longAccount) * 100,
    shortPct: parseFloat(topData[0].shortAccount) * 100,
    ratio: parseFloat(topData[0].longShortRatio),
    source: "BINANCE" as const,
    type: "TOP_TRADER" as const,
  } : null;

  return { global, top };
}

async function fetchFunding(uly: PairOkx): Promise<OkxFunding | null> {
  const data = await fetchJson<{ code: string; data: OkxFunding[] }>(
    `${OKX_BASE}/public/funding-rate?instId=${uly}-SWAP`
  );
  return data?.data?.[0] ?? null;
}

async function fetchOI(uly: PairOkx): Promise<OkxOI | null> {
  const data = await fetchJson<{ code: string; data: OkxOI[] }>(
    `${OKX_BASE}/public/open-interest?instType=SWAP&uly=${uly}`
  );
  return data?.data?.[0] ?? null;
}

async function refreshWhales(): Promise<NexusFeed> {
  try {
    const [liqLists, fundings, ois, okxLSRatios, binanceLSRatios] = await Promise.all([
      Promise.all(PAIRS_OKX.map(fetchLiquidations)),
      Promise.all(PAIRS_OKX.map(fetchFunding)),
      Promise.all(PAIRS_OKX.map(fetchOI)),
      Promise.all(PAIRS_OKX.map(fetchOkxLongShort)),
      Promise.all(PAIRS_BINANCE.map(fetchBinanceLongShort)),
    ]);

    const allAlerts = liqLists.flat().sort((a, b) => b.timestamp - a.timestamp);
    const whales = allAlerts.filter(a => a.isWhale);

    const derivatives: DerivStat[] = PAIRS_OKX.map((p, i) => {
      const f = fundings[i];
      const o = ois[i];
      const fr = f ? parseFloat(f.fundingRate) : 0;
      const oiUsd = o ? parseFloat(o.oiUsd) : 0;
      const bias: DerivStat["bias"] = fr > 0.0001 ? "LONG_HEAVY" : fr < -0.0001 ? "SHORT_HEAVY" : "BALANCED";
      return {
        symbol: p.split("-")[0]!,
        fundingRate: fr,
        fundingRateNext: f?.nextFundingRate ? parseFloat(f.nextFundingRate) : null,
        nextFundingTime: f ? parseInt(f.fundingTime, 10) : 0,
        oiUsd,
        bias,
      };
    });

    const longShortOkx = okxLSRatios.filter((x): x is LongShortData => x !== null);
    const longShortBinance = binanceLSRatios.flatMap(r => [r.global, r.top]).filter((x): x is LongShortData => x !== null);

    const longsLiquidatedUsd = allAlerts.filter(a => a.from.startsWith("Long")).reduce((s, a) => s + parseFloat(a.amountUsd), 0);
    const shortsLiquidatedUsd = allAlerts.filter(a => a.from.startsWith("Short")).reduce((s, a) => s + parseFloat(a.amountUsd), 0);

    const feed: NexusFeed = {
      alerts: allAlerts.slice(0, 30),
      whales: whales.slice(0, 20),
      derivatives,
      longShortOkx,
      longShortBinance,
      totalLiquidatedUsd24h: longsLiquidatedUsd + shortsLiquidatedUsd,
      longsLiquidatedUsd,
      shortsLiquidatedUsd,
      generatedAt: Date.now(),
    };

    cache = { ts: Date.now(), data: feed };
    return feed;
  } finally {
    whalesInflight = null;
  }
}

router.get("/whales/feed", async (req: Request, res: Response) => {
  if (cache.data && Date.now() - cache.ts < TTL_MS) return res.json(cache.data);
  if (!whalesInflight) whalesInflight = refreshWhales();
  try {
    const data = await withTimeout(whalesInflight, REFRESH_TIMEOUT_MS);
    return res.json(data);
  } catch (err: any) {
    req.log.error({ err: err?.message }, "whales fetch failed");
    if (cache.data) return res.json(cache.data);
    return res.status(503).json({ error: "Data tidak tersedia, coba lagi nanti" });
  }
});

export default router;
