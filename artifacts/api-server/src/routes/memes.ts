import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { chartLimiter } from "../middlewares/rateLimiter";

const router: IRouter = Router();

const DS_BASE = "https://api.dexscreener.com";
const GP_BASE = "https://api.gopluslabs.io/api/v1";
const CG_BASE = "https://api.coingecko.com/api/v3";
const GT_BASE = "https://api.geckoterminal.com/api/v2";
const TTL_MS = 15 * 60 * 1000;

// Blue-chip memes already at peak adoption — exclude per "find next DOGE" intent
const BLUE_CHIP_BLACKLIST = new Set([
  "doge", "shib", "pepe", "wif", "bonk", "floki", "trump", "melania",
  "asteroid", "fartcoin", "popcat", "brett", "mog", "andy", "neiro",
  "mew", "myro", "ponke", "bome", "wen", "slerf", "chillguy",
  "pengu", "pump", "moodeng", "goat", "act", "fwog", "spx", "memecoin",
  "babydoge", "shibainu", "dogwifhat", "dogwif", "apepe",
]);

const STABLES_AND_WRAPS = new Set([
  "usdt", "usdc", "dai", "fdusd", "tusd", "busd", "usds", "usde",
  "pyusd", "frax", "lusd", "gusd", "usdp", "dola",
  "weth", "wbtc", "wbnb", "wsol", "sol", "eth", "btc", "bnb", "matic",
  "avax", "ada", "ltc", "xrp", "atom", "near", "ftm", "op", "arb",
  "wbeth", "steth", "reth", "wsteth", "cbbtc", "cbeth", "weeth", "ezeth",
  "lst", "lrt", "jitosol", "msol", "bsol", "lsteth",
]);

// GeckoTerminal network slug → GoPlus chain key
const GT_TO_GOPLUS: Record<string, string> = {
  solana: "solana",
  eth: "ethereum",
  bsc: "bsc",
  base: "base",
  polygon_pos: "polygon",
  arbitrum: "arbitrum",
  avax: "avalanche",
  optimism: "optimism",
};

// Tags marking centralized exchanges & DEX router/pool wallets — NOT smart money
const EXCHANGE_DEX_TAGS = [
  "binance", "okx", "bybit", "bitget", "kraken", "coinbase", "huobi",
  "kucoin", "gate.io", "mexc", "crypto.com", "bitfinex", "upbit",
  "uniswap", "pancakeswap", "raydium", "orca", "jupiter", "meteora",
  "sushiswap", "1inch", "curve", "balancer", "kyberswap", "matcha",
  "router", "pool", "lp ", "amm", "vault", "bridge", "cex hot",
  "cex cold", "exchange", "deployer", "pair", "fee collector",
];

interface BoostItem {
  url: string;
  chainId: string;
  tokenAddress: string;
  description?: string;
  totalAmount?: number;
  amount?: number;
}

interface DSPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken?: { symbol: string };
  priceUsd?: string;
  priceChange?: { h1?: number; h6?: number; h24?: number };
  volume?: { h24?: number; h6?: number; h1?: number };
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
    websites?: { url: string; label?: string }[];
    socials?: { url: string; type: string }[];
  };
}

let cache: { ts: number; data: any[] } = { ts: 0, data: [] };
let memesInflight: Promise<any[]> | null = null;

const TWITTER_HOSTS = new Set(["x.com", "twitter.com", "t.co", "www.x.com", "www.twitter.com"]);
const TELEGRAM_HOSTS = new Set(["t.me", "telegram.me", "www.t.me", "www.telegram.me"]);

function sanitizeSocialUrl(raw: string, kind: "twitter" | "telegram" | "website"): string {
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return "";
    const host = u.hostname.toLowerCase();
    if (kind === "twitter" && !TWITTER_HOSTS.has(host)) return "";
    if (kind === "telegram" && !TELEGRAM_HOSTS.has(host)) return "";
    return u.href;
  } catch {
    return "";
  }
}

const NETWORK_LABELS: Record<string, string> = {
  solana: "Solana",
  ethereum: "Ethereum",
  base: "Base",
  bsc: "BSC",
  arbitrum: "Arbitrum",
  polygon: "Polygon",
  avalanche: "Avalanche",
  optimism: "Optimism",
  blast: "Blast",
  sui: "Sui",
};

const GOPLUS_CHAIN_MAP: Record<string, string> = {
  ethereum: "1",
  bsc: "56",
  polygon: "137",
  base: "8453",
  arbitrum: "42161",
  avalanche: "43114",
  optimism: "10",
  blast: "81457",
};

const BURN_TAGS = new Set([
  "Burn Hole",
  "Burner Wallet",
  "Black Hole",
  "Burned",
  "Dead",
]);

const BURN_ADDRESSES = new Set([
  "0x000000000000000000000000000000000000dead",
  "0x0000000000000000000000000000000000000000",
  "11111111111111111111111111111111",
  "1nc1nerator11111111111111111111111111111111",
]);

interface LpLockInfo {
  status:
    | "BURNED"
    | "LOCKED"
    | "PARTIAL"
    | "UNLOCKED"
    | "UNKNOWN"
    | "VERIFIED_LISTING";
  lockedPercent: number;
  burnedPercent: number;
  longestLockDays: number | null;
  expiryDate: string | null;
  provider: string | null;
  summary: string;
}

interface BurnInfo {
  burnedPercent: number;
  burnedAddresses: { address: string; tag: string; percent: number }[];
  summary: string;
}

interface TopHoldersInfo {
  concentrationTop10: number;
  list: {
    address: string;
    percent: number;
    tag: string;
    isContract: boolean;
    isLocked: boolean;
  }[];
}

interface SecurityData {
  lpLockInfo: LpLockInfo;
  burnInfo: BurnInfo;
  topHolders: TopHoldersInfo;
  // True only when the security provider was reachable AND returned a
  // recognizable token record. False on any HTTP/network/parse failure.
  // Used by evaluateQuality() to fail-closed: if false, candidate is rejected
  // regardless of how good the on-pool fundamentals look — we will not
  // approve an "anti-rug" listing that we could not verify.
  providerOk: boolean;
}

function isBurnAddress(addr: string, tag: string): boolean {
  if (BURN_TAGS.has(tag)) return true;
  const lower = (addr || "").toLowerCase();
  return BURN_ADDRESSES.has(lower);
}

function describeLockProvider(tag: string): string | null {
  if (!tag) return null;
  if (/pink/i.test(tag)) return "PinkLock";
  if (/unicrypt|uncx/i.test(tag)) return "UNCX";
  if (/team\s*finance/i.test(tag)) return "Team Finance";
  if (/dxsale|dxlock/i.test(tag)) return "DxSale";
  if (/mudra/i.test(tag)) return "Mudra";
  if (/raydium/i.test(tag)) return "Raydium LP";
  if (BURN_TAGS.has(tag)) return "Burned";
  return tag.length > 0 ? tag : null;
}

function summarizeLock(info: Omit<LpLockInfo, "summary">): string {
  if (info.status === "BURNED")
    return `LP token sudah DIBAKAR ${info.burnedPercent.toFixed(1)}% (permanen, tidak bisa di-rug).`;
  if (info.status === "LOCKED") {
    const days = info.longestLockDays;
    if (days != null && days > 0) {
      const dur = days > 365 ? `${(days / 365).toFixed(1)} tahun` : `${days} hari`;
      return `LP terkunci ${info.lockedPercent.toFixed(1)}% selama ${dur}${info.provider ? ` via ${info.provider}` : ""}.`;
    }
    return `LP terkunci ${info.lockedPercent.toFixed(1)}%${info.provider ? ` via ${info.provider}` : ""}.`;
  }
  if (info.status === "PARTIAL")
    return `Hanya ${info.lockedPercent.toFixed(1)}% LP yang terkunci/dibakar — sebagian besar masih bisa diakses dev.`;
  if (info.status === "UNLOCKED")
    return "LP TIDAK dikunci — risiko rug pull tinggi.";
  if (info.status === "VERIFIED_LISTING") {
    return (
      `Listing established di CoinGecko meme-token category${info.provider ? ` (${info.provider})` : ""} ` +
      `— komunitas terverifikasi dan likuiditas tersebar di multi-DEX/CEX. ` +
      `Catatan: status LP on-chain TIDAK diverifikasi independen — selalu DYOR sebelum trading.`
    );
  }
  return "Data lock LP belum terindeks scanner — verifikasi manual via DexScreener / blockchain explorer sebelum trading.";
}

function summarizeBurn(burnedPercent: number): string {
  if (burnedPercent >= 50)
    return `${burnedPercent.toFixed(1)}% supply token dibakar (deflasi sangat kuat).`;
  if (burnedPercent >= 10)
    return `${burnedPercent.toFixed(1)}% supply token sudah dibakar — tekanan deflasi moderat.`;
  if (burnedPercent > 0)
    return `${burnedPercent.toFixed(2)}% supply dibakar — pengaruh kecil terhadap supply.`;
  return "Tidak ada mekanisme burn aktif yang terdeteksi.";
}

function emptySecurity(): SecurityData {
  return {
    lpLockInfo: {
      status: "UNKNOWN",
      lockedPercent: 0,
      burnedPercent: 0,
      longestLockDays: null,
      expiryDate: null,
      provider: null,
      summary: summarizeLock({
        status: "UNKNOWN",
        lockedPercent: 0,
        burnedPercent: 0,
        longestLockDays: null,
        expiryDate: null,
        provider: null,
      }),
    },
    burnInfo: {
      burnedPercent: 0,
      burnedAddresses: [],
      summary: summarizeBurn(0),
    },
    topHolders: { concentrationTop10: 0, list: [] },
    providerOk: false,
  };
}

function pctOf(s: unknown): number {
  const n = parseFloat(String(s ?? "0"));
  if (!isFinite(n)) return 0;
  return n <= 1 ? n * 100 : n;
}

function parseEvmSecurity(token: any): SecurityData {
  const lpHolders: any[] = Array.isArray(token?.lp_holders)
    ? token.lp_holders
    : [];
  const holders: any[] = Array.isArray(token?.holders) ? token.holders : [];

  let lockedPercent = 0;
  let burnedLpPercent = 0;
  let longestLockSec = 0;
  let provider: string | null = null;

  for (const h of lpHolders) {
    const pct = pctOf(h.percent);
    const addr = String(h.address ?? "").toLowerCase();
    const tag = String(h.tag ?? "");
    if (isBurnAddress(addr, tag)) {
      burnedLpPercent += pct;
      continue;
    }
    if (h.is_locked === 1 || h.is_locked === "1") {
      lockedPercent += pct;
      const detail = Array.isArray(h.locked_detail) ? h.locked_detail : [];
      for (const d of detail) {
        const end = parseInt(String(d.end_time ?? "0"), 10);
        const opt = parseInt(String(d.opt_time ?? "0"), 10);
        const dur = end - opt;
        if (dur > longestLockSec) longestLockSec = dur;
      }
      const desc = describeLockProvider(tag);
      if (desc && !provider) provider = desc;
    }
  }

  let lockStatus: LpLockInfo["status"] = "UNKNOWN";
  const totalSecure = burnedLpPercent + lockedPercent;
  if (burnedLpPercent >= 80) lockStatus = "BURNED";
  else if (lockedPercent >= 80) lockStatus = "LOCKED";
  else if (totalSecure >= 80)
    lockStatus = burnedLpPercent > lockedPercent ? "BURNED" : "LOCKED";
  else if (totalSecure >= 20) lockStatus = "PARTIAL";
  else if (lpHolders.length > 0) lockStatus = "UNLOCKED";

  const longestLockDays =
    longestLockSec > 0 ? Math.floor(longestLockSec / 86400) : null;
  const expiryDate =
    longestLockSec > 0
      ? new Date((Date.now() / 1000 + longestLockSec) * 1000).toISOString()
      : null;

  const lpInfo: LpLockInfo = {
    status: lockStatus,
    lockedPercent,
    burnedPercent: burnedLpPercent,
    longestLockDays,
    expiryDate,
    provider: provider ?? (lockStatus === "BURNED" ? "Burned" : null),
    summary: "",
  };
  lpInfo.summary = summarizeLock(lpInfo);

  let totalBurned = 0;
  const burnedAddresses: BurnInfo["burnedAddresses"] = [];
  for (const h of holders) {
    const addr = String(h.address ?? "").toLowerCase();
    const tag = String(h.tag ?? "");
    const pct = pctOf(h.percent);
    if (isBurnAddress(addr, tag)) {
      totalBurned += pct;
      burnedAddresses.push({
        address: h.address ?? addr,
        tag: tag || "Dead Address",
        percent: pct,
      });
    }
  }
  const burnInfo: BurnInfo = {
    burnedPercent: totalBurned,
    burnedAddresses,
    summary: summarizeBurn(totalBurned),
  };

  const topHoldersList: TopHoldersInfo["list"] = holders
    .filter((h) => {
      const addr = String(h.address ?? "").toLowerCase();
      const tag = String(h.tag ?? "");
      return !isBurnAddress(addr, tag);
    })
    .slice(0, 10)
    .map((h) => ({
      address: String(h.address ?? ""),
      percent: pctOf(h.percent),
      tag: String(h.tag ?? ""),
      isContract: h.is_contract === 1 || h.is_contract === "1",
      isLocked: h.is_locked === 1 || h.is_locked === "1",
    }));
  const concentrationTop10 = topHoldersList.reduce(
    (s, h) => s + h.percent,
    0,
  );

  return {
    lpLockInfo: lpInfo,
    burnInfo,
    topHolders: { concentrationTop10, list: topHoldersList },
    providerOk: true,
  };
}

