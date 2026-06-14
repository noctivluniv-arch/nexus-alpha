export type TradingPair =
  | "BTCUSDT"
  | "ETHUSDT"
  | "BNBUSDT"
  | "SUIUSDT"
  | "SOLUSDT"
  | "HYPEUSDT"
  | "ASTERUSDT"
  | "ZECUSDT"
  | "LINKUSDT";

export const SUPPORTED_PAIRS: TradingPair[] = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SUIUSDT",
  "SOLUSDT",
  "HYPEUSDT",
  "ASTERUSDT",
  "ZECUSDT",
  "LINKUSDT",
];

export interface FearGreedPoint {
  value: number;
  classification: string;
  timestamp: number;
}

export interface FearGreedData {
  current: FearGreedPoint;
  yesterday: FearGreedPoint | null;
  lastWeek: FearGreedPoint | null;
  lastMonth: FearGreedPoint | null;
  history: FearGreedPoint[];
  nextUpdateSeconds: number;
}

export interface PriceData {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
}

export interface ScoreBreakdown {
  trend: number;
  confluence: number;
  srLevel: number;
  volume: number;
  sentiment: number;
  funding: number;
  macro: number;
  total: number;
}

export interface PriceScenarios {
  bearishTarget: string;
  bearishTimeframe: string;
  bearishCondition: string;
  bullishTarget: string;
  bullishTimeframe: string;
  bullishCondition: string;
  baseCase: string;
}

export interface ScalpingPlan {
  side: "LONG" | "SHORT" | "NO_SCALP";
  entryPrice: string;
  entryTrigger: string;
  stopLoss: string;
  takeProfit: string[];
  takeProfitRR: string[];
  leverage: string;
  timeframe: string;
  holdTime: string;
  sessionWindow: string;
  notes: string;
  riskManagement?: { stopDistancePct: string; suggestion: string };
}

export interface SpotAccumulationZone {
  aggressive: string;    // entry dekat harga sekarang, risiko lebih tinggi
  normal: string;        // entry di support utama
  conservative: string;  // entry di support kuat / oversold zone
  idealConditions: string[];  // kondisi ideal untuk beli spot
  longTermTarget: string;
  dcaStrategy: string;   // saran strategi DCA
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
}

export interface TradingSignal {
  pair: TradingPair;
  side: "BUY" | "SELL" | "NO_TRADE";
  entryRange: string;
  entryPrice: string;
  takeProfit: string[];
  takeProfitRR: string[];
  stopLoss: string;
  stopLossRiskPct: string;
  confidence: number;
  timestamp: number;
  reasoning: string;
  traderStyle: string;
  leverage: string;
  expertMindset: string;
  spotEntry: string;
  longTermTarget: string;
  marketStructure: "BULLISH" | "BEARISH" | "RANGING";
  riskReward: string;
  invalidation: string;
  keySupport: string;
  keyResistance: string;
  confluences: string[];
  noTrade?: boolean;
  noTradeReason?: string;
  scoreBreakdown?: ScoreBreakdown;
  validUntil?: string;
  timeframe?: string;
  indicatorSnapshot?: string;
  priceScenarios?: PriceScenarios;
  scalpingPlan?: ScalpingPlan;
  isFallback?: boolean;
  spotAccumulation?: SpotAccumulationZone;
}

export interface NewsFeedItem {
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
  influencer?: "TRUMP" | "ELON" | "BLACKROCK" | "SAYLOR" | "CZ" | "VITALIK" | "CATHIE" | "ARMSTRONG" | "KIYOSAKI" | "DORSEY" | "HAYES" | null;
  impact: "HIGH" | "MEDIUM" | "LOW";
  sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
  isAIGenerated?: boolean;
}

export interface TrendingTopic {
  label: string;
  category: string;
  sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
  count: number;
  influencers?: string[];
  influencerDriven?: boolean;
}

export interface MacroItem {
  id: string;
  title: string;
  source: string;
  category: "FED" | "INFLATION" | "TRADE" | "MARKETS" | "ENERGY" | "CURRENCY" | "ECONOMY" | "GENERAL";
  sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
  impact: "HIGH" | "MEDIUM" | "LOW";
  summary: string;
  time: string;
  url: string;
}

