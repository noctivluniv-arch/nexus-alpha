import { Router } from "express";

const router = Router();

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const CG_KEY = process.env.COINGECKO_API_KEY ?? "";
const cgHeaders: Record<string, string> = CG_KEY
  ? { "x-cg-demo-api-key": CG_KEY }
  : {};

// Cache 15 minutes
let cache: { ts: number; data: any[] } | null = null;
const CACHE_TTL = 15 * 60 * 1000;

// Curated altcoin list dengan kategori dan metadata
const ALTCOIN_UNIVERSE = [
  // AI & Data
  { id: "bittensor", symbol: "TAO", category: "AI", narrative: "Decentralized AI network — marketplace for machine intelligence" },
  { id: "fetch-ai", symbol: "FET", category: "AI", narrative: "AI agents for autonomous economic transactions" },
  { id: "render-token", symbol: "RNDR", category: "AI", narrative: "Decentralized GPU rendering for AI and 3D content" },
  { id: "worldcoin-wld", symbol: "WLD", category: "AI", narrative: "Digital identity + universal basic income via AI iris scan" },
  { id: "near", symbol: "NEAR", category: "AI", narrative: "AI-friendly L1 with chain abstraction and user-owned AI" },
  { id: "akash-network", symbol: "AKT", category: "AI", narrative: "Decentralized cloud compute marketplace for AI workloads" },
  { id: "grass", symbol: "GRASS", category: "AI", narrative: "Decentralized web scraping network for AI training data" },
  // Layer 1
  { id: "ethereum", symbol: "ETH", category: "L1", narrative: "The programmable blockchain — foundation of DeFi, NFT, and Web3" },
  { id: "solana", symbol: "SOL", category: "L1", narrative: "High-speed L1 — Ethereum alternative with low fees and fast finality" },
  { id: "avalanche-2", symbol: "AVAX", category: "L1", narrative: "Subnet architecture for custom blockchains and institutional adoption" },
  { id: "sui", symbol: "SUI", category: "L1", narrative: "Move-based L1 with parallel execution — built for scale" },
  { id: "aptos", symbol: "APT", category: "L1", narrative: "Move language L1 — strong developer ecosystem from ex-Meta team" },
  { id: "hyperliquid", symbol: "HYPE", category: "L1", narrative: "On-chain perp DEX with its own L1 — fastest growing derivatives platform" },
  // Layer 2
  { id: "arbitrum", symbol: "ARB", category: "L2", narrative: "Ethereum L2 with largest TVL — dominant DeFi ecosystem" },
  { id: "optimism", symbol: "OP", category: "L2", narrative: "OP Stack L2 — foundation of Superchain and Base ecosystem" },
  { id: "starknet", symbol: "STRK", category: "L2", narrative: "ZK-rollup L2 with native account abstraction and Cairo language" },
  { id: "zksync", symbol: "ZK", category: "L2", narrative: "ZK-rollup with zkEVM — Ethereum scaling with cryptographic security" },
  // DeFi
  { id: "uniswap", symbol: "UNI", category: "DeFi", narrative: "Largest DEX protocol — fee switch activation could unlock massive value" },
  { id: "aave", symbol: "AAVE", category: "DeFi", narrative: "Leading lending protocol — GHO stablecoin expanding ecosystem" },
  { id: "jupiter-exchange-solana", symbol: "JUP", category: "DeFi", narrative: "Solana's dominant DEX aggregator — key infrastructure for SOL ecosystem" },
  { id: "chainlink", symbol: "LINK", category: "DeFi", narrative: "Oracle network — critical infrastructure for all smart contracts" },
  // Privacy
  { id: "monero", symbol: "XMR", category: "Privacy", narrative: "Leading privacy coin — untraceable transactions, regulatory pressure = scarcity" },
  { id: "zcash", symbol: "ZEC", category: "Privacy", narrative: "Privacy coin with zk-SNARK technology — Ethereum-compatible roadmap" },
  // RWA & Payments
  { id: "ondo-finance", symbol: "ONDO", category: "RWA", narrative: "Tokenized US Treasuries and real-world assets — institutional DeFi bridge" },
  { id: "ripple", symbol: "XRP", category: "Payments", narrative: "Cross-border payment settlement — SEC lawsuit resolution = catalyst" },
  // Gaming & Metaverse
  { id: "immutable-x", symbol: "IMX", category: "Gaming", narrative: "NFT gaming L2 on Ethereum — largest web3 gaming ecosystem" },
  { id: "ronin", symbol: "RON", category: "Gaming", narrative: "Gaming-focused blockchain — Axie Infinity and growing game ecosystem" },
];