function parseSolanaSecurity(token: any): SecurityData {
  const lpHolders: any[] = Array.isArray(token?.lp_holders)
    ? token.lp_holders
    : [];
  const holders: any[] = Array.isArray(token?.holders) ? token.holders : [];
  const dex: any[] = Array.isArray(token?.dex) ? token.dex : [];

  let burnedLpPercent = 0;
  let lockedPercent = 0;
  let provider: string | null = null;

  // Prefer the largest-liquidity pool to avoid being misled by a small
  // 100%-burned side pool while the main trading pool has unlocked LP.
  if (dex.length > 0) {
    const sorted = [...dex].sort(
      (a, b) => parseFloat(String(b.tvl ?? "0")) - parseFloat(String(a.tvl ?? "0")),
    );
    const main = sorted[0];
    burnedLpPercent = pctOf(main.burn_percent ?? main.burn_ratio);
    if (burnedLpPercent > 0) {
      const t = String(main.type ?? "");
      if (t) provider = `${t} (LP burned)`;
    }
  }

  for (const h of lpHolders) {
    const pct = pctOf(h.percent);
    const tag = String(h.tag ?? "");
    if (BURN_TAGS.has(tag)) {
      if (pct > burnedLpPercent) burnedLpPercent = pct;
      continue;
    }
    if (h.is_locked === 1 || h.is_locked === "1") {
      lockedPercent += pct;
      if (!provider) provider = describeLockProvider(tag) ?? "Locked";
    }
  }

  let status: LpLockInfo["status"] = "UNKNOWN";
  if (burnedLpPercent >= 80) status = "BURNED";
  else if (lockedPercent >= 80) status = "LOCKED";
  else if (burnedLpPercent + lockedPercent >= 20) status = "PARTIAL";
  else if (lpHolders.length > 0 || dex.length > 0) status = "UNLOCKED";

  const lpInfo: LpLockInfo = {
    status,
    lockedPercent,
    burnedPercent: burnedLpPercent,
    longestLockDays: null,
    expiryDate: status === "BURNED" ? "PERMANENT" : null,
    provider,
    summary: "",
  };
  lpInfo.summary = summarizeLock(lpInfo);

  const topHoldersList: TopHoldersInfo["list"] = holders
    .filter((h) => {
      const addr = String(h.account ?? h.address ?? "").toLowerCase();
      const tag = String(h.tag ?? "");
      return !isBurnAddress(addr, tag);
    })
    .slice(0, 10)
    .map((h) => ({
      address: String(h.account ?? h.address ?? ""),
      percent: pctOf(h.percent),
      tag: String(h.tag ?? ""),
      isContract: false,
      isLocked: h.is_locked === 1 || h.is_locked === "1",
    }));
  const concentrationTop10 = topHoldersList.reduce(
    (s, h) => s + h.percent,
    0,
  );

  return {
    lpLockInfo: lpInfo,
    burnInfo: { burnedPercent: 0, burnedAddresses: [], summary: summarizeBurn(0) },
    topHolders: { concentrationTop10, list: topHoldersList },
    providerOk: true,
  };
}

// Note: this file imports Express's `Response`, which shadows the DOM/global
// `Response`. We therefore intentionally leave the return type inferred so the
// global fetch `Response` type is used.
// Returns parsed GoPlus JSON (or null on hard failure) and the HTTP status.
// GoPlus signals rate limiting in TWO ways:
//   1) HTTP 429 (rare for the public free tier)
//   2) HTTP 200 with body { code: 4029, message: "too many requests" } and
//      no `result` payload. The previous version of this function only
//      retried on (1), so most rate-limited tokens silently became "empty".
// We now read the body, treat both signals as retryable, and use larger
// backoffs (1.2s / 2.4s / 4.8s) so the public-tier limiter has time to
// recover between attempts.
type GpResult = {
  ok: boolean;
  status: number;
  json: { code?: number; message?: string; result?: Record<string, any> } | null;
};
async function gpFetchWithRetry(url: string, attempts = 4): Promise<GpResult> {
  let last: GpResult = { ok: false, status: 0, json: null };
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      let json: GpResult["json"] = null;
      try {
        json = (await r.json()) as GpResult["json"];
      } catch {
        json = null;
      }
      // Normalize code via Number() — GoPlus has been observed to return both
      // numeric (4029) and string ("4029") body codes across tiers/endpoints.
      // Strict `=== 4029` would silently miss the string case and reintroduce
      // the original "treat throttle as success" bug.
      const codeRaw = json?.code;
      const codeNum = codeRaw === undefined || codeRaw === null ? NaN : Number(codeRaw);
      const rateLimited = r.status === 429 || codeNum === 4029;
      const transientServer = r.status >= 500;
      const success =
        r.ok && !rateLimited && Number.isFinite(codeNum) && codeNum !== 4029;
      last = { ok: success, status: r.status, json };
      if (success) return last;
      // Retry only on rate-limit or 5xx.
      if (!rateLimited && !transientServer) return last;
      if (i < attempts - 1) {
        const backoff = 1200 * Math.pow(2, i) + Math.floor(Math.random() * 400);
        await new Promise((res) => setTimeout(res, backoff));
      }
    } catch {
      if (i < attempts - 1) {
        const backoff = 1200 * Math.pow(2, i) + Math.floor(Math.random() * 400);
        await new Promise((res) => setTimeout(res, backoff));
      }
    }
  }
  return last;
}

// Per-token GoPlus security fetch. The public free tier silently ignores
// multi-address `contract_addresses=a,b,c` lists and only returns the first
// address, so batching is not viable — we must call once per token. Combined
// with low caller-side concurrency and the rate-limit-aware retry in
// gpFetchWithRetry, this keeps coverage high without breaching the limiter.
async function fetchGoPlusSecurity(
  chainId: string,
  address: string,
): Promise<SecurityData> {
  try {
    if (chainId === "solana") {
      const r = await gpFetchWithRetry(
        `${GP_BASE}/solana/token_security?contract_addresses=${address}`,
      );
      if (!r.ok || !r.json) {
        logger.warn(
          { chainId, address, status: r.status, code: r.json?.code },
          "GoPlus solana fetch failed",
        );
        return emptySecurity();
      }
      const result = r.json.result ?? {};
      const token = result[address] ?? Object.values(result)[0];
      if (!token) return emptySecurity();
      return parseSolanaSecurity(token);
    }
    const gpId = GOPLUS_CHAIN_MAP[chainId];
    if (!gpId) return emptySecurity();
    const r = await gpFetchWithRetry(
      `${GP_BASE}/token_security/${gpId}?contract_addresses=${address}`,
    );
    if (!r.ok || !r.json) {
      logger.warn(
        { chainId, gpId, address, status: r.status, code: r.json?.code },
        "GoPlus EVM fetch failed",
      );
      return emptySecurity();
    }
    const result = r.json.result ?? {};
    const lower = address.toLowerCase();
    const token = result[lower] ?? result[address] ?? Object.values(result)[0];
    if (!token) return emptySecurity();
    return parseEvmSecurity(token);
  } catch (err: any) {
    logger.warn(
      { chainId, address, err: err?.message ?? String(err) },
      "GoPlus fetch threw",
    );
    return emptySecurity();
  }
}

function detectInfluencer(
  text: string,
): "TRUMP" | "ELON" | "BOTH" | "NONE" {
  const t = text.toLowerCase();
  const trump = /trump|maga|don[ -]?jr|melania|barron/.test(t);
  const elon = /\belon\b|musk|doge(?!coin only)|shibe?|\bx[ -]?ai\b|grok|tesla|spacex/.test(t);
  if (trump && elon) return "BOTH";
  if (trump) return "TRUMP";
  if (elon) return "ELON";
  return "NONE";
}

const ICONIC_MEME_PATTERNS =
  /\b(doge|shib|shiba|pepe|floki|bonk|wif|popcat|mog|brett|trump|maga|elon|musk|grok|harry|barron|melania|moodeng|peanut|fartcoin|chillguy)\b/i;

function isIconicMeme(name: string, symbol: string, desc: string): boolean {
  return ICONIC_MEME_PATTERNS.test(`${name} ${symbol} ${desc}`);
}

interface QualityCheck {
  tier: "VERIFIED" | "WATCHLIST" | "REJECTED";
  passes: boolean;
  rejectReasons: string[];
  warnings: string[];
  qualityScore: number;
}

function evaluateQuality(args: {
  liqUsd: number;
  ageDays: number;
  marketCap: number;
  vol24h: number;
  change24h: number;
  lp: LpLockInfo;
  topHolders: TopHoldersInfo;
  burn: BurnInfo;
  providerOk: boolean;
  influencer: "TRUMP" | "ELON" | "BOTH" | "NONE";
  iconic: boolean;
}): QualityCheck {
  const {
    liqUsd,
    ageDays,
    marketCap,
    vol24h,
    change24h,
    lp,
    topHolders,
    burn,
    providerOk,
    influencer,
    iconic,
  } = args;

  // 2-TIER MODEL:
  //   VERIFIED  = passes all original strict anti-rug checks (green badge)
  //   WATCHLIST = passes the absolute-rug filters but fails one or more
  //               soft checks (yellow badge, warnings shown to user)
  //   REJECTED  = trips a hard-rug filter and is dropped entirely
  //
  // HARD-REJECT bucket (clear rug / fake / dead signals — never show):
  //   - LP_UNLOCKED            (instant rug)
  //   - LIQUIDITY_TOO_THIN     (< $50k LP)
  //   - TOO_NEW                (< 3 days old)
  //   - NO_REAL_VOLUME         (< $5k 24h vol)
  //   - EXTREME_VOLATILITY     (>400% 24h move = manipulation)
  //   - MCAP_LIQ_MISMATCH      (honeypot signal)
  //   - WHALE_CONCENTRATION_EXTREME (top10 ≥ 95%)
  //   - SINGLE_HOLDER_EXTREME  (single non-burn holder > 50%)
  //
  // SOFT (downgrade-to-WATCHLIST) bucket — surfaces with warnings:
  //   - SECURITY_UNVERIFIABLE  (GoPlus had no data on this token)
  //   - LP_UNVERIFIED          (status UNKNOWN without circumstantial proof)
  //   - LP_LOCK_INSUFFICIENT   (PARTIAL lock < 60%)
  //   - WHALE_CONCENTRATION    (top10 80–95%)
  //   - SINGLE_HOLDER_DOMINANT (biggest non-burn holder 35–50%)
  const reject: string[] = [];
  const warnings: string[] = [];

  // --- HARD: liquidity / freshness / volume / mcap sanity ---
  if (liqUsd < 50_000) reject.push("LIQUIDITY_TOO_THIN");
  if (ageDays < 3) reject.push("TOO_NEW");
  if (vol24h < 5_000) reject.push("NO_REAL_VOLUME");
  if (Math.abs(change24h) > 400) reject.push("EXTREME_VOLATILITY");
  if (marketCap > 0 && marketCap < liqUsd * 0.3) reject.push("MCAP_LIQ_MISMATCH");

  // --- HARD: LP unlocked = instant rug ---
  if (lp.status === "UNLOCKED") reject.push("LP_UNLOCKED");

  // --- HARD: single holder >50% or top10 ≥95% (extreme rug risk) ---
  const biggestHolder = topHolders.list[0]?.percent ?? 0;
  if (biggestHolder > 50) reject.push("SINGLE_HOLDER_EXTREME");
  if (topHolders.concentrationTop10 >= 95) reject.push("WHALE_CONCENTRATION_EXTREME");

  // --- SOFT: provider unreachable → WATCHLIST with warning ---
  if (!providerOk) warnings.push("SECURITY_UNVERIFIABLE");

  // --- SOFT: LP UNKNOWN without circumstantial proof → WATCHLIST ---
  if (providerOk && lp.status === "UNKNOWN") {
    const volLiqRatio = liqUsd > 0 ? vol24h / liqUsd : 0;
    const circumstantialOk =
      liqUsd >= 250_000 &&
      ageDays >= 14 &&
      volLiqRatio >= 0.1 &&
      volLiqRatio <= 10;
    if (!circumstantialOk) warnings.push("LP_UNVERIFIED");
  }
  // PARTIAL lock < 60% combined → WATCHLIST
  if (lp.status === "PARTIAL" && lp.lockedPercent + lp.burnedPercent < 60)
    warnings.push("LP_LOCK_INSUFFICIENT");

  // --- SOFT: whale / single-holder concentration in the warning band ---
  if (topHolders.concentrationTop10 >= 80 && topHolders.concentrationTop10 < 95)
    warnings.push("WHALE_CONCENTRATION");
  if (biggestHolder > 35 && biggestHolder <= 50)
    warnings.push("SINGLE_HOLDER_DOMINANT");

  // === QUALITY SCORE — re-rank survivors (higher = more legit & potential) ===
  let q = 0;

  // Lock quality (40 pts max) — burned > long-locked > short-locked
  if (lp.status === "BURNED") q += 40;
  else if (lp.status === "LOCKED") {
    const days = lp.longestLockDays ?? 0;
    if (days >= 365) q += 38;
    else if (days >= 180) q += 32;
    else if (days >= 90) q += 25;
    else if (days >= 30) q += 18;
    else q += 12;
  } else if (lp.status === "PARTIAL") q += 5;

  // Distribution health (20 pts max)
  const conc = topHolders.concentrationTop10;
  if (conc > 0 && conc < 20) q += 20;
  else if (conc < 30) q += 15;
  else if (conc < 40) q += 10;
  else if (conc < 50) q += 5;

  // Liquidity depth (15 pts max)
  if (liqUsd > 5_000_000) q += 15;
  else if (liqUsd > 1_000_000) q += 12;
  else if (liqUsd > 250_000) q += 8;
  else if (liqUsd > 100_000) q += 5;

  // Age / battle-tested (15 pts max) — survived early dump = legit community
  if (ageDays > 365) q += 15;
  else if (ageDays > 90) q += 12;
  else if (ageDays > 30) q += 8;
  else if (ageDays > 14) q += 4;

  // Volume / community engagement (10 pts max)
  const volLiq = liqUsd > 0 ? vol24h / liqUsd : 0;
  if (volLiq >= 0.5 && volLiq <= 8) q += 10;
  else if (volLiq >= 0.2) q += 6;
  else if (volLiq > 0) q += 2;

  // Influencer / viral theme bonus (15 pts max) — DOGE/SHIB/PEPE/TRUMP playbook
  if (influencer === "BOTH") q += 15;
  else if (influencer === "TRUMP" || influencer === "ELON") q += 10;
  if (iconic) q += 8;

  // Burn deflation bonus (5 pts max)
  if (burn.burnedPercent > 20) q += 5;
  else if (burn.burnedPercent > 5) q += 3;

  let tier: "VERIFIED" | "WATCHLIST" | "REJECTED";
  if (reject.length > 0) tier = "REJECTED";
  else if (warnings.length > 0) tier = "WATCHLIST";
  else tier = "VERIFIED";

  // Watchlist tokens score lower than verified (visual ranking signal).
  let score = q;
  if (tier === "WATCHLIST") score = Math.max(0, score - 15 - warnings.length * 3);

  return {
    tier,
    passes: tier !== "REJECTED",
    rejectReasons: reject,
    warnings,
    qualityScore: Math.min(100, score),
  };
}

