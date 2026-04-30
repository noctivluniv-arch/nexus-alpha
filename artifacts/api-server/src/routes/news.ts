import { Router, type IRouter, type Request, type Response } from "express";
import { ai } from "@workspace/integrations-gemini-ai";
import { XMLParser } from "fast-xml-parser";
import { Type } from "@google/genai";

const router: IRouter = Router();
const MODEL = "gemini-2.5-flash";

type InfluencerTag = "TRUMP" | "ELON" | "BLACKROCK";

interface NewsItem {
  id: string;
  source: string;
  sourceType: "X" | "NEWS";
  author?: string;
  title: string;
  summary: string;
  category: "BTC" | "ETH" | "ALT" | "MARKET" | "DEFI" | "MEME" | "REGULATION";
  time: string;
  url: string;
  isInfluencer: boolean;
  influencer?: InfluencerTag | null;
  impact: "HIGH" | "MEDIUM" | "LOW";
  sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
}

interface RssArticle {
  title: string;
  url: string;
  source: string;
  pubDate?: string;
  influencer?: InfluencerTag | null;
}

const NEWS_TTL_MS = 8 * 60 * 1000;
const STALE_GRACE_MS = 30 * 60 * 1000;
const GEMINI_TIMEOUT_MS = 45_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error("Gemini enrichment timed out")), ms),
  );
  return Promise.race([promise, timeout]);
}

let newsCache: { ts: number; data: NewsItem[] } = { ts: 0, data: [] };
let newsInflight: Promise<NewsItem[]> | null = null;

const XML_PARSER = new XMLParser({ ignoreAttributes: false });

const RSS_FEEDS: { url: string; source: string }[] = [
  {
    url: "https://cointelegraph.com/rss",
    source: "CoinTelegraph",
  },
  {
    url: "https://www.coindesk.com/arc/outboundfeeds/rss/",
    source: "CoinDesk",
  },
  {
    url: "https://decrypt.co/feed",
    source: "Decrypt",
  },
];

// Real-time Google News searches scoped to each market-mover + crypto keywords.
// `when:2d` limits to last ~48h. Each feed is pre-tagged so Gemini preserves the
// influencer attribution rather than guessing from training data.
const INFLUENCER_FEEDS: {
  url: string;
  source: string;
  influencer: InfluencerTag;
}[] = [
  {
    url:
      "https://news.google.com/rss/search?q=%22Elon+Musk%22+(crypto+OR+bitcoin+OR+doge+OR+dogecoin+OR+XRP)+when%3A2d&hl=en-US&gl=US&ceid=US:en",
    source: "Google News",
    influencer: "ELON",
  },
  {
    url:
      "https://news.google.com/rss/search?q=%22Donald+Trump%22+(crypto+OR+bitcoin+OR+%22digital+asset%22+OR+stablecoin+OR+%22ETF%22)+when%3A2d&hl=en-US&gl=US&ceid=US:en",
    source: "Google News",
    influencer: "TRUMP",
  },
  {
    url:
      "https://news.google.com/rss/search?q=BlackRock+(bitcoin+OR+IBIT+OR+ETHA+OR+%22spot+ETF%22+OR+ethereum+OR+cryptocurrency)+when%3A2d&hl=en-US&gl=US&ceid=US:en",
    source: "Google News",
    influencer: "BLACKROCK",
  },
];

const X_HOSTS = new Set(["x.com", "twitter.com", "t.co", "www.x.com", "www.twitter.com"]);

// Allowlist of trusted news source hostnames. Only URLs from these hosts are
// forwarded to clients for NEWS-type items; anything else is dropped so that a
// compromised or malicious RSS feed item cannot inject an arbitrary HTTPS URL.
const NEWS_HOSTS = new Set([
  "cointelegraph.com",
  "www.cointelegraph.com",
  "coindesk.com",
  "www.coindesk.com",
  "decrypt.co",
  "www.decrypt.co",
  "news.google.com",
]);

function sanitizeNewsUrl(raw: string, sourceType?: string): string {
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return "";
    if (sourceType === "X" && !X_HOSTS.has(u.hostname.toLowerCase())) return "";
    if (sourceType === "NEWS" && !NEWS_HOSTS.has(u.hostname.toLowerCase())) return "";
    return u.href;
  } catch {
    return "";
  }
}

