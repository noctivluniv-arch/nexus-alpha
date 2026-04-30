import {
  PriceData,
  TradingPair,
  TradingSignal,
  WhaleAlert,
  MemeCoin,
  NewsFeedItem,
  NexusFeed,
  FearGreedData,
  ChartPayload,
  ChartTimeframe,
} from "./types";

const BASE = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : "";

const AI_APP_SECRET = process.env.EXPO_PUBLIC_AI_APP_SECRET;

function withAppSecret(init?: RequestInit): RequestInit {
  if (!AI_APP_SECRET) return init ?? {};
  const headers = new Headers(init?.headers as HeadersInit | undefined);
  headers.set("x-app-secret", AI_APP_SECRET);
  return { ...init, headers };
}

async function jsonFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const r = await fetch(`${BASE}${path}`, init);
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    if (r.status === 429 || text.includes("QUOTA_EXCEEDED")) {
      throw new Error("QUOTA_EXCEEDED");
    }
    if (text.includes("AI_RESPONSE_TRUNCATED")) {
      throw new Error("AI_RESPONSE_TRUNCATED");
    }
    throw new Error(`Request failed: ${r.status}`);
  }
  return r.json() as Promise<T>;
}

export const api = {
  async getPrices(pairs: TradingPair[]): Promise<PriceData[]> {
    const symbols = pairs.join(",");
    return jsonFetch<PriceData[]>(
      `/api/binance/tickers?symbols=${encodeURIComponent(symbols)}`,
    );
  },

  async generateSignal(
    pair: TradingPair,
    priceData: PriceData | undefined,
    lang: "id" | "en" = "id",
  ): Promise<TradingSignal> {
    return jsonFetch<TradingSignal>(`/api/ai/signal`, withAppSecret({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pair, priceData, lang }),
    }));
  },

  async getNexusFeed(): Promise<{
    alerts: WhaleAlert[];
    derivatives: NexusFeed["derivatives"];
    totalLiquidatedUsd24h: number;
    longsLiquidatedUsd: number;
    shortsLiquidatedUsd: number;
  }> {
    const feed = await jsonFetch<NexusFeed>(`/api/whales/feed`);
    return {
      alerts: feed.alerts.map((a, idx) => ({
        ...a,
        id: `${a.timestamp}-${idx}`,
      })),
      derivatives: feed.derivatives,
      totalLiquidatedUsd24h: feed.totalLiquidatedUsd24h,
      longsLiquidatedUsd: feed.longsLiquidatedUsd,
      shortsLiquidatedUsd: feed.shortsLiquidatedUsd,
    };
  },

  async getNews(): Promise<NewsFeedItem[]> {
    return jsonFetch<NewsFeedItem[]>(`/api/news/feed`);
  },

  async getFearGreed(): Promise<FearGreedData> {
    return jsonFetch<FearGreedData>(`/api/binance/fear-greed`);
  },

  async getMemeCoins(): Promise<MemeCoin[]> {
    const list = await jsonFetch<Omit<MemeCoin, "id">[]>(`/api/ai/memes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    return list.map((item, idx) => ({
      ...item,
      id: `${Date.now()}-${idx}`,
    }));
  },

  async getMemeChart(
    network: string,
    pool: string,
    tf: ChartTimeframe,
  ): Promise<ChartPayload> {
    const qs = new URLSearchParams({ network, pool, tf }).toString();
    return jsonFetch<ChartPayload>(`/api/ai/memes/chart?${qs}`);
  },
};

export function formatNumber(val: string | number, decimals = 0): string {
  const num =
    typeof val === "string" ? parseFloat(val.replace(/,/g, "")) : val;
  if (isNaN(num)) return String(val);
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
}