function influencerReasonFor(
  who: "TRUMP" | "ELON" | "BOTH" | "NONE",
  name: string,
): string {
  if (who === "TRUMP")
    return `Token "${name}" punya tema/keterkaitan dengan brand Donald Trump (MAGA / Trump 47).`;
  if (who === "ELON")
    return `Token "${name}" terhubung dengan ekosistem Elon Musk (Doge/X/Tesla/Grok/SpaceX).`;
  if (who === "BOTH")
    return `Token "${name}" memuat referensi ke Trump dan Elon Musk sekaligus.`;
  return "";
}

function formatNumber(n: number, d = 2): string {
  if (!isFinite(n)) return "0";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: d,
  });
}

function classifyRisk(
  liqUsd: number,
  ageDays: number,
  change24h: number,
  lpStatus: LpLockInfo["status"],
): "LOW" | "MEDIUM" | "HIGH" | "EXTREME" {
  if (lpStatus === "UNLOCKED") return "EXTREME";
  // VERIFIED_LISTING = top-mcap meme listed on CoinGecko meme-token category;
  // bypass low-liq/age heuristics (liqUsd here is just 24h volume proxy).
  if (lpStatus === "VERIFIED_LISTING") {
    if (Math.abs(change24h) > 200) return "HIGH";
    if (Math.abs(change24h) > 80) return "MEDIUM";
    return "LOW";
  }
  if (liqUsd < 20_000 || ageDays < 1 || Math.abs(change24h) > 200)
    return "EXTREME";
  if (liqUsd < 100_000 || ageDays < 7 || lpStatus === "PARTIAL") return "HIGH";
  if (liqUsd < 500_000 || ageDays < 30) return "MEDIUM";
  return "LOW";
}

function securityScoreFrom(
  liqUsd: number,
  ageDays: number,
  vol24h: number,
  marketCap: number,
  lp: LpLockInfo,
  topConcentration: number,
): number {
  let s = 0;
  if (liqUsd > 1_000_000) s += 20;
  else if (liqUsd > 250_000) s += 15;
  else if (liqUsd > 50_000) s += 10;
  else if (liqUsd > 10_000) s += 4;

  if (ageDays > 365) s += 15;
  else if (ageDays > 90) s += 12;
  else if (ageDays > 30) s += 8;
  else if (ageDays > 7) s += 4;

  const volMcRatio = marketCap > 0 ? vol24h / marketCap : 0;
  if (volMcRatio > 0.1 && volMcRatio < 5) s += 15;
  else if (volMcRatio > 0 && volMcRatio < 10) s += 8;

  if (marketCap > 10_000_000) s += 10;
  else if (marketCap > 1_000_000) s += 7;
  else if (marketCap > 100_000) s += 3;

  if (lp.status === "BURNED") s += 25;
  else if (lp.status === "LOCKED") s += 20;
  else if (lp.status === "PARTIAL") s += 8;
  else if (lp.status === "UNLOCKED") s -= 15;

  if (topConcentration > 0 && topConcentration < 20) s += 10;
  else if (topConcentration < 40) s += 5;
  else if (topConcentration > 70) s -= 10;

  return Math.min(100, Math.max(0, s));
}

function sentimentFrom(
  change24h: number,
): "BULLISH" | "HYPER" | "NEUTRAL" {
  if (change24h >= 50) return "HYPER";
  if (change24h >= 5) return "BULLISH";
  return "NEUTRAL";
}

interface MemeReco {
  action: "BUY" | "SELL" | "HOLD" | "NO_TRADE";
  entryPrice: string;
  takeProfit: string;
  stopLoss: string;
  timeframe: string;
  analysis: string;
  confidence: number;
  riskReward: string;
  traderStyle: string;
  expertMindset: string;
  confluences: string[];
  noTradeReason?: string;
  scoreBreakdown: {
    liquidity: number;
    age: number;
    momentum: number;
    volume: number;
    security: number;
    holders: number;
    marketCap: number;
    total: number;
  };
}