function relativeTime(pubDate: string | undefined): string {
  if (!pubDate) return "baru saja";
  try {
    const d = new Date(pubDate);
    const diffMs = Date.now() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 2) return "baru saja";
    if (diffMin < 60) return `${diffMin} menit lalu`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH} jam lalu`;
    return `${Math.floor(diffH / 24)} hari lalu`;
  } catch {
    return "baru saja";
  }
}

async function fetchRssFeed(
  feedUrl: string,
  source: string,
  limit = 6,
  influencer: InfluencerTag | null = null,
): Promise<RssArticle[]> {
  const r = await fetch(feedUrl, {
    headers: { "User-Agent": "NexusAlpha/1.0" },
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) return [];
  const xml = await r.text();
  const parsed = XML_PARSER.parse(xml);
  const items: any[] =
    parsed?.rss?.channel?.item ??
    parsed?.feed?.entry ??
    [];
  return items.slice(0, limit).map((item: any) => {
    // Google News uses <source> for the original publisher.
    const realSource =
      item.source?.["#text"] ??
      item.source ??
      source;
    return {
      title: String(item.title?.["#text"] ?? item.title ?? "")
        .replace(/<[^>]+>/g, "")
        .trim(),
      url: String(
        item.link?.["#text"] ?? item.link ?? item.guid?.["#text"] ?? item.guid ?? "",
      ).trim(),
      source:
        influencer && typeof realSource === "string" && realSource !== source
          ? `${realSource} (Google News)`
          : String(realSource),
      pubDate: String(item.pubDate ?? item.published ?? item.updated ?? ""),
      influencer,
    };
  });
}

// Crypto keyword guard for influencer feeds — Google News may return
// political/general articles that mention the person but aren't crypto-related.
const CRYPTO_KEYWORDS_RE =
  /\b(crypto|cryptocurrency|bitcoin|btc|ethereum|eth|doge|dogecoin|xrp|solana|sol|memecoin|stablecoin|altcoin|defi|nft|spot etf|ibit|etha|blockchain|coinbase|binance|trump coin|world liberty|usd1)\b/i;

async function fetchAllRss(): Promise<RssArticle[]> {
  // Fetch influencer feeds FIRST so they win during dedup if a mainstream
  // outlet republishes the same headline.
  const allFeedPromises = [
    ...INFLUENCER_FEEDS.map((f) =>
      fetchRssFeed(f.url, f.source, 5, f.influencer),
    ),
    ...RSS_FEEDS.map((f) => fetchRssFeed(f.url, f.source, 6, null)),
  ];
  const results = await Promise.allSettled(allFeedPromises);
  const articles: RssArticle[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") articles.push(...r.value);
  }

  // Filter influencer items to crypto-relevant only; keep regular feeds as-is.
  const filtered = articles.filter((a) => {
    if (!a.influencer) return true;
    return CRYPTO_KEYWORDS_RE.test(`${a.title}`);
  });

  // Deduplicate by title — first occurrence wins, so influencer-tagged
  // articles (added first above) take precedence over mainstream duplicates.
  const seen = new Set<string>();
  const deduped: RssArticle[] = [];
  for (const a of filtered) {
    const key = a.title.toLowerCase().slice(0, 80);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(a);
  }

  const influencerItems = deduped.filter((a) => a.influencer);
  const regularItems = deduped.filter((a) => !a.influencer);
  return [...influencerItems.slice(0, 12), ...regularItems.slice(0, 12)];
}

async function enrichWithGemini(
  articles: RssArticle[],
): Promise<NewsItem[]> {
  const articleList = articles
    .map(
      (a, i) =>
        `[${i + 1}] SOURCE:${a.source} INFLUENCER:${a.influencer ?? "NONE"} TITLE:"${a.title}" URL:${a.url} DATE:${a.pubDate ?? ""}`,
    )
    .join("\n");

  const prompt = `You are a crypto analyst. Given these REAL news headlines (already fetched live, no fabrication), return a JSON array with one entry per article in the SAME ORDER:
- sentiment (BULLISH/BEARISH/NEUTRAL) — how this affects crypto market
- category (BTC/ETH/ALT/MARKET/DEFI/MEME/REGULATION)
- impact (HIGH/MEDIUM/LOW) — articles tagged INFLUENCER are usually HIGH/MEDIUM since these are major market movers
- summary (1 short sentence in Indonesian explaining market relevance)
- time (relative, in Indonesian like "2 jam lalu" — derive from DATE field)
- sourceType: "X" if URL contains x.com/twitter.com, otherwise "NEWS"
- isInfluencer: true ONLY if INFLUENCER field above is ELON, TRUMP, or BLACKROCK
- influencer: copy the INFLUENCER field VERBATIM (ELON / TRUMP / BLACKROCK / NONE) — do NOT change or guess
- url: copy the URL field exactly as given (do not modify)
- title: copy the TITLE exactly (you may slightly clean if needed, keep meaning)
- source: copy the SOURCE exactly
- author: leave empty string

ARTICLES (${articles.length}):
${articleList}

Return ONLY a flat JSON array with ${articles.length} items, in the same order as input. Do NOT add fabricated entries.`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: 4096,
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            source: { type: Type.STRING },
            sourceType: { type: Type.STRING, enum: ["X", "NEWS"] },
            author: { type: Type.STRING },
            title: { type: Type.STRING },
            summary: { type: Type.STRING },
            category: {
              type: Type.STRING,
              enum: [
                "BTC",
                "ETH",
                "ALT",
                "MARKET",
                "DEFI",
                "MEME",
                "REGULATION",
              ],
            },
            time: { type: Type.STRING },
            url: { type: Type.STRING },
            isInfluencer: { type: Type.BOOLEAN },
            influencer: {
              type: Type.STRING,
              enum: ["TRUMP", "ELON", "BLACKROCK", "NONE"],
            },
            impact: { type: Type.STRING, enum: ["HIGH", "MEDIUM", "LOW"] },
            sentiment: {
              type: Type.STRING,
              enum: ["BULLISH", "BEARISH", "NEUTRAL"],
            },
          },
          required: [
            "source",
            "sourceType",
            "title",
            "summary",
            "category",
            "time",
            "url",
            "isInfluencer",
            "influencer",
            "impact",
            "sentiment",
          ],
        },
      },
    },
  });

  let list: any[] = [];
  try {
    list = JSON.parse(response.text ?? "[]");
  } catch {
    list = [];
  }
  if (!Array.isArray(list)) list = [];

  const validCategories = [
    "BTC",
    "ETH",
    "ALT",
    "MARKET",
    "DEFI",
    "MEME",
    "REGULATION",
  ];

  // We asked Gemini to return one entry per input article in the same order.
  // Reconcile by INDEX (more reliable than URL-string matching, which can fail
  // if the model normalizes the URL). Also keep a URL fallback for resilience.
  const byUrl = new Map<string, RssArticle>();
  for (const a of articles) {
    if (a.url) byUrl.set(a.url, a);
  }

  return list
    .filter((x) => x && x.title && x.summary)
    .map((x, idx) => {
      // Resolve the source article: prefer index alignment, fall back to URL.
      const original: RssArticle | undefined =
        articles[idx] ??
        (x.url ? byUrl.get(String(x.url)) : undefined);

      // Ground-truth influencer attribution (never trust the model here).
      const influencer: InfluencerTag | null = original?.influencer ?? null;

      // Force sourceType from the canonical URL to avoid model drift.
      const canonicalUrl = original?.url ?? String(x.url ?? "");
      const isXUrl = (() => {
        try {
          return X_HOSTS.has(new URL(canonicalUrl).hostname.toLowerCase());
        } catch {
          return false;
        }
      })();
      const sourceType: "X" | "NEWS" = isXUrl ? "X" : "NEWS";
      const safeUrl =
        sanitizeNewsUrl(canonicalUrl, sourceType) ||
        (sourceType === "X" ? "https://x.com" : "");

      return {
        id: `${Date.now()}-${idx}`,
        source: String(original?.source ?? x.source ?? "Unknown"),
        sourceType,
        author: x.author ? String(x.author) : undefined,
        title: String(original?.title ?? x.title),
        summary: String(x.summary),
        category: validCategories.includes(x.category) ? x.category : "MARKET",
        time: String(x.time ?? "baru saja"),
        url: safeUrl,
        isInfluencer: Boolean(influencer),
        influencer,
        impact: ["HIGH", "MEDIUM", "LOW"].includes(x.impact)
          ? x.impact
          : influencer
            ? "HIGH"
            : "MEDIUM",
        sentiment: ["BULLISH", "BEARISH", "NEUTRAL"].includes(x.sentiment)
          ? x.sentiment
          : "NEUTRAL",
      } as NewsItem;
    });
}

function fallbackFromRss(articles: RssArticle[]): NewsItem[] {
  return articles.map((a, idx) => ({
    id: `rss-${Date.now()}-${idx}`,
    source: a.source,
    sourceType: "NEWS",
    title: a.title,
    summary: a.title,
    category: "MARKET" as const,
    time: relativeTime(a.pubDate),
    url: sanitizeNewsUrl(a.url, "NEWS"),
    isInfluencer: Boolean(a.influencer),
    influencer: a.influencer ?? null,
    impact: a.influencer ? ("HIGH" as const) : ("MEDIUM" as const),
    sentiment: "NEUTRAL" as const,
  }));
}

async function doRefresh(): Promise<NewsItem[]> {
  try {
    const articles = await fetchAllRss();

    if (articles.length === 0) {
      return newsCache.data;
    }

    let enriched: NewsItem[] = [];
    try {
      enriched = await withTimeout(enrichWithGemini(articles), GEMINI_TIMEOUT_MS);
    } catch {
      enriched = [];
    }
    const final = enriched.length > 0 ? enriched : fallbackFromRss(articles);

    final.sort((a, b) => {
      if (a.isInfluencer !== b.isInfluencer) return a.isInfluencer ? -1 : 1;
      const imp: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      return imp[a.impact] - imp[b.impact];
    });

    if (final.length > 0) {
      newsCache = { ts: Date.now(), data: final };
    }
    return newsCache.data;
  } finally {
    newsInflight = null;
  }
}

let warmupDone = false;
function scheduleWarmup() {
  if (warmupDone) return;
  warmupDone = true;
  setTimeout(() => {
    if (!newsInflight) {
      newsInflight = doRefresh();
      newsInflight.catch(() => undefined);
    }
  }, 2000);

  setInterval(() => {
    if (Date.now() - newsCache.ts > NEWS_TTL_MS && !newsInflight) {
      newsInflight = doRefresh();
      newsInflight.catch(() => undefined);
    }
  }, NEWS_TTL_MS);
}

router.get("/news/feed", async (req: Request, res: Response) => {
  scheduleWarmup();

  const age = Date.now() - newsCache.ts;
  const hasFresh = newsCache.data.length > 0 && age < NEWS_TTL_MS;
  const hasStale = newsCache.data.length > 0 && age < STALE_GRACE_MS;

  if (hasFresh) {
    return res.json(newsCache.data);
  }

  if (hasStale) {
    if (!newsInflight) {
      const p = doRefresh();
      newsInflight = p;
      p.catch(() => undefined);
    }
    return res.json(newsCache.data);
  }

  // Snapshot the inflight promise to a local — newsInflight gets nulled in
  // doRefresh()'s finally block, which would race with `await newsInflight`.
  if (newsInflight) {
    const inflight = newsInflight;
    try {
      const data = await inflight;
      return res.json(data);
    } catch {
      if (newsCache.data.length > 0) return res.json(newsCache.data);
      return res.status(503).json({ error: "news fetch failed" });
    }
  }

  const inflight = doRefresh();
  newsInflight = inflight;
  inflight.catch(() => undefined);
  try {
    const rssFast = await fetchAllRss();
    if (rssFast.length > 0 && newsCache.data.length === 0) {
      newsCache = { ts: Date.now() - NEWS_TTL_MS + 30000, data: fallbackFromRss(rssFast) };
      res.json(newsCache.data);
      // Background refresh is already running (`inflight`); no need to spawn
      // another one here.
      return;
    }

    const data = await inflight;
    return res.json(data);
  } catch (err: any) {
    req.log.error({ err: err?.message }, "news fetch failed");
    if (
      err?.message?.includes("429") ||
      err?.message?.toLowerCase().includes("quota")
    ) {
      return res.status(429).json({ error: "QUOTA_EXCEEDED" });
    }
    if (newsCache.data.length > 0) return res.json(newsCache.data);
    return res.status(500).json({ error: "news fetch failed" });
  }
});

export default router;