function scoreAltcoin(coin: any, meta: any): {
  total: number;
  fundamental: number;
  technical: number;
  narrative: number;
  marketPosition: number;
  safety: number;
  rating: "STRONG BUY" | "BUY" | "HOLD" | "AVOID";
  earlyGem: boolean;
} {
  let fundamental = 0;
  let technical = 0;
  let narrative = 0;
  let marketPosition = 0;
  let safety = 0;

  // Fundamental (30 pts)
  if (coin.developer_score > 70) fundamental += 10;
  else if (coin.developer_score > 40) fundamental += 6;
  else if (coin.developer_score > 0) fundamental += 3;

  if (coin.community_score > 70) fundamental += 8;
  else if (coin.community_score > 40) fundamental += 5;
  else if (coin.community_score > 0) fundamental += 2;

  if (coin.liquidity_score > 70) fundamental += 7;
  else if (coin.liquidity_score > 40) fundamental += 4;
  else if (coin.liquidity_score > 0) fundamental += 2;

  if (coin.public_interest_score > 0) fundamental += 5;

  // Technical (25 pts)
  const change24h = coin.market_data?.price_change_percentage_24h ?? 0;
  const change7d = coin.market_data?.price_change_percentage_7d ?? 0;
  const change30d = coin.market_data?.price_change_percentage_30d ?? 0;

  if (change24h > 5) technical += 8;
  else if (change24h > 0) technical += 5;
  else if (change24h > -5) technical += 3;

  if (change7d > 10) technical += 9;
  else if (change7d > 0) technical += 6;
  else if (change7d > -10) technical += 3;

  if (change30d > 20) technical += 8;
  else if (change30d > 0) technical += 5;
  else if (change30d > -20) technical += 2;

  // Narrative (20 pts)
  const hotCategories = ["AI", "L2", "RWA", "Gaming"];
  if (hotCategories.includes(meta.category)) narrative += 20;
  else if (meta.category === "L1") narrative += 15;
  else if (meta.category === "DeFi") narrative += 12;
  else narrative += 8;

  // Market Position (15 pts)
  const mcap = coin.market_data?.market_cap?.usd ?? 0;
  const rank = coin.market_cap_rank ?? 999;
  if (rank <= 20) marketPosition += 15;
  else if (rank <= 50) marketPosition += 12;
  else if (rank <= 100) marketPosition += 9;
  else if (rank <= 200) marketPosition += 6;
  else if (rank <= 500) marketPosition += 3;

  // Safety (10 pts)
  if (coin.coingecko_score > 70) safety += 10;
  else if (coin.coingecko_score > 50) safety += 7;
  else if (coin.coingecko_score > 30) safety += 4;
  else safety += 2;

  const total = Math.min(100, fundamental + technical + narrative + marketPosition + safety);

  let rating: "STRONG BUY" | "BUY" | "HOLD" | "AVOID" = "AVOID";
  if (total >= 75) rating = "STRONG BUY";
  else if (total >= 60) rating = "BUY";
  else if (total >= 45) rating = "HOLD";

  // Early gem: small cap + high narrative + good fundamentals
  const earlyGem = rank > 100 && total >= 55 && hotCategories.includes(meta.category);

  return { total, fundamental, technical, narrative, marketPosition, safety, rating, earlyGem };
}

async function fetchCoinData(id: string): Promise<any> {
  const url = `${COINGECKO_BASE}/coins/${id}?localization=false&tickers=false&market_data=true&community_data=true&developer_data=true`;
  const res = await fetch(url, { headers: cgHeaders });
  if (!res.ok) throw new Error(`CoinGecko error ${res.status} for ${id}`);
  return res.json();
}

router.get("/altcoins", async (req, res) => {
  try {
    if (cache && Date.now() - cache.ts < CACHE_TTL) {
      return res.json(cache.data);
    }

    // Fetch in batches of 5 to respect rate limit
    const results: any[] = [];
    const batchSize = 5;

    for (let i = 0; i < ALTCOIN_UNIVERSE.length; i += batchSize) {
      const batch = ALTCOIN_UNIVERSE.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(async (meta) => {
          try {
            const coin = await fetchCoinData(meta.id);
            const scores = scoreAltcoin(coin, meta);
            const marketData = coin.market_data ?? {};

            return {
              id: meta.id,
              symbol: meta.symbol,
              name: coin.name,
              category: meta.category,
              narrative: meta.narrative,
              image: coin.image?.small ?? "",
              price: marketData.current_price?.usd ?? 0,
              priceFormatted: `$${(marketData.current_price?.usd ?? 0).toLocaleString("en-US", { maximumFractionDigits: 6 })}`,
              change24h: marketData.price_change_percentage_24h ?? 0,
              change7d: marketData.price_change_percentage_7d ?? 0,
              change30d: marketData.price_change_percentage_30d ?? 0,
              marketCap: marketData.market_cap?.usd ?? 0,
              marketCapFormatted: (() => {
                const mc = marketData.market_cap?.usd ?? 0;
                if (mc >= 1e9) return `$${(mc/1e9).toFixed(2)}B`;
                if (mc >= 1e6) return `$${(mc/1e6).toFixed(2)}M`;
                return `$${mc.toFixed(0)}`;
              })(),
              volume24h: marketData.total_volume?.usd ?? 0,
              rank: coin.market_cap_rank ?? 999,
              ath: marketData.ath?.usd ?? 0,
              athChangePercent: marketData.ath_change_percentage?.usd ?? 0,
              scores,
              rating: scores.rating,
              earlyGem: scores.earlyGem,
              description: coin.description?.en?.split(". ")[0] ?? meta.narrative,
              links: {
                website: coin.links?.homepage?.[0] ?? "",
                twitter: coin.links?.twitter_screen_name ? `https://twitter.com/${coin.links.twitter_screen_name}` : "",
                github: coin.links?.repos_url?.github?.[0] ?? "",
              },
              developerScore: coin.developer_score ?? 0,
              communityScore: coin.community_score ?? 0,
              liquidityScore: coin.liquidity_score ?? 0,
              coingeckoScore: coin.coingecko_score ?? 0,
            };
          } catch {
            return null;
          }
        })
      );
      results.push(...batchResults.filter(r => r.status === "fulfilled" && r.value).map((r: any) => r.value));
      // Small delay between batches
      if (i + batchSize < ALTCOIN_UNIVERSE.length) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }

    // Sort by score descending
    const sorted = results
      .filter(Boolean)
      .sort((a, b) => b.scores.total - a.scores.total);

    cache = { ts: Date.now(), data: sorted };
    return res.json(sorted);
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to fetch altcoins", message: err.message });
  }
});

export default router;