function recommendation(
  price: number,
  change1h: number,
  change6h: number,
  change24h: number,
  vol24h: number,
  liqUsd: number,
  ageDays: number,
  marketCap: number,
  lp: LpLockInfo,
  burn: BurnInfo,
  topHolders: TopHoldersInfo,
): MemeReco {
  // === LAYER 1: SCORE EACH FACTOR (mirror of Signals confluence model) ===
  const score = {
    liquidity: 0,
    age: 0,
    momentum: 0,
    volume: 0,
    security: 0,
    holders: 0,
    marketCap: 0,
    total: 0,
  };

  if (liqUsd > 1_000_000) score.liquidity = 15;
  else if (liqUsd > 250_000) score.liquidity = 12;
  else if (liqUsd > 50_000) score.liquidity = 8;
  else if (liqUsd > 10_000) score.liquidity = 3;

  if (ageDays > 90) score.age = 10;
  else if (ageDays > 30) score.age = 7;
  else if (ageDays > 7) score.age = 4;
  else if (ageDays >= 1) score.age = 2;

  const allUp = change1h > 0 && change6h > 0 && change24h > 0;
  const allDown = change1h < 0 && change6h < 0 && change24h < 0;
  const cooling = change24h > 50 && change1h < 0;
  const reversal = change24h < -30 && change1h > 0 && change6h > 0;

  if (allUp && change24h > 5 && change24h < 50) score.momentum = 20;
  else if (reversal) score.momentum = 16;
  else if (allUp) score.momentum = 12;
  else if (allDown) score.momentum = 5;
  else score.momentum = 8;

  const volLiqRatio = liqUsd > 0 ? vol24h / liqUsd : 0;
  if (volLiqRatio >= 1 && volLiqRatio <= 10) score.volume = 15;
  else if (volLiqRatio >= 0.5) score.volume = 10;
  else if (volLiqRatio >= 0.2) score.volume = 6;
  else if (volLiqRatio > 0) score.volume = 2;

  if (lp.status === "BURNED") score.security = 20;
  else if (lp.status === "LOCKED") score.security = 17;
  else if (lp.status === "PARTIAL") score.security = 8;
  else if (lp.status === "UNKNOWN") score.security = 6;
  // UNLOCKED = 0

  const conc = topHolders.concentrationTop10;
  if (conc === 0) score.holders = 5; // unknown = neutral
  else if (conc < 25) score.holders = 10;
  else if (conc < 40) score.holders = 7;
  else if (conc < 55) score.holders = 4;
  else if (conc < 70) score.holders = 2;
  // >=70 = 0

  if (marketCap > 10_000_000) score.marketCap = 10;
  else if (marketCap > 1_000_000) score.marketCap = 7;
  else if (marketCap > 100_000) score.marketCap = 4;
  else if (marketCap > 10_000) score.marketCap = 2;

  score.total =
    score.liquidity +
    score.age +
    score.momentum +
    score.volume +
    score.security +
    score.holders +
    score.marketCap;

  // === LAYER 2: AUTO-REJECT (NO_TRADE) ===
  const noTradeReasons: string[] = [];
  if (lp.status === "UNLOCKED")
    noTradeReasons.push("LP tidak dikunci — risiko rug pull tinggi");
  if (conc >= 70)
    noTradeReasons.push(`Top 10 holder kontrol ${conc.toFixed(0)}% supply`);
  if (liqUsd < 10_000)
    noTradeReasons.push(`Likuiditas terlalu tipis ($${formatNumber(liqUsd, 0)})`);
  if (Math.abs(change24h) > 300)
    noTradeReasons.push(`Volatilitas ekstrem (${change24h.toFixed(0)}% 24H)`);
  if (score.total < 35)
    noTradeReasons.push(`Skor confluence rendah (${score.total}/100)`);

  const tf = ageDays < 3 ? "15M" : ageDays < 14 ? "1H" : ageDays < 60 ? "4H" : "1D";

  if (noTradeReasons.length > 0) {
    return {
      action: "NO_TRADE",
      entryPrice: price.toPrecision(4),
      takeProfit: "—",
      stopLoss: "—",
      timeframe: tf,
      analysis:
        "WAIT — kondisi tidak memenuhi syarat minimum. Sabar lebih bernilai daripada loss.",
      confidence: score.total,
      riskReward: "—",
      traderStyle: "Capital Preservation",
      expertMindset:
        "Trader profesional tahu kapan TIDAK trade. Missed trade = $0 loss. Bad trade = bisa kehilangan semua.",
      confluences: noTradeReasons,
      noTradeReason: noTradeReasons.join("; "),
      scoreBreakdown: score,
    };
  }

  // === LAYER 3: DETERMINE ACTION + STYLE ===
  let action: "BUY" | "SELL" | "HOLD" = "HOLD";
  let traderStyle = "Range Observer (no clear bias)";

  if (change24h > 100 || cooling) {
    action = "SELL";
    traderStyle = "Wyckoff Phase E — Distribution Top";
  } else if (allUp && change24h >= 5 && change24h <= 50 && score.total >= 50) {
    action = "BUY";
    traderStyle = "Wyckoff Phase D — Markup Breakout";
  } else if (reversal && score.total >= 45) {
    action = "BUY";
    traderStyle = "Wyckoff Spring — Oversold Reversal";
  } else if (allUp && score.total >= 55) {
    action = "BUY";
    traderStyle = "ICT Order Block + Volume Confirmation";
  } else if (allDown) {
    action = "HOLD";
    traderStyle = "Wyckoff Phase B/A — Accumulation Watch";
  }

  // === LAYER 4: TP/SL with R:R ===
  const slPct = action === "BUY" ? 0.18 : action === "SELL" ? 0.18 : 0.12;
  let tpMul: number;
  let slMul: number;
  if (action === "BUY") {
    tpMul = 1.45; // +45% target
    slMul = 1 - slPct; // -18%
  } else if (action === "SELL") {
    tpMul = 0.78; // -22% target (short)
    slMul = 1 + slPct; // +18%
  } else {
    tpMul = 1.15;
    slMul = 1 - slPct;
  }

  const tp = price * tpMul;
  const sl = price * slMul;
  const reward = Math.abs(tp - price);
  const risk = Math.abs(price - sl);
  const rr = risk > 0 ? (reward / risk).toFixed(1) : "—";

  // === LAYER 5: CONFLUENCES (specific observations with values) ===
  const confluences: string[] = [];
  if (allUp)
    confluences.push(`Momentum HH/HL aktif (1H +${change1h.toFixed(1)}%, 6H +${change6h.toFixed(1)}%, 24H +${change24h.toFixed(1)}%)`);
  else if (allDown)
    confluences.push(`Momentum LH/LL (1H ${change1h.toFixed(1)}%, 6H ${change6h.toFixed(1)}%, 24H ${change24h.toFixed(1)}%)`);
  else if (reversal)
    confluences.push(`Spring setup: 24H ${change24h.toFixed(1)}% lalu reversal (1H +${change1h.toFixed(1)}%)`);
  else
    confluences.push(`Mixed momentum (1H ${change1h.toFixed(1)}%, 6H ${change6h.toFixed(1)}%, 24H ${change24h.toFixed(1)}%)`);

  if (volLiqRatio >= 1)
    confluences.push(`Volume ${volLiqRatio.toFixed(1)}x liquidity (high participation)`);
  else if (volLiqRatio >= 0.3)
    confluences.push(`Volume sehat (${volLiqRatio.toFixed(2)}x liq)`);
  else
    confluences.push(`Volume tipis (${volLiqRatio.toFixed(2)}x liq) — slippage risk`);

  if (lp.status === "BURNED")
    confluences.push(`LP burned permanent (${lp.burnedPercent.toFixed(0)}% — no rug)`);
  else if (lp.status === "LOCKED")
    confluences.push(
      `LP locked${lp.longestLockDays ? ` ${lp.longestLockDays}d` : ""}${lp.provider ? ` via ${lp.provider}` : ""}`,
    );
  else if (lp.status === "PARTIAL")
    confluences.push(`LP partial lock (${lp.lockedPercent.toFixed(0)}%)`);

  if (conc > 0 && conc < 30)
    confluences.push(`Top 10 distribusi sehat (${conc.toFixed(0)}%)`);
  else if (conc >= 40)
    confluences.push(`⚠ Konsentrasi tinggi (top 10 = ${conc.toFixed(0)}%)`);

  if (burn.burnedPercent > 5)
    confluences.push(`${burn.burnedPercent.toFixed(1)}% supply dibakar (deflasi)`);

  if (ageDays > 30)
    confluences.push(`Token mature (${ageDays}d age, survived early dump)`);
  else if (ageDays < 3)
    confluences.push(`⚠ Token sangat baru (${ageDays}d) — high uncertainty`);

  if (marketCap > 10_000_000)
    confluences.push(`Mid-cap meme ($${formatNumber(marketCap, 0)} mcap)`);
  else if (marketCap < 100_000)
    confluences.push(`Micro-cap ($${formatNumber(marketCap, 0)}) — pump potential tinggi tapi exit risk`);

  // === LAYER 6: ANALYSIS NARRATIVE ===
  const headline =
    action === "BUY"
      ? `${traderStyle} setup, confidence ${score.total}/100`
      : action === "SELL"
        ? `${traderStyle} — take profit zone, confidence ${score.total}/100`
        : `${traderStyle} — no clear edge (${score.total}/100)`;

  const rrLine = action !== "HOLD" ? `R:R 1:${rr} (TP ${tpMul > 1 ? "+" : ""}${((tpMul - 1) * 100).toFixed(0)}% / SL ${slMul < 1 ? "" : "+"}${((slMul - 1) * 100).toFixed(0)}%)` : "";

  const analysis = [
    headline,
    confluences.slice(0, 3).join("; "),
    rrLine,
  ]
    .filter(Boolean)
    .join(". ") + ".";

  // === LAYER 7: EXPERT MINDSET ===
  const expertMindset =
    action === "BUY"
      ? "Position size kecil — meme adalah asymmetric bet. SL ketat non-negotiable. Jangan averaging down."
      : action === "SELL"
        ? "Take profit di greed extreme. Memes capitulate cepat — exit before others panic."
        : "Tidak ada edge yang jelas. Tunggu setup yang memenuhi minimum 3 confluence factor.";

  return {
    action,
    entryPrice: price.toPrecision(4),
    takeProfit: tp.toPrecision(4),
    stopLoss: sl.toPrecision(4),
    timeframe: tf,
    analysis,
    confidence: score.total,
    riskReward: action !== "HOLD" ? `1:${rr}` : "—",
    traderStyle,
    expertMindset,
    confluences,
    scoreBreakdown: score,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// NEW INDICATORS: Viral, Organic Community, Manipulation-Free 30 Days
// ══════════════════════════════════════════════════════════════════════════════

interface ViralResult {
  score: number;
  label: "VIRAL" | "TRENDING" | "QUIET";
  signals: string[];
}

function calcViralScore(p: {
  fromTrending: boolean;
  change1h: number;
  change6h: number;
  change24h: number;
  vol24h: number;
  vol1h: number;
  vol6h: number;
  liqUsd: number;
  txBuys: number;
  txSells: number;
}): ViralResult {
  let score = 0;
  const signals: string[] = [];

  // In GeckoTerminal's trending list = confirmed hot
  if (p.fromTrending) {
    score += 25;
    signals.push("Masuk daftar trending GeckoTerminal saat ini");
  }

  // All-timeframe positive momentum
  if (p.change1h > 0 && p.change6h > 0 && p.change24h > 5) {
    score += 20;
    signals.push(`Momentum naik semua timeframe (+${p.change24h.toFixed(1)}% 24J, +${p.change6h.toFixed(1)}% 6J, +${p.change1h.toFixed(1)}% 1J)`);
  } else if (p.change1h > 0 && p.change24h > 0) {
    score += 10;
    signals.push(`Momentum positif: +${p.change24h.toFixed(1)}% 24J`);
  }

  // Volume vs liquidity — high ratio = high interest
  const volLiq = p.liqUsd > 0 ? p.vol24h / p.liqUsd : 0;
  if (volLiq > 5) {
    score += 20;
    signals.push(`Volume $${formatNumber(p.vol24h, 0)} = ${volLiq.toFixed(1)}x ukuran pool — sangat aktif`);
  } else if (volLiq > 2) {
    score += 12;
    signals.push(`Volume aktif: ${volLiq.toFixed(1)}x likuiditas`);
  } else if (volLiq > 0.5) {
    score += 5;
  }

  // Volume acceleration in last 1h vs 24h average
  if (p.vol1h > 0 && p.vol24h > 0) {
    const avgHourly = p.vol24h / 24;
    const accel = avgHourly > 0 ? p.vol1h / avgHourly : 0;
    if (accel > 4) {
      score += 20;
      signals.push(`Volume 1J = ${accel.toFixed(1)}x rata-rata per jam — VIRAL sekarang!`);
    } else if (accel > 2) {
      score += 10;
      signals.push(`Volume 1J meningkat ${accel.toFixed(1)}x dari rata-rata`);
    }
  }

  // Buy pressure (buys > sells = organic demand, not panic selling)
  if (p.txBuys > 0 || p.txSells > 0) {
    const total = p.txBuys + p.txSells;
    const buyRatio = total > 0 ? p.txBuys / total : 0;
    if (buyRatio > 0.65) {
      score += 15;
      signals.push(`${(buyRatio * 100).toFixed(0)}% transaksi adalah BUY — banyak yang masuk`);
    } else if (buyRatio > 0.5) {
      score += 8;
    }
  }

  const label: ViralResult["label"] =
    score >= 65 ? "VIRAL" : score >= 35 ? "TRENDING" : "QUIET";
  return { score: Math.min(100, score), label, signals };
}

interface OrganicResult {
  score: number;
  label: "ORGANIK" | "MODERAT" | "KURANG";
  signals: string[];
}

function calcOrganicScore(p: {
  concentrationTop10: number;
  ageDays: number;
  vol24h: number;
  vol6h: number;
  liqUsd: number;
  smartWalletsCount: number;
  hasTwitter: boolean;
  hasTelegram: boolean;
  influencer: string;
  txBuyers: number;
  txSellers: number;
}): OrganicResult {
  let score = 0;
  const signals: string[] = [];

  // Holder distribution — lower concentration = more organic community
  const conc = p.concentrationTop10;
  if (conc < 20) {
    score += 25;
    signals.push(`Top 10 holder hanya ${conc.toFixed(1)}% supply — distribusi sangat merata`);
  } else if (conc < 35) {
    score += 18;
    signals.push(`Top 10 holder ${conc.toFixed(1)}% supply — distribusi cukup baik`);
  } else if (conc < 50) {
    score += 10;
    signals.push(`Top 10 holder ${conc.toFixed(1)}% supply`);
  } else {
    signals.push(`Peringatan: Top 10 holder ${conc.toFixed(1)}% supply — terkonsentrasi tinggi`);
  }

  // Volume consistency across timeframes (organic = steady, not one burst)
  if (p.vol24h > 0 && p.vol6h > 0) {
    const projected6h = p.vol6h * 4;
    const consistency =
      Math.min(projected6h, p.vol24h) / Math.max(projected6h, p.vol24h);
    if (consistency > 0.65) {
      score += 20;
      signals.push("Volume konsisten sepanjang hari — pertumbuhan organik");
    } else if (consistency > 0.35) {
      score += 10;
      signals.push("Volume cukup konsisten");
    } else {
      signals.push("Volume terkonsentrasi satu waktu — waspada pump");
    }
  }

  // Real community = has both Twitter AND Telegram
  let socialPts = 0;
  if (p.hasTwitter) socialPts += 8;
  if (p.hasTelegram) socialPts += 8;
  if (socialPts >= 16) {
    score += 16;
    signals.push("Ada Twitter + Telegram resmi — komunitas terverifikasi");
  } else if (socialPts > 0) {
    score += socialPts;
    signals.push(p.hasTwitter ? "Ada Twitter resmi" : "Ada Telegram resmi");
  }

  // Age = survived market cycles (not rug)
  if (p.ageDays > 180) {
    score += 15;
    signals.push(`Berusia ${Math.round(p.ageDays)} hari — komunitas teruji lama`);
  } else if (p.ageDays > 60) {
    score += 10;
    signals.push(`Berusia ${Math.round(p.ageDays)} hari — komunitas mulai mapan`);
  } else if (p.ageDays > 14) {
    score += 5;
    signals.push(`Berusia ${Math.round(p.ageDays)} hari — komunitas masih berkembang`);
  }

  // Smart wallets = organic accumulation by savvy wallets
  if (p.smartWalletsCount >= 3) {
    score += 12;
    signals.push(`${p.smartWalletsCount} smart wallet aktif — akumulasi organik terdeteksi`);
  } else if (p.smartWalletsCount > 0) {
    score += 6;
    signals.push(`${p.smartWalletsCount} smart wallet terpantau`);
  }

  // Unique buyers vs sellers
  if (p.txBuyers > 0 || p.txSellers > 0) {
    const total = p.txBuyers + p.txSellers;
    const buyerRatio = total > 0 ? p.txBuyers / total : 0;
    if (buyerRatio > 0.6) {
      score += 12;
      signals.push(`${p.txBuyers} pembeli unik vs ${p.txSellers} penjual — demand organik`);
    } else if (buyerRatio > 0.5) {
      score += 6;
    }
  }

  // Influencer-driven = less organic (price depends on tweets, not community)
  if (p.influencer !== "NONE") {
    score -= 10;
    signals.push("Harga rentan tweet tokoh — kurang organik");
  }

  const label: OrganicResult["label"] =
    score >= 65 ? "ORGANIK" : score >= 35 ? "MODERAT" : "KURANG";
  return { score: Math.min(100, Math.max(0, score)), label, signals };
}

interface ManipulationResult {
  risk: "AMAN" | "WASPADA" | "MANIPULASI";
  flags: string[];
  cleanDays: number; // out of 30
}

function calcManipulationRisk(p: {
  vol24h: number;
  vol6h: number;
  vol1h: number;
  liqUsd: number;
  change1h: number;
  change6h: number;
  change24h: number;
  concentrationTop10: number;
  ageDays: number;
  txBuys: number;
  txSells: number;
  txBuyers: number;
  txSellers: number;
  ohlcv30d?: { open: number; high: number; low: number; close: number; volume: number }[];
}): ManipulationResult {
  let riskPts = 0;
  const flags: string[] = [];

  // 1. Wash trading detection (volume >> liquidity)
  const volLiq = p.liqUsd > 0 ? p.vol24h / p.liqUsd : 0;
  if (volLiq > 100) {
    riskPts += 40;
    flags.push(`Wash trading: volume ${volLiq.toFixed(0)}x likuiditas (sangat tidak normal)`);
  } else if (volLiq > 30) {
    riskPts += 20;
    flags.push(`Volume mencurigakan: ${volLiq.toFixed(0)}x likuiditas`);
  }

  // 2. Active pump detection (huge 24h gain + 1h spike)
  if (p.change24h > 100 && p.change1h > 20) {
    riskPts += 30;
    flags.push(`Pump aktif: +${p.change24h.toFixed(0)}% 24J, +${p.change1h.toFixed(0)}% 1J`);
  } else if (p.change24h > 200) {
    riskPts += 25;
    flags.push(`Harga naik ekstrem +${p.change24h.toFixed(0)}% dalam 24J`);
  }

  // 3. Dump in progress (after big rally, price falling now)
  if (p.change24h > 50 && p.change1h < -10) {
    riskPts += 25;
    flags.push(`Dump terdeteksi: -${Math.abs(p.change1h).toFixed(0)}% 1J setelah rally +${p.change24h.toFixed(0)}%`);
  }

  // 4. Whale concentration + high volume = insider risk
  if (p.concentrationTop10 > 70 && volLiq > 3) {
    riskPts += 30;
    flags.push(`${p.concentrationTop10.toFixed(0)}% supply di top 10 + volume tinggi — risiko whale dump`);
  } else if (p.concentrationTop10 > 55 && volLiq > 5) {
    riskPts += 15;
    flags.push(`Konsentrasi holder ${p.concentrationTop10.toFixed(0)}% dengan volume besar`);
  }

  // 5. Bot trading (many txns, few unique traders)
  const totalTx = p.txBuys + p.txSells;
  const uniqueTraders = p.txBuyers + p.txSellers;
  if (totalTx > 300 && uniqueTraders > 0 && totalTx / uniqueTraders > 15) {
    riskPts += 20;
    flags.push(`Avg ${(totalTx / uniqueTraders).toFixed(0)} transaksi/trader — kemungkinan bot`);
  }

  // 6. OHLCV 30-day pump/dump pattern analysis
  let cleanDays = 30;
  if (p.ohlcv30d && p.ohlcv30d.length >= 7) {
    const candles = p.ohlcv30d;
    let pumpDumpCount = 0;
    let suspVolDays = 0;
    const totalVol = candles.reduce((s, c) => s + (c.volume ?? 0), 0);
    const avgVol = totalVol / candles.length;

    for (let i = 1; i < candles.length; i++) {
      const prev = candles[i - 1];
      const curr = candles[i];
      if (!prev.close || !curr.close) continue;
      const dayChange = ((curr.close - prev.close) / prev.close) * 100;

      // Pump day: >80% gain
      if (dayChange > 80 && i + 1 < candles.length) {
        const next = candles[i + 1];
        if (next?.close && curr.close > 0) {
          const nextChange = ((next.close - curr.close) / curr.close) * 100;
          if (nextChange < -40) pumpDumpCount++;
        }
      }

      // Suspicious volume day: >15x average
      if (avgVol > 0 && curr.volume > avgVol * 15) suspVolDays++;
    }

    cleanDays = Math.max(0, candles.length - pumpDumpCount * 2 - suspVolDays);

    if (pumpDumpCount >= 2) {
      riskPts += 40;
      flags.push(`${pumpDumpCount} kejadian pump & dump terdeteksi dalam 30 hari terakhir`);
    } else if (pumpDumpCount === 1) {
      riskPts += 20;
      flags.push("1 kejadian pump & dump dalam 30 hari terakhir");
    }
    if (suspVolDays >= 3) {
      riskPts += 20;
      flags.push(`Volume anomali ${suspVolDays} hari dalam 30 hari terakhir`);
    }

    if (pumpDumpCount === 0 && suspVolDays < 2) {
      flags.push(`30 hari terakhir: harga stabil, tidak ada pump & dump`);
    }
  } else {
    // No OHLCV data — note that
    flags.push("Data 30 hari belum tersedia, analisis dari data intraday");
    cleanDays = -1; // sentinel: no data
  }

  if (riskPts === 0 && flags.filter((f) => f.startsWith("Data 30")).length === 0) {
    flags.push("Tidak ada sinyal manipulasi terdeteksi");
  }

  const risk: ManipulationResult["risk"] =
    riskPts >= 50 ? "MANIPULASI" : riskPts >= 20 ? "WASPADA" : "AMAN";
  return { risk, flags, cleanDays };
}

// ─── EARLY GEM SCORE ─────────────────────────────────────────────────────────
// Detects early-stage meme coins with breakout potential — similar to early
// patterns in DOGE / SHIB / WIF / PEPE before they went mainstream.

interface EarlyGemResult {
  score: number;
  label: "GEM" | "POTENSIAL" | "BIASA";
  signals: string[];
}

function calcEarlyGemScore(p: {
  marketCap: number;
  ageDays: number;
  concentrationTop10: number;
  viralScore: number;
  organicScore: number;
  manipulationRisk: "AMAN" | "WASPADA" | "MANIPULASI";
  smartWalletsCount: number;
  hasTwitter: boolean;
  hasTelegram: boolean;
  fromTrending: boolean;
  iconic: boolean;
  vol24h: number;
  liqUsd: number;
  change24h: number;
}): EarlyGemResult {
  let score = 0;
  const signals: string[] = [];

  // 1. Market cap — semakin kecil = potensi upside lebih besar
  if (p.marketCap > 0 && p.marketCap < 1_000_000) {
    score += 30;
    signals.push(`Market cap $${(p.marketCap / 1000).toFixed(0)}K — sangat awal, seperti DOGE/SHIB di fase penemuan`);
  } else if (p.marketCap < 5_000_000) {
    score += 20;
    signals.push(`Market cap $${(p.marketCap / 1_000_000).toFixed(2)}M — masih micro-cap, besar ruang untuk tumbuh`);
  } else if (p.marketCap < 20_000_000) {
    score += 10;
    signals.push(`Market cap $${(p.marketCap / 1_000_000).toFixed(1)}M — small-cap dengan potensi 10x+`);
  }

  // 2. Usia — "sweet spot" 1-90 hari: cukup baru tapi sudah terbukti bertahan
  if (p.ageDays >= 1 && p.ageDays <= 30) {
    score += 15;
    signals.push(`Berusia ${p.ageDays} hari — baru lahir, peluang masuk sangat awal`);
  } else if (p.ageDays <= 90) {
    score += 12;
    signals.push(`Berusia ${p.ageDays} hari — masih sangat muda dan belum mainstream`);
  } else if (p.ageDays <= 180) {
    score += 6;
    signals.push(`Berusia ${p.ageDays} hari — masih punya ruang tumbuh`);
  }

  // 3. Distribusi holder — komunitas yang merata seperti SHIB/DOGE awal
  if (p.concentrationTop10 < 15) {
    score += 18;
    signals.push(`Distribusi holder sangat merata (top 10 hanya ${p.concentrationTop10.toFixed(0)}%) — pola komunitas DOGE/SHIB awal`);
  } else if (p.concentrationTop10 < 30) {
    score += 12;
    signals.push(`Distribusi holder baik (${p.concentrationTop10.toFixed(0)}% top 10) — tidak terpusat`);
  } else if (p.concentrationTop10 < 45) {
    score += 5;
  }

  // 4. Momentum viral sedang tumbuh
  if (p.viralScore >= 60) {
    score += 15;
    signals.push(`Viral score ${p.viralScore}/100 — momentum sedang terbentuk`);
  } else if (p.viralScore >= 35) {
    score += 8;
    signals.push(`Viral score ${p.viralScore}/100 — mulai mendapat perhatian`);
  }

  // 5. Komunitas organik kuat
  if (p.organicScore >= 70) {
    score += 12;
    signals.push(`Komunitas organik kuat (skor ${p.organicScore}/100) — bukan bot atau pump palsu`);
  } else if (p.organicScore >= 45) {
    score += 6;
  }

  // 6. Smart wallet masuk — "orang dalam" mulai akumulasi
  if (p.smartWalletsCount >= 3) {
    score += 12;
    signals.push(`${p.smartWalletsCount} smart wallet akumulasi — pola whale awal seperti saat WIF masih murah`);
  } else if (p.smartWalletsCount >= 1) {
    score += 6;
    signals.push(`${p.smartWalletsCount} smart wallet terdeteksi — insider mulai perhatikan koin ini`);
  }

  // 7. Tidak ada tanda manipulasi — kenaikan ini asli
  if (p.manipulationRisk === "AMAN") {
    score += 8;
    signals.push("Tidak ada sinyal manipulasi — momentum ini organic");
  }

  // 8. Sosial media ada — bahan bakar viral
  if (p.hasTwitter && p.hasTelegram) {
    score += 8;
    signals.push("Ada Twitter + Telegram aktif — komunitas siap menyebarkan");
  } else if (p.hasTwitter || p.hasTelegram) {
    score += 4;
  }

  // 9. Sudah masuk trending GeckoTerminal — sinyal awal "penemuan"
  if (p.fromTrending) {
    score += 5;
    signals.push("Sudah masuk radar trending — trader mulai memperhatikan");
  }

  // 10. Tema ikonik — nama yang mudah menjadi meme (seperti DOGE, WIF, PEPE)
  if (p.iconic) {
    score += 5;
    signals.push("Nama/tema mudah viral di sosial media — faktor meme sangat tinggi");
  }

  // 11. Volume vs likuiditas menunjukkan interest sejati
  const volLiq = p.liqUsd > 0 ? p.vol24h / p.liqUsd : 0;
  if (volLiq > 2 && volLiq < 50) {
    score += 5;
    signals.push(`Volume ${volLiq.toFixed(1)}x ukuran pool — interest nyata, bukan wash trading`);
  }

  const label: EarlyGemResult["label"] =
    score >= 70 ? "GEM" : score >= 45 ? "POTENSIAL" : "BIASA";

  return { score: Math.min(100, score), label, signals };
}

// Fetch 30-day OHLCV from GeckoTerminal for manipulation pattern detection.
// Best-effort: silently skips on error/timeout, manipulation analysis falls
// back to intraday signals.
async function enrichWithOhlcv30d(rows: any[]): Promise<void> {
  if (rows.length === 0) return;
  await Promise.allSettled(
    rows.map(async (row) => {
      if (!row.geckoNetwork || !row.poolAddress) return;
      try {
        const url =
          `https://api.geckoterminal.com/api/v2/networks/${row.geckoNetwork}` +
          `/pools/${row.poolAddress}/ohlcv/day?limit=30&token=base`;
        const data = await fetchJson<any>(url, 0);
        const list: any[] | undefined = data?.data?.attributes?.ohlcv_list;
        if (!Array.isArray(list) || list.length < 3) return;
        // GeckoTerminal OHLCV format: [timestamp, open, high, low, close, volume]
        row._ohlcv30d = list.map(([_ts, o, h, l, c, v]: any) => ({
          open: Number(o),
          high: Number(h),
          low: Number(l),
          close: Number(c),
          volume: Number(v),
        }));
      } catch {
        // Silently ignore — no OHLCV = manipulation analysis uses intraday only
      }
    }),
  );
}

async function fetchJson<T>(url: string, retries = 2): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "NexusAlpha/1.0" },
        signal: AbortSignal.timeout(10000),
      });
      // 429 = rate-limited (CoinGecko free tier), retry with longer backoff
      if (r.status === 429 && attempt < retries) {
        const delayMs = 1500 * Math.pow(2, attempt); // 1.5s, 3s, 6s
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      if (!r.ok) return null;
      return (await r.json()) as T;
    } catch {
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      return null;
    }
  }
  return null;
}

