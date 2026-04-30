import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

const OKX_BASE = "https://www.okx.com/api/v5";
const TTL_MS = 60 * 1000;

const PAIRS = ["BTC-USDT", "ETH-USDT", "SOL-USDT"] as const;
type PairUly = (typeof PAIRS)[number];

interface OkxLiqDetail {
  bkPx: string;
  sz: string;
  side: string;
  posSide: string;
  ts: string;
  ccy?: string;
}
interface OkxLiqRow {
  instFamily?: string;
  instId?: string;
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

interface WhaleAlert {
  symbol: string;
  amount: string;
  amountUsd: string;
  from: string;
  to: string;
  transactionType: "TRANSFER" | "LIQUIDATION" | "ACCUMULATION";
  timestamp: number;
}

interface DerivStat {
  symbol: string;
  fundingRate: number;
  fundingRateNext: number | null;
  nextFundingTime: number;
  oiUsd: number;
  bias: "LONG_HEAVY" | "SHORT_HEAVY" | "BALANCED";
}

interface NexusFeed {
  alerts: WhaleAlert[];
  derivatives: DerivStat[];
  totalLiquidatedUsd24h: number;
  longsLiquidatedUsd: number;
  shortsLiquidatedUsd: number;
  generatedAt: number;
}

let cache: { ts: number; data: NexusFeed | null } = { ts: 0, data: null };
let whalesInflight: Promise<NexusFeed> | null = null;

const FETCH_TIMEOUT_MS = 10_000;
const REFRESH_TIMEOUT_MS = 25_000;

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
  const timeout = new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error("refresh timed out")), ms),
  );
  return Promise.race([promise, timeout]);
}

async function fetchLiquidations(uly: PairUly): Promise<WhaleAlert[]> {
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
        from:
          liquidatedSide === "LONG"
            ? "Long Trader (Liquidated)"
            : liquidatedSide === "SHORT"
              ? "Short Trader (Liquidated)"
              : "Trader",
        to: `OKX ${uly} SWAP`,
        transactionType: "LIQUIDATION",
        timestamp: parseInt(d.ts || row.details[0]?.ts || "0", 10) || Date.now(),
      });
    }
  }
  return out;
}

async function fetchFunding(uly: PairUly): Promise<OkxFunding | null> {
  const instId = `${uly}-SWAP`;
  const data = await fetchJson<{ code: string; data: OkxFunding[] }>(
    `${OKX_BASE}/public/funding-rate?instId=${instId}`,
  );
  return data?.data?.[0] ?? null;
}

async function fetchOI(uly: PairUly): Promise<OkxOI | null> {
  const data = await fetchJson<{ code: string; data: OkxOI[] }>(
    `${OKX_BASE}/public/open-interest?instType=SWAP&uly=${uly}`,
  );
  return data?.data?.[0] ?? null;
}

async function refreshWhales(): Promise<NexusFeed> {
  try {
    const [liqLists, fundings, ois] = await Promise.all([
      Promise.all(PAIRS.map((p) => fetchLiquidations(p))),
      Promise.all(PAIRS.map((p) => fetchFunding(p))),
      Promise.all(PAIRS.map((p) => fetchOI(p))),
    ]);

    const allAlerts = liqLists.flat().sort((a, b) => b.timestamp - a.timestamp);

    const derivatives: DerivStat[] = PAIRS.map((p, i) => {
      const f = fundings[i];
      const o = ois[i];
      const fr = f ? parseFloat(f.fundingRate) : 0;
      const oiUsd = o ? parseFloat(o.oiUsd) : 0;
      const bias: DerivStat["bias"] =
        fr > 0.0001
          ? "LONG_HEAVY"
          : fr < -0.0001
            ? "SHORT_HEAVY"
            : "BALANCED";
      return {
        symbol: p.split("-")[0]!,
        fundingRate: fr,
        fundingRateNext: f?.nextFundingRate
          ? parseFloat(f.nextFundingRate)
          : null,
        nextFundingTime: f ? parseInt(f.fundingTime, 10) : 0,
        oiUsd,
        bias,
      };
    });

    const longsLiquidatedUsd = allAlerts
      .filter((a) => a.from.startsWith("Long"))
      .reduce((s, a) => s + parseFloat(a.amountUsd), 0);
    const shortsLiquidatedUsd = allAlerts
      .filter((a) => a.from.startsWith("Short"))
      .reduce((s, a) => s + parseFloat(a.amountUsd), 0);

    const feed: NexusFeed = {
      alerts: allAlerts.slice(0, 30),
      derivatives,
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
  if (cache.data && Date.now() - cache.ts < TTL_MS) {
    return res.json(cache.data);
  }

  if (!whalesInflight) {
    whalesInflight = refreshWhales();
  }

  try {
    const data = await withTimeout(whalesInflight, REFRESH_TIMEOUT_MS);
    return res.json(data);
  } catch (err: any) {
    req.log.error({ err: err?.message }, "whales fetch failed");
    if (cache.data) return res.json(cache.data);
    return res
      .status(503)
      .json({ error: "Sumber data OKX tidak tersedia, coba lagi nanti" });
  }
});

export default router;