export interface MemeCoin {
  id: string;
  name: string;
  symbol: string;
  price: string;
  change24h: string;
  marketCap: string;
  volume24h: string;
  sentiment: "BULLISH" | "HYPER" | "NEUTRAL";
  description: string;
  spotStrategy: string;
  futuresStrategy: string;
  contractAddress: string;
  network: string;
  liquidity: string;
  liquidityLocked: boolean;
  lockDuration: string;
  website: string;
  twitter: string;
  telegram: string;
  dexUrl?: string;
  burnFeature: boolean;
  burnDescription: string;
  circulatingSupply: string;
  totalSupply: string;
  totalBurned: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
  securityScore: number;
  ageInDays: number;
  influencer: "NONE" | "TRUMP" | "ELON" | "BOTH";
  influencerReason: string;
  technicalRecommendation: {
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
    scoreBreakdown?: {
      liquidity: number;
      age: number;
      momentum: number;
      volume: number;
      security: number;
      holders: number;
      marketCap: number;
      total: number;
    };
  };
  lpLockInfo?: {
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
  };
  burnInfo?: {
    burnedPercent: number;
    burnedAddresses: { address: string; tag: string; percent: number }[];
    summary: string;
  };
  topHolders?: {
    concentrationTop10: number;
    list: {
      address: string;
      percent: number;
      tag: string;
      isContract: boolean;
      isLocked: boolean;
    }[];
  };
  smartWallets?: {
    address: string;
    shortAddress: string;
    percent: number;
    isLocked: boolean;
    label:
      | "LOCKED_ACCUMULATOR"
      | "EARLY_WHALE"
      | "CONVICTION_HOLDER"
      | "SMART_MONEY";
    tag: string;
    reason: string;
  }[];
  tier?: "VERIFIED" | "WATCHLIST";
  warnings?: string[];
  geckoNetwork?: string;
  poolAddress?: string;
  // ─── NEW INDICATORS ────────────────────────────────────────────────────────
  viralScore?: number;
  viralLabel?: "VIRAL" | "TRENDING" | "QUIET";
  viralSignals?: string[];
  organicScore?: number;
  organicLabel?: "ORGANIK" | "MODERAT" | "KURANG";
  organicSignals?: string[];
  manipulationRisk?: "AMAN" | "WASPADA" | "MANIPULASI";
  manipulationFlags?: string[];
  cleanDays30d?: number;
  // ─── EARLY GEM ─────────────────────────────────────────────────────────────
  earlyGemScore?: number;
  earlyGemLabel?: "GEM" | "POTENSIAL" | "BIASA";
  earlyGemSignals?: string[];
  volumeSignal?: "PUMP_IMMINENT" | "ACCUMULATION" | "NORMAL" | "DUMPING";
  volumeSignalLabel?: string;
  vol1h?: number;
  vol6h?: number;
}

export type ChartTimeframe = "1h" | "24h" | "7d";

export interface ChartPoint {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface ChartPayload {
  points: ChartPoint[];
  changePct: number;
  min: number;
  max: number;
  first: number;
  last: number;
  timeframe: ChartTimeframe;
  source: string;
}

export interface WhaleAlert {
  id: string;
  symbol: string;
  amount: string;
  amountUsd: string;
  from: string;
  to: string;
  timestamp: number;
  transactionType: "TRANSFER" | "LIQUIDATION" | "ACCUMULATION";
}

export interface DerivStat {
  symbol: string;
  fundingRate: number;
  fundingRateNext: number | null;
  nextFundingTime: number;
  oiUsd: number;
  bias: "LONG_HEAVY" | "SHORT_HEAVY" | "BALANCED";
}

export interface NexusFeed {
  alerts: Omit<WhaleAlert, "id">[];
  derivatives: DerivStat[];
  totalLiquidatedUsd24h: number;
  longsLiquidatedUsd: number;
  shortsLiquidatedUsd: number;
  generatedAt: number;
}