// ====== GeckoTerminal types ======
interface GTToken {
  id: string;
  type: "token";
  attributes: {
    name: string;
    symbol: string;
    address: string;
    decimals: number;
    image_url: string | null;
    coingecko_coin_id: string | null;
  };
}

interface GTPool {
  id: string;
  type: "pool";
  attributes: {
    name: string;
    address: string;
    base_token_price_usd: string;
    quote_token_price_usd: string;
    reserve_in_usd: string;
    fdv_usd: string | null;
    market_cap_usd: string | null;
    pool_created_at: string;
    volume_usd: { h1?: string; h6?: string; h24?: string };
    price_change_percentage: { h1?: string; h6?: string; h24?: string };
    transactions?: {
      h24?: { buys: number; sells: number; buyers: number; sellers: number };
    };
  };
  relationships: {
    base_token: { data: { id: string; type: string } };
    quote_token: { data: { id: string; type: string } };
  };
}

interface GTResponse {
  data: GTPool[];
  included?: Array<GTToken | { id: string; type: string }>;
}

interface PoolCandidate {
  network: string; // gt slug
  goplusChain: string; // goplus key
  pool: GTPool;
  baseToken: GTToken;
  // Token age = MAX age across all venues this token trades on (set during
  // dedup). Falls back to chosen pool's age when no dedup info available.
  // Used by evaluateQuality TOO_NEW check and the displayed ageInDays.
  tokenAgeDays?: number;
  // True when at least one pool for this token appeared in GeckoTerminal's
  // trending_pools list — used as a strong viral signal.
  fromTrending?: boolean;
}

interface SmartWallet {
  address: string;
  shortAddress: string;
  percent: number;
  isLocked: boolean;
  tag: string;
  label:
    | "LOCKED_ACCUMULATOR"
    | "EARLY_WHALE"
    | "CONVICTION_HOLDER"
    | "SMART_MONEY";
  reason: string;
}

function isExchangeOrDexTag(tag: string): boolean {
  if (!tag) return false;
  const t = tag.toLowerCase();
  return EXCHANGE_DEX_TAGS.some((e) => t.includes(e));
}

function isBlueChipOrStable(symbol: string): boolean {
  const s = symbol.toLowerCase();
  return BLUE_CHIP_BLACKLIST.has(s) || STABLES_AND_WRAPS.has(s);
}

function shortAddr(a: string, head = 6, tail = 4): string {
  if (!a) return "";
  if (a.length <= head + tail + 3) return a;
  return `${a.slice(0, head)}...${a.slice(-tail)}`;
}

function extractSmartMoney(topHolders: TopHoldersInfo): SmartWallet[] {
  return topHolders.list
    .filter((h) => {
      if (h.isContract) return false;
      if (isExchangeOrDexTag(h.tag)) return false;
      // Sweet spot: real conviction position, not whale-dump risk
      return h.percent >= 0.5 && h.percent <= 15;
    })
    .slice(0, 5)
    .map((h): SmartWallet => {
      let label: SmartWallet["label"] = "SMART_MONEY";
      let reason = "Wallet aktif dengan posisi terkonsentrasi";
      if (h.isLocked) {
        label = "LOCKED_ACCUMULATOR";
        reason = "Holding TERKUNCI on-chain — tidak bisa dump mendadak";
      } else if (h.percent >= 5) {
        label = "EARLY_WHALE";
        reason = "Early whale dengan posisi besar — biasanya ride trend lama";
      } else if (h.percent >= 2) {
        label = "CONVICTION_HOLDER";
        reason = "Conviction holder — accumulating tanpa dump";
      }
      return {
        address: h.address,
        shortAddress: shortAddr(h.address),
        percent: h.percent,
        isLocked: h.isLocked,
        tag: h.tag,
        label,
        reason,
      };
    });
}

async function fetchPools(
  network: string,
  kind: "trending_pools" | "new_pools",
): Promise<PoolCandidate[]> {
  const r = await fetchJson<GTResponse>(
    `${GT_BASE}/networks/${network}/${kind}?include=base_token%2Cquote_token&page=1`,
  );
  if (!r?.data) return [];
  const tokens = new Map<string, GTToken>();
  for (const inc of r.included ?? []) {
    if (inc.type === "token") tokens.set(inc.id, inc as GTToken);
  }
  const goplusChain = GT_TO_GOPLUS[network] ?? network;
  const out: PoolCandidate[] = [];
  for (const pool of r.data) {
    const baseId = pool.relationships?.base_token?.data?.id;
    if (!baseId) continue;
    const baseToken = tokens.get(baseId);
    if (!baseToken) continue;
    out.push({ network, goplusChain, pool, baseToken });
  }
  return out;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

function ageDaysFromIso(iso: string): number {
  const ts = new Date(iso).getTime();
  if (!isFinite(ts)) return 0;
  return Math.max(0, Math.floor((Date.now() - ts) / 86_400_000));
}

function chainLabel(network: string): string {
  switch (network) {
    case "solana":
      return "Solana";
    case "eth":
      return "Ethereum";
    case "bsc":
      return "BNB Chain";
    case "base":
      return "Base";
    case "polygon_pos":
      return "Polygon";
    case "arbitrum":
      return "Arbitrum";
    case "avax":
      return "Avalanche";
    case "optimism":
      return "Optimism";
    default:
      return network;
  }
}

function dexscreenerUrlFor(network: string, address: string): string {
  const m: Record<string, string> = {
    solana: "solana",
    eth: "ethereum",
    bsc: "bsc",
    base: "base",
    polygon_pos: "polygon",
    arbitrum: "arbitrum",
    avax: "avalanche",
    optimism: "optimism",
  };
  return `https://dexscreener.com/${m[network] ?? network}/${address}`;
}

interface CGCoin {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  total_volume: number;
  circulating_supply: number;
  total_supply: number | null;
  max_supply: number | null;
  price_change_percentage_24h: number;
  price_change_percentage_1h_in_currency?: number;
  price_change_percentage_7d_in_currency?: number;
  ath: number;
  ath_change_percentage: number;
}

async function refreshMemes(): Promise<any[]> {
  try {
    // SMART-MONEY SCREENER: discover EARLY-STAGE memecoins (next-DOGE candidates)
    // from GeckoTerminal trending pools across major chains, then verify on-chain
    // safety via GoPlus and surface smart-money holders.
    const networks = ["solana", "eth", "bsc", "base", "arbitrum", "polygon_pos", "avax"];
    // Fetch BOTH trending (hot momentum) and new pools (early-stage hunting)
    // across each chain to surface "next-DOGE" candidates, not blue-chips.
    // Sequence chains with a small inter-chain delay so we don't blast
    // GeckoTerminal's free-tier limiter (~30 req/min). Within each chain
    // the two endpoint calls run in parallel.
    const allPools: PoolCandidate[] = [];
    for (let i = 0; i < networks.length; i++) {
      const n = networks[i];
      const [trending, fresh] = await Promise.all([
        fetchPools(n, "trending_pools").catch(() => [] as PoolCandidate[]),
        fetchPools(n, "new_pools").catch(() => [] as PoolCandidate[]),
      ]);
      trending.forEach((p) => (p.fromTrending = true));
      allPools.push(...trending, ...fresh);
      if (i < networks.length - 1) {
        await new Promise((res) => setTimeout(res, 350));
      }
    }

    // Group by chain+contract and SELECT THE BEST POOL per token (highest
    // liquidity, tiebreaker: highest 24h volume). Trending/new endpoints
    // often surface the same token across multiple pools (different DEXes,
    // different quote pairs). Keeping the first-seen pool would skew the
    // downstream filters with a weaker secondary pool. We then apply blue-
    // chip / stable / mid-cap filters once on the chosen primary pool.
    const groups = new Map<string, PoolCandidate[]>();
    for (const c of allPools) {
      const sym = c.baseToken.attributes.symbol ?? "";
      const addr = (c.baseToken.attributes.address ?? "").toLowerCase();
      if (!sym || !addr) continue;
      if (isBlueChipOrStable(sym)) continue;
      const key = `${c.network}:${addr}`;
      const arr = groups.get(key) ?? [];
      arr.push(c);
      groups.set(key, arr);
    }
    const candidates: PoolCandidate[] = [];
    for (const arr of groups.values()) {
      // Pick the deepest pool as the primary trading venue
      arr.sort((a, b) => {
        const la = parseFloat(a.pool.attributes.reserve_in_usd ?? "0");
        const lb = parseFloat(b.pool.attributes.reserve_in_usd ?? "0");
        if (lb !== la) return lb - la;
        const va = parseFloat(a.pool.attributes.volume_usd?.h24 ?? "0");
        const vb = parseFloat(b.pool.attributes.volume_usd?.h24 ?? "0");
        return vb - va;
      });
      const c = arr[0];
      // Propagate trending flag: if ANY pool for this token was trending, mark the winner
      if (arr.some((p) => p.fromTrending)) c.fromTrending = true;
      // Pre-filter on the chosen pool's fundamentals
      const liq = parseFloat(c.pool.attributes.reserve_in_usd ?? "0");
      const vol = parseFloat(c.pool.attributes.volume_usd?.h24 ?? "0");
      const fdv = parseFloat(c.pool.attributes.fdv_usd ?? "0");
      const mcap = parseFloat(c.pool.attributes.market_cap_usd ?? "0");
      const effectiveMcap = mcap > 0 ? mcap : fdv;
      // Use OLDEST pool age across all venues — token age, not pool age.
      // Persist on the candidate so the downstream evaluator does not fall
      // back to the chosen pool's (possibly fresh) creation date.
      const ageD = Math.max(
        ...arr.map((p) => ageDaysFromIso(p.pool.attributes.pool_created_at)),
      );
      c.tokenAgeDays = ageD;
      if (liq < 50_000) continue;        // thin LP — skip
      if (vol < 5_000) continue;         // dead — skip
      if (ageD < 3) continue;            // too new — skip
      // Cap mcap: filter out established mid/large caps. Early DOGE-hunters
      // want pre-explosion targets, not $500M DeFi tokens or $20B blue chips.
      if (effectiveMcap > 200_000_000) continue;
      // Skip tokens with no mcap data AND huge liq (likely established but
      // missing CG mapping — usually utility tokens, not memes).
      if (effectiveMcap === 0 && liq > 10_000_000) continue;
      candidates.push(c);
    }

    // Cap candidates to keep GoPlus latency bounded
    const top = candidates
      .sort((a, b) => {
        const va = parseFloat(a.pool.attributes.volume_usd?.h24 ?? "0");
        const vb = parseFloat(b.pool.attributes.volume_usd?.h24 ?? "0");
        return vb - va;
      })
      .slice(0, 50);

    // Run GoPlus security checks at concurrency 2. The public free tier
    // returns HTTP 200 with body { code: 4029, "too many requests" } well
    // before HTTP 429 kicks in (it also silently ignores multi-address
    // batching, returning only the first contract). gpFetchWithRetry now
    // detects code:4029 and retries with exponential backoff; concurrency 2
    // keeps the steady-state load under the limiter so retries are rare.
    const securityFetch = new Map<string, SecurityData>();
    await mapWithConcurrency(top, 2, async (c) => {
      const addr = c.baseToken.attributes.address;
      const sec = await fetchGoPlusSecurity(c.goplusChain, addr);
      securityFetch.set(`${c.goplusChain}:${addr.toLowerCase()}`, sec);
    });

    // Second-pass retry for tokens that still came back empty after the first
    // pass (rate-limit hits whose retry budget was exhausted). We retry
    // SEQUENTIALLY with a small delay so the limiter has time to recover.
    //
    // BUDGETED: cap by both count (≤10 retries) and wall-clock time (≤20s).
    // Each fetchGoPlusSecurity can itself spend up to ~8.4s on backoff retries
    // when persistently rate-limited; without these caps the second pass can
    // push total response time past 100s and trigger client-side aborts.
    const emptyAddrs = top.filter((c) => {
      const k = `${c.goplusChain}:${c.baseToken.attributes.address.toLowerCase()}`;
      const s = securityFetch.get(k);
      return !s || (!s.providerOk && s.topHolders.list.length === 0);
    });
    const SECOND_PASS_MAX_TOKENS = 10;
    const SECOND_PASS_BUDGET_MS = 20_000;
    const secondPassDeadline = Date.now() + SECOND_PASS_BUDGET_MS;
    const limited = emptyAddrs.slice(0, SECOND_PASS_MAX_TOKENS);
    for (const c of limited) {
      if (Date.now() >= secondPassDeadline) break;
      const addr = c.baseToken.attributes.address;
      await new Promise((res) => setTimeout(res, 400));
      const sec = await fetchGoPlusSecurity(c.goplusChain, addr);
      securityFetch.set(`${c.goplusChain}:${addr.toLowerCase()}`, sec);
    }

    const evaluated = await mapWithConcurrency(top, 4, async (c) => {
      const addr = c.baseToken.attributes.address;
      const security =
        securityFetch.get(`${c.goplusChain}:${addr.toLowerCase()}`) ??
        emptySecurity();

      const a = c.pool.attributes;
      const price = parseFloat(a.base_token_price_usd ?? "0");
      const liqUsd = parseFloat(a.reserve_in_usd ?? "0");
      const vol24h = parseFloat(a.volume_usd?.h24 ?? "0");
      const vol6h = parseFloat(a.volume_usd?.h6 ?? "0");
      const vol1h = parseFloat(a.volume_usd?.h1 ?? "0");
      const change24h = parseFloat(a.price_change_percentage?.h24 ?? "0");
      const change1h = parseFloat(a.price_change_percentage?.h1 ?? "0");
      const change6h = parseFloat(a.price_change_percentage?.h6 ?? String(change1h));
      const marketCap = parseFloat(a.market_cap_usd ?? a.fdv_usd ?? "0");
      const txH24 = a.transactions?.h24;
      const txBuys = txH24?.buys ?? 0;
      const txSells = txH24?.sells ?? 0;
      const txBuyers = txH24?.buyers ?? 0;
      const txSellers = txH24?.sellers ?? 0;
      // Prefer the cross-venue MAX age set during dedup (token age) over the
      // chosen pool's creation date, which would understate age when the
      // deepest pool was migrated/relaunched recently.
      const ageDays =
        c.tokenAgeDays ?? ageDaysFromIso(a.pool_created_at);

      const baseName = c.baseToken.attributes.name;
      const baseSymbol = (c.baseToken.attributes.symbol ?? "").toUpperCase();
      const themeText = `${baseName} ${baseSymbol}`;
      const influencer = detectInfluencer(themeText);
      const iconic = isIconicMeme(baseName, baseSymbol, "");

      const quality = evaluateQuality({
        liqUsd,
        ageDays,
        marketCap,
        vol24h,
        change24h,
        lp: security.lpLockInfo,
        topHolders: security.topHolders,
        burn: security.burnInfo,
        providerOk: security.providerOk,
        influencer,
        iconic,
      });

      return {
        candidate: c,
        security,
        price,
        liqUsd,
        vol24h,
        vol6h,
        vol1h,
        change1h,
        change6h,
        change24h,
        marketCap,
        ageDays,
        baseName,
        baseSymbol,
        influencer,
        iconic,
        quality,
        txBuys,
        txSells,
        txBuyers,
        txSellers,
      };
    });

    // Debug: count rejections + warnings per reason for tuning
    const rejectCounts: Record<string, number> = {};
    const warningCounts: Record<string, number> = {};
    for (const e of evaluated) {
      for (const r of e.quality.rejectReasons) {
        rejectCounts[r] = (rejectCounts[r] ?? 0) + 1;
      }
      for (const w of e.quality.warnings) {
        warningCounts[w] = (warningCounts[w] ?? 0) + 1;
      }
    }
    logger.info(
      {
        totalCandidates: top.length,
        verified: evaluated.filter((e) => e.quality.tier === "VERIFIED").length,
        watchlist: evaluated.filter((e) => e.quality.tier === "WATCHLIST").length,
        rejected: evaluated.filter((e) => e.quality.tier === "REJECTED").length,
        rejectCounts,
        warningCounts,
      },
      "memes screening summary",
    );

    // Keep VERIFIED + WATCHLIST (anything that wasn't hard-rejected)
    const survivors = evaluated.filter((e) => e.quality.passes);

    const list = survivors.map((e) => {
      const {
        candidate: c,
        security,
        price,
        liqUsd,
        vol24h,
        vol6h,
        vol1h,
        change1h,
        change6h,
        change24h,
        marketCap,
        ageDays,
        baseName,
        baseSymbol,
        influencer,
        iconic,
        quality,
        txBuys,
        txSells,
        txBuyers,
        txSellers,
      } = e;
      const addr = c.baseToken.attributes.address;
      const networkLabel = chainLabel(c.network);

      // === SMART MONEY EXTRACTION ===
      const smartWallets = extractSmartMoney(security.topHolders);
      const lockedSmart = smartWallets.filter((w) => w.isLocked).length;
      // Bonus: 2-5 smart wallets = healthy distribution; 3+ locked = strongest signal
      let smartBonus = 0;
      if (smartWallets.length >= 3) smartBonus += 5;
      if (lockedSmart >= 2) smartBonus += 5;
      else if (lockedSmart >= 1) smartBonus += 2;
      // Healthy momentum bonus: organic 24h gain (not pump-and-dump)
      if (change24h > 5 && change24h < 80) smartBonus += 3;

      const qualityScore = Math.min(100, quality.qualityScore + smartBonus);
      const influencerReason = influencerReasonFor(influencer, baseName);

      // === NEW INDICATORS ===
      const viral = calcViralScore({
        fromTrending: c.fromTrending ?? false,
        change1h, change6h, change24h,
        vol24h, vol1h, vol6h, liqUsd,
        txBuys, txSells,
      });
      const organic = calcOrganicScore({
        concentrationTop10: security.topHolders.concentrationTop10,
        ageDays,
        vol24h, vol6h, liqUsd,
        smartWalletsCount: smartWallets.length,
        hasTwitter: false,  // updated later in social enrichment
        hasTelegram: false,
        influencer,
        txBuyers, txSellers,
      });
      // Manipulation analysis without OHLCV for now; OHLCV patched in after
      const manipulation = calcManipulationRisk({
        vol24h, vol6h, vol1h, liqUsd,
        change1h, change6h, change24h,
        concentrationTop10: security.topHolders.concentrationTop10,
        ageDays, txBuys, txSells, txBuyers, txSellers,
        ohlcv30d: undefined,
      });

      // Early Gem score — social fields patched in after DexScreener enrichment
      const earlyGem = calcEarlyGemScore({
        marketCap,
        ageDays,
        concentrationTop10: security.topHolders.concentrationTop10,
        viralScore: viral.score,
        organicScore: organic.score,
        manipulationRisk: manipulation.risk,
        smartWalletsCount: smartWallets.length,
        hasTwitter: false,
        hasTelegram: false,
        fromTrending: c.fromTrending ?? false,
        iconic,
        vol24h, liqUsd, change24h,
      });

      const reco = recommendation(
        price || 0.0000001,
        change1h,
        change6h,
        change24h,
        vol24h,
        liqUsd,
        ageDays,
        marketCap,
        security.lpLockInfo,
        security.burnInfo,
        security.topHolders,
      );

      const tierTag =
        quality.tier === "VERIFIED" ? "VERIFIED" : "WATCHLIST";
      const description =
        `${baseName} (${baseSymbol}) — early-stage memecoin di ${networkLabel} [${tierTag}]. ` +
        `Market cap $${formatNumber(marketCap, 0)}, liq $${formatNumber(liqUsd, 0)}, ` +
        `volume 24H $${formatNumber(vol24h, 0)}, umur ${ageDays} hari` +
        `${smartWallets.length > 0 ? `, ${smartWallets.length} smart wallet aktif (${lockedSmart} terkunci)` : ""}` +
        `${quality.warnings.length > 0 ? `. Catatan: ${quality.warnings.length} warning aktif — cek bagian peringatan sebelum entry` : ""}.`;

      return {
        id: `gt-${c.network}-${addr}`,
        name: baseName,
        symbol: baseSymbol,
        price:
          price > 0
            ? price < 0.01
              ? price.toPrecision(4)
              : price.toFixed(6)
            : "0",
        change24h: change24h.toFixed(2),
        marketCap: formatNumber(marketCap, 0),
        volume24h: formatNumber(vol24h, 0),
        sentiment: sentimentFrom(change24h),
        description,
        spotStrategy:
          reco.action === "BUY"
            ? `Akumulasi spot kecil di area $${reco.entryPrice}, TP $${reco.takeProfit}, SL $${reco.stopLoss} (${reco.timeframe}).`
            : reco.action === "SELL"
              ? `Take profit / kurangi posisi spot — momentum overheat di $${reco.entryPrice}.`
              : `Wait & see — belum ada konfirmasi struktur. Watch level $${reco.entryPrice}.`,
        futuresStrategy:
          reco.action === "BUY"
            ? `Long futures leverage 2-3x, entry $${reco.entryPrice}, TP $${reco.takeProfit}, SL $${reco.stopLoss}.`
            : reco.action === "SELL"
              ? `Short futures leverage 2-3x, entry $${reco.entryPrice}, TP $${reco.takeProfit}, SL $${reco.stopLoss}.`
              : "Hindari leverage — volatilitas tinggi tanpa arah jelas.",
        contractAddress: addr,
        network: networkLabel,
        geckoNetwork: c.network,
        poolAddress: c.pool.attributes.address,
        liquidity: formatNumber(liqUsd, 0),
        liquidityLocked:
          security.lpLockInfo.status === "LOCKED" ||
          security.lpLockInfo.status === "BURNED",
        lockDuration:
          security.lpLockInfo.longestLockDays != null
            ? `${security.lpLockInfo.longestLockDays} hari`
            : security.lpLockInfo.status === "BURNED"
              ? "Permanen (LP burned)"
              : `${security.lpLockInfo.lockedPercent.toFixed(1)}% locked`,
        website: c.baseToken.attributes.coingecko_coin_id
          ? `https://www.coingecko.com/en/coins/${c.baseToken.attributes.coingecko_coin_id}`
          : dexscreenerUrlFor(c.network, addr),
        twitter: "",
        telegram: "",
        burnFeature: security.burnInfo.burnedPercent > 5,
        burnDescription: security.burnInfo.summary,
        circulatingSupply: "—",
        totalSupply: "—",
        totalBurned: security.burnInfo.burnedPercent.toFixed(2) + "%",
        riskLevel: classifyRisk(
          liqUsd,
          ageDays,
          change24h,
          security.lpLockInfo.status,
        ),
        securityScore: qualityScore,
        ageInDays: ageDays,
        influencer,
        influencerReason,
        technicalRecommendation: reco,
        dexUrl: dexscreenerUrlFor(c.network, addr),
        lpLockInfo: security.lpLockInfo,
        burnInfo: security.burnInfo,
        topHolders: security.topHolders,
        smartWallets,
        qualityScore,
        tier: quality.tier,
        warnings: quality.warnings,
        // ─── NEW INDICATORS ───────────────────────────────────────────────
        viralScore: viral.score,
        viralLabel: viral.label,
        viralSignals: viral.signals,
        organicScore: organic.score,
        organicLabel: organic.label,
        organicSignals: organic.signals,
        manipulationRisk: manipulation.risk,
        manipulationFlags: manipulation.flags,
        cleanDays30d: manipulation.cleanDays,
        // ─── EARLY GEM ────────────────────────────────────────────────────
        earlyGemScore: earlyGem.score,
        earlyGemLabel: earlyGem.label,
        earlyGemSignals: earlyGem.signals,
        // vol breakdown stored for OHLCV patch-up step
        _vol1h: vol1h, _vol6h: vol6h,
        _txBuys: txBuys, _txSells: txSells, _txBuyers: txBuyers, _txSellers: txSellers,
        _change1h: change1h, _change6h: change6h, _liqUsd: liqUsd,
        _concentrationTop10: security.topHolders.concentrationTop10,
        _ageDays: ageDays,
        _marketCap: marketCap,
        _iconic: iconic,
        _fromTrending: c.fromTrending ?? false,
      };
    });

    // Final ranking: VERIFIED first (sorted by qualityScore), then WATCHLIST
    // (sorted by qualityScore). Cap to 15 total. VERIFIED is never displaced
    // by a higher-scoring WATCHLIST entry.
    const verifiedList = list
      .filter((m) => m.tier === "VERIFIED")
      .sort((a, b) => b.qualityScore - a.qualityScore);
    const watchlistList = list
      .filter((m) => m.tier === "WATCHLIST")
      .sort((a, b) => b.qualityScore - a.qualityScore);
    const filtered = [...verifiedList, ...watchlistList].slice(0, 15);

    // Best-effort socials enrichment via DexScreener — populates the
    // `twitter` and `telegram` fields on each row so the X/Telegram buttons
    // render in the mobile UI. Failure is silently ignored: the rest of the
    // memes payload is still useful and the buttons simply won't show.
    // Run OHLCV enrichment in parallel with DexScreener socials.
    await Promise.allSettled([
      enrichWithDexScreenerSocials(filtered),
      enrichWithOhlcv30d(filtered),
    ]);

    // Patch-up: re-compute organic score with real social data now available,
    // and re-run manipulation analysis with OHLCV data fetched above.
    for (const rawRow of filtered) {
      const row = rawRow as any;
      const hasTwitter = typeof row.twitter === "string" && row.twitter.length > 0;
      const hasTelegram = typeof row.telegram === "string" && row.telegram.length > 0;
      const updatedOrganic = calcOrganicScore({
        concentrationTop10: row._concentrationTop10 ?? 50,
        ageDays: row._ageDays ?? 0,
        vol24h: parseFloat(row.volume24h?.replace(/,/g, "") || "0"),
        vol6h: row._vol6h ?? 0,
        liqUsd: row._liqUsd ?? 0,
        smartWalletsCount: (row.smartWallets ?? []).length,
        hasTwitter,
        hasTelegram,
        influencer: row.influencer ?? "NONE",
        txBuyers: row._txBuyers ?? 0,
        txSellers: row._txSellers ?? 0,
      });
      row.organicScore = updatedOrganic.score;
      row.organicLabel = updatedOrganic.label;
      row.organicSignals = updatedOrganic.signals;

      const updatedManipulation = calcManipulationRisk({
        vol24h: parseFloat(row.volume24h?.replace(/,/g, "") || "0"),
        vol6h: row._vol6h ?? 0,
        vol1h: row._vol1h ?? 0,
        liqUsd: row._liqUsd ?? 0,
        change1h: row._change1h ?? 0,
        change6h: row._change6h ?? 0,
        change24h: parseFloat(row.change24h || "0"),
        concentrationTop10: row._concentrationTop10 ?? 50,
        ageDays: row._ageDays ?? 0,
        txBuys: row._txBuys ?? 0,
        txSells: row._txSells ?? 0,
        txBuyers: row._txBuyers ?? 0,
        txSellers: row._txSellers ?? 0,
        ohlcv30d: row._ohlcv30d,
      });
      row.manipulationRisk = updatedManipulation.risk;
      row.manipulationFlags = updatedManipulation.flags;
      row.cleanDays30d = updatedManipulation.cleanDays;

      // Re-compute Early Gem with real social data + updated organic/manipulation
      const updatedEarlyGem = calcEarlyGemScore({
        marketCap: row._marketCap ?? 0,
        ageDays: row._ageDays ?? 0,
        concentrationTop10: row._concentrationTop10 ?? 50,
        viralScore: row.viralScore ?? 0,
        organicScore: row.organicScore ?? 0,
        manipulationRisk: row.manipulationRisk,
        smartWalletsCount: (row.smartWallets ?? []).length,
        hasTwitter,
        hasTelegram,
        fromTrending: row._fromTrending ?? false,
        iconic: row._iconic ?? false,
        vol24h: parseFloat(row.volume24h?.replace(/,/g, "") || "0"),
        liqUsd: row._liqUsd ?? 0,
        change24h: parseFloat(row.change24h || "0"),
      });
      row.earlyGemScore = updatedEarlyGem.score;
      row.earlyGemLabel = updatedEarlyGem.label;
      row.earlyGemSignals = updatedEarlyGem.signals;

      // Clean up internal temp fields before sending to client
      delete row._vol1h; delete row._vol6h;
      delete row._txBuys; delete row._txSells;
      delete row._txBuyers; delete row._txSellers;
      delete row._change1h; delete row._change6h;
      delete row._liqUsd; delete row._concentrationTop10;
      delete row._ageDays; delete row._ohlcv30d;
      delete row._marketCap; delete row._iconic; delete row._fromTrending;
    }

    cache = { ts: Date.now(), data: filtered };
    return filtered;
  } finally {
    memesInflight = null;
  }
}

async function enrichWithDexScreenerSocials(rows: any[]): Promise<void> {
  if (rows.length === 0) return;
  const addrs = rows
    .map((r) => r.contractAddress)
    .filter((a): a is string => typeof a === "string" && a.length > 0);
  if (addrs.length === 0) return;

  // DexScreener accepts up to 30 token addresses per request as a
  // comma-separated path parameter. We chunk to stay well under the limit.
  const chunks: string[][] = [];
  for (let i = 0; i < addrs.length; i += 30) {
    chunks.push(addrs.slice(i, i + 30));
  }

  const socialsByAddr = new Map<
    string,
    { twitter: string; telegram: string }
  >();

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const url = `https://api.dexscreener.com/latest/dex/tokens/${chunk.join(",")}`;
        const r = await fetch(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": "NexusAlpha/1.0",
          },
          signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) return;
        const json = (await r.json()) as { pairs?: DSPair[] };
        const pairs = json.pairs ?? [];
        for (const p of pairs) {
          const a = p.baseToken?.address?.toLowerCase();
          if (!a) continue;
          const existing = socialsByAddr.get(a);
          // First pair wins when populated; merge only what's still missing.
          let twitter = existing?.twitter ?? "";
          let telegram = existing?.telegram ?? "";
          for (const s of p.info?.socials ?? []) {
            const t = (s.type ?? "").toLowerCase();
            const u = s.url ?? "";
            if (!u) continue;
            if (!twitter && t === "twitter") {
              twitter = sanitizeSocialUrl(u, "twitter");
            } else if (!telegram && t === "telegram") {
              telegram = sanitizeSocialUrl(u, "telegram");
            }
          }
          if (twitter || telegram) {
            socialsByAddr.set(a, { twitter, telegram });
          }
        }
      } catch {
        // Best-effort: any network/parse failure leaves socials empty for
        // this chunk. The user-facing memes list still loads normally.
      }
    }),
  );

  for (const r of rows) {
    const addr = (r.contractAddress as string | undefined)?.toLowerCase();
    if (!addr) continue;
    const hit = socialsByAddr.get(addr);
    if (hit) {
      r.twitter = hit.twitter;
      r.telegram = hit.telegram;
    }
  }
}


// ----- Chart endpoint (lazy-loaded per coin) ---------------------------------
// GET /api/ai/memes/chart?network=solana&pool=0x...&tf=1h|24h|7d
// Returns a small price-history payload meant for an inline sparkline.
// Cache TTL: 5 min per (network, pool, tf).

interface ChartPoint {
  t: number; // unix seconds
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume (USD)
}
interface ChartPayload {
  points: ChartPoint[];
  changePct: number;
  min: number;
  max: number;
  first: number;
  last: number;
  timeframe: "1h" | "24h" | "7d";
  source: string;
}

interface GTOhlcvResponse {
  data?: {
    attributes?: {
      ohlcv_list?: number[][];
    };
  };
}

const TF_TO_PARAMS: Record<
  "1h" | "24h" | "7d",
  { timeframe: "minute" | "hour" | "day"; aggregate: number; limit: number }
> = {
  "1h": { timeframe: "minute", aggregate: 5, limit: 12 },
  "24h": { timeframe: "hour", aggregate: 1, limit: 24 },
  "7d": { timeframe: "day", aggregate: 1, limit: 7 },
};

const VALID_CHART_NETWORKS = new Set([
  "solana", "eth", "bsc", "base", "arbitrum", "polygon_pos", "avax", "optimism",
]);
const POOL_RE = /^[A-Za-z0-9_\-.]{1,100}$/;
const CHART_404_CACHE_MAX = 1000;

const chartCache = new Map<string, { ts: number; data: ChartPayload }>();
// Negative cache: pools that GT returned 404 for. Avoids hammering GT for
// known-not-indexed pools (e.g. dead/legacy pool addresses) on every tap.
const chart404Cache = new Map<string, number>(); // key → expiry ts
const CHART_404_TTL_MS = 30 * 60 * 1000; // 30 min
// In-flight dedupe: while a fetch is pending for a given key, share the same
// promise so concurrent taps don't stampede GeckoTerminal's free tier.
const chartInflight = new Map<
  string,
  Promise<{ status: number; payload?: ChartPayload; error?: string }>
>();
const CHART_TTL_MS = 15 * 60 * 1000;

async function fetchChartFromUpstream(
  network: string,
  pool: string,
  tf: "1h" | "24h" | "7d",
): Promise<{ status: number; payload?: ChartPayload; error?: string }> {
  const { timeframe, aggregate, limit } = TF_TO_PARAMS[tf];
  const url = `${GT_BASE}/networks/${encodeURIComponent(
    network,
  )}/pools/${encodeURIComponent(
    pool,
  )}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}&currency=usd`;

  // Direct fetch (not via fetchJson) so we can preserve upstream status
  // semantics — true 404 (no data) vs 429/5xx (provider throttled/down)
  // must be distinguishable for the client.
  let attempt = 0;
  const maxAttempts = 4;
  // Express's Response shadows the global Response in this file. Use the
  // inferred type of fetch's resolved value instead.
  type FetchResp = Awaited<ReturnType<typeof fetch>>;
  while (attempt < maxAttempts) {
    let r: FetchResp;
    try {
      r = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "NexusAlpha/1.0",
        },
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      // Network error — retry up to maxAttempts
      attempt++;
      if (attempt >= maxAttempts) {
        return { status: 503, error: "Chart provider unreachable" };
      }
      await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
      continue;
    }

    if (r.status === 404) {
      return { status: 404, error: "No OHLCV data available" };
    }
    if (r.status === 429 || r.status >= 500) {
      attempt++;
      if (attempt >= maxAttempts) {
        return {
          status: 503,
          error: "Chart provider throttled, try again later",
        };
      }
      // Backoff: 1.5s, 3s, 6s, 12s (max ~22s before giving up)
      const delayMs = 1500 * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }
    if (!r.ok) {
      return { status: 503, error: `Chart provider error (${r.status})` };
    }
    let body: GTOhlcvResponse;
    try {
      body = (await r.json()) as GTOhlcvResponse;
    } catch {
      return { status: 503, error: "Chart provider returned invalid JSON" };
    }
    const raw = body?.data?.attributes?.ohlcv_list ?? [];
    if (!Array.isArray(raw) || raw.length === 0) {
      return { status: 404, error: "No OHLCV data available" };
    }
    const ordered = [...raw].reverse();
    const points: ChartPoint[] = ordered.map((row) => ({
      t: Number(row[0]) || 0,
      o: Number(row[1]) || 0,
      h: Number(row[2]) || 0,
      l: Number(row[3]) || 0,
      c: Number(row[4]) || 0,
      v: Number(row[5]) || 0,
    }));
    const closes = points.map((p) => p.c).filter((v) => v > 0);
    if (closes.length === 0) {
      return { status: 404, error: "No valid prices in OHLCV data" };
    }
    const first = closes[0];
    const last = closes[closes.length - 1];
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const changePct = first > 0 ? ((last - first) / first) * 100 : 0;
    return {
      status: 200,
      payload: {
        points,
        changePct,
        min,
        max,
        first,
        last,
        timeframe: tf,
        source: "GeckoTerminal",
      },
    };
  }
  return { status: 503, error: "Chart provider unreachable" };
}

router.get("/ai/memes/chart", chartLimiter, async (req: Request, res: Response) => {
  const network = String(req.query.network ?? "").toLowerCase().trim();
  const pool = String(req.query.pool ?? "").trim();
  const tfRaw = String(req.query.tf ?? "24h").toLowerCase().trim();
  const tf: "1h" | "24h" | "7d" =
    tfRaw === "1h" || tfRaw === "7d" ? (tfRaw as "1h" | "7d") : "24h";

  if (!network || !pool) {
    return res.status(400).json({ error: "network and pool are required" });
  }
  if (!VALID_CHART_NETWORKS.has(network)) {
    return res.status(400).json({ error: "unsupported network" });
  }
  if (!POOL_RE.test(pool)) {
    return res.status(400).json({ error: "invalid pool address format" });
  }

  const cacheKey = `${network}:${pool.toLowerCase()}:${tf}`;
  const cached = chartCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CHART_TTL_MS) {
    return res.json(cached.data);
  }
  // Negative cache hit — short-circuit known-not-indexed pools
  const negExpiry = chart404Cache.get(cacheKey);
  if (negExpiry && negExpiry > Date.now()) {
    return res.status(404).json({ error: "No OHLCV data available" });
  }

  // In-flight dedupe — coalesce concurrent misses for the same key
  let pending = chartInflight.get(cacheKey);
  if (!pending) {
    pending = fetchChartFromUpstream(network, pool, tf).finally(() => {
      chartInflight.delete(cacheKey);
    });
    chartInflight.set(cacheKey, pending);
  }

  try {
    const result = await pending;
    if (result.status === 200 && result.payload) {
      chartCache.set(cacheKey, { ts: Date.now(), data: result.payload });
      return res.json(result.payload);
    }
    if (result.status === 404) {
      if (chart404Cache.size >= CHART_404_CACHE_MAX) {
        const firstKey = chart404Cache.keys().next().value;
        if (firstKey !== undefined) chart404Cache.delete(firstKey);
      }
      chart404Cache.set(cacheKey, Date.now() + CHART_404_TTL_MS);
    }
    return res
      .status(result.status)
      .json({ error: result.error ?? "Chart unavailable" });
  } catch (err: any) {
    req.log.error(
      { err: err?.message, network, pool, tf },
      "memes chart fetch failed",
    );
    return res
      .status(503)
      .json({ error: "Chart provider unavailable, try again later" });
  }
});

// Boot-time prewarm: kicks off the first refreshMemes 5s after server start
// so the FIRST user request finds a hot cache instead of paying the full
// upstream latency cost (GeckoTerminal + GoPlus security checks).
let memesPrewarmDone = false;
export function schedulePrewarmMemes(): void {
  if (memesPrewarmDone) return;
  memesPrewarmDone = true;
  setTimeout(() => {
    if (cache.data.length === 0 && !memesInflight) {
      // We must NOT swallow errors into [] — that would let an awaiting
      // request return HTTP 200 with empty data, masking failure.
      // Keep the original rejecting promise on memesInflight so the route's
      // try/catch can fall back to cache or 503; attach a separate .catch
      // here only to (a) log and (b) prevent an unhandled-rejection warning.
      const p = refreshMemes();
      p.catch((err) =>
        logger.error(
          { err: err?.message ?? String(err) },
          "memes prewarm refresh failed",
        ),
      );
      memesInflight = p;
    }
  }, 5000);
}

let memesWarmupDone = false;
function scheduleMemesWarmup() {
  if (memesWarmupDone) return;
  memesWarmupDone = true;
  // Prewarm cache 8 seconds after server start (delayed so news warmup goes first)
  setTimeout(() => {
    if (!memesInflight && cache.data.length === 0) {
      memesInflight = refreshMemes();
      memesInflight.catch(() => undefined);
    }
  }, 8000);

  // Refresh cache automatically every TTL
  setInterval(() => {
    if (Date.now() - cache.ts > TTL_MS && !memesInflight) {
      memesInflight = refreshMemes();
      memesInflight.catch(() => undefined);
    }
  }, TTL_MS);
}

router.post("/ai/memes", async (req: Request, res: Response) => {
  scheduleMemesWarmup();

  if (cache.data.length > 0 && Date.now() - cache.ts < TTL_MS) {
    return res.json(cache.data);
  }

  if (memesInflight) {
    try {
      const data = await memesInflight;
      return res.json(data);
    } catch {
      if (cache.data.length > 0) return res.json(cache.data);
      return res.status(503).json({ error: "Sumber data memecoin tidak tersedia sementara, coba lagi nanti" });
    }
  }

  memesInflight = refreshMemes();
  try {
    const data = await memesInflight;
    return res.json(data);
  } catch (err: any) {
    req.log.error({ err: err?.message }, "memes fetch failed");
    if (cache.data.length > 0) return res.json(cache.data);
    return res.status(503).json({ error: "Sumber data memecoin tidak tersedia sementara, coba lagi nanti" });
  }
});

export default router;
