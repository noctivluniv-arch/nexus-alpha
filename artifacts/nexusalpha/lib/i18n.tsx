import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type Lang = "id" | "en";

const STORAGE_KEY = "nexusalpha.lang";
const DEFAULT_LANG: Lang = "en";

type Dict = Record<string, string>;

const ID: Dict = {
  // Tabs
  "tabs.market": "MARKET",
  "tabs.signals": "SIGNALS",
  "tabs.nexus": "NEXUS",
  "tabs.memes": "MEMES",
  "tabs.news": "NEWS",
  "tabs.altcoins": "ALTCOIN",
  "tabs.altcoins": "ALTCOIN",

  // Header subtitles (per screen)
  "header.altcoins": "Watchlist Altcoin",
  "header.altcoins": "Watchlist Altcoin",
  "header.market": "Tinjauan Pasar",
  "header.signals": "Sinyal Futures AI",
  "header.nexus": "Likuidasi & Derivatif",
  "header.memes": "Meme Coin Trending",
  "header.news": "Berita Live + X Feed",

  // Common
  "common.loading": "Memuat...",
  "common.retry": "Coba lagi",
  "common.quotaError": "Kuota AI tercapai. Coba lagi nanti.",

  // Market
  "market.totalCap": "TOTAL MARKET CAP",
  "market.btcDom": "DOMINASI BTC",
  "market.changeSuffix": "(24j)",
  "market.bullishTrend": "Trend bullish",
  "market.fgIndex": "FEAR & GREED INDEX",
  "market.fg.extremeFear": "Sangat Takut",
  "market.fg.fear": "Takut",
  "market.fg.neutral": "Netral",
  "market.fg.greed": "Serakah",
  "market.fg.extremeGreed": "Sangat Serakah",
  "market.fg.yesterday": "Kemarin",
  "market.fg.lastWeek": "7 Hari Lalu",
  "market.fg.lastMonth": "30 Hari Lalu",
  "market.livePrices": "HARGA LIVE",
  "market.spotStrategy": "SPOT STRATEGI",
  "market.strategy.btcDcaTitle": "DCA Bulanan BTC",
  "market.strategy.btcDcaBody":
    "Akumulasi rutin di zona $58.000–$62.000. Long term target 2026 mengarah ke $145.000 berdasarkan halving cycle dan flow ETF.",
  "market.strategy.ethSolTitle": "Rotasi ETH ↔ SOL",
  "market.strategy.ethSolBody":
    "Pantau ratio ETH/SOL. Rotasi profit ke SOL ketika ratio menyentuh resistance jangka panjang untuk memaksimalkan altseason.",
  "market.error": "Gagal memuat harga",

  // Signals
  "signals.selectPair": "PILIH PASANGAN",
  "signals.cta.generate": "GENERATE PRO SIGNAL",
  "signals.cta.loading": "MENGHASILKAN...",
  "signals.disclaimer":
    "Sinyal dihitung dari OHLCV 90 hari + EMA20/50/200, RSI14, MACD, Bollinger, ATR14, Fibonacci & Volume Profile real-time.",
  "signals.loaderText":
    "AI menganalisa EMA, RSI, MACD, Bollinger, Fibonacci & Volume...",
  "signals.confidence": "CONFIDENCE",
  "signals.entry": "ENTRY",
  "signals.leverage": "LEVERAGE",
  "signals.stopLoss": "STOP LOSS",
  "signals.longTarget": "LONG TARGET",
  "signals.support": "SUPPORT",
  "signals.resistance": "RESISTANCE",
  "signals.tpTargets": "TAKE PROFIT TARGETS",
  "signals.confluences": "KONFLUENSI SINYAL",
  "signals.technicalAnalysis": "ANALISA TEKNIKAL",
  "signals.invalidation": "INVALIDATION (Setup batal jika)",
  "signals.expertMindset": "MINDSET AHLI",
  "signals.rawIndicators": "DATA INDIKATOR MENTAH",
  "signals.error": "Gagal menghasilkan sinyal AI. Periksa koneksi.",
  "signals.truncatedError": "Respons AI terpotong. Coba generate ulang dalam beberapa detik.",
  "signals.noTradeTitle": "NO TRADE — SETUP BELUM VALID",
  "signals.noTradeFallback":
    "Setup tidak memenuhi syarat minimum. Tunggu konfirmasi lebih lanjut.",
  "signals.confValid": "✓ VALID",
  "signals.confBelowThreshold": "✗ DI LUAR ZONA 45-55",
  "signals.spotEntryZone": "ZONA ENTRY SPOT",
  "signals.scalp.title": "SCALPING PLAN",
  "signals.scalp.entry": "ENTRY",
  "signals.scalp.trigger": "TRIGGER ENTRY",
  "signals.scalp.riskManagement": "RISK MANAGEMENT",
  "signals.scalp.disabledNotice": "Fitur ini sedang dinonaktifkan sementara. Hasil backtest menunjukkan strategi scalping berbasis indikator 1H saat ini belum memiliki edge yang cukup untuk menutupi biaya transaksi, sehingga belum aman digunakan. Tim sedang mengevaluasi pendekatan baru.",
  "signals.scalp.stopLoss": "STOP LOSS",
  "signals.scalp.leverage": "LEVERAGE",
  "signals.scalp.timeframe": "TIMEFRAME",
  "signals.scalp.holdTime": "HOLD TIME",
  "signals.scalp.session": "SESI OPTIMAL",
  "signals.scalp.tpTargets": "TARGET TAKE PROFIT",
  "signals.scalp.notes": "CATATAN",
  "signals.scalp.noScalp":
    "Setup scalping tidak ideal sekarang. Kondisi pasar belum mendukung entry cepat.",
  "signals.validUntil": "Sinyal valid sampai:",
  "signals.scoreBreakdown": "RINCIAN SKOR",
  "signals.score.trend": "TREN",
  "signals.score.confluence": "KONFLUENSI",
  "signals.score.srLevel": "LEVEL S/R",
  "signals.score.volume": "VOLUME",
  "signals.score.sentiment": "SENTIMEN",
  "signals.score.funding": "FUNDING",
  "signals.score.macro": "MAKRO",
  "signals.scenarios.title": "SKENARIO HARGA & WAKTU",
  "signals.scenarios.bearish": "SKENARIO BEARISH",
  "signals.scenarios.bullish": "SKENARIO BULLISH",
  "signals.scenarios.target": "Target Harga",
  "signals.scenarios.timeframe": "Estimasi Waktu",
  "signals.scenarios.trigger": "Pemicu",
  "signals.scenarios.baseCase": "SKENARIO PALING MUNGKIN",

  // Leverage Calculator
  "signals.leverage.title": "LEVERAGE & RISK CALCULATOR",
  "signals.leverage.capital": "MODAL (USDT)",
  "signals.leverage.selectLeverage": "PILIH LEVERAGE",
  "signals.leverage.positionSize": "POSISI SIZE",
  "signals.leverage.qty": "QTY",
  "signals.leverage.liquidation": "LIQUIDASI",
  "signals.leverage.lossAtSL": "LOSS @ SL",
  "signals.leverage.profitPerTP": "ESTIMASI PROFIT PER TP",
  "signals.leverage.warning": "⚠ Leverage {lv}x sangat berisiko tinggi. Liquidasi hanya {pct}% pergerakan harga. Gunakan hanya jika berpengalaman.",

  // Spot Accumulation
  "signals.spot.title": "💰 SPOT ACCUMULATION ZONE",
  "signals.spot.riskLow": "RISIKO RENDAH — Waktu bagus beli",
  "signals.spot.riskMedium": "RISIKO SEDANG — DCA bertahap",
  "signals.spot.riskHigh": "RISIKO TINGGI — Tunggu correction",
  "signals.spot.aggressive": "AGGRESSIVE",
  "signals.spot.aggressiveDesc": "Entry cepat, risiko lebih tinggi",
  "signals.spot.normal": "NORMAL ✓",
  "signals.spot.normalDesc": "Support utama, rekomendasi",
  "signals.spot.conservative": "CONSERVATIVE",
  "signals.spot.conservativeDesc": "Support kuat, risiko rendah",
  "signals.spot.dcaStrategy": "STRATEGI DCA",
  "signals.spot.marketConditions": "KONDISI MARKET",
  "signals.spot.longTermTarget": "TARGET JANGKA PANJANG",

  // Nexus
  "nexus.banner.title": "REAL-TIME LIQUIDATIONS — OKX SWAPS",
  "nexus.banner.sub":
    "Data live dari OKX Public API · Funding & Open Interest BTC/ETH/SOL",
  "nexus.openInterest": "OPEN INTEREST",
  "nexus.funding": "FUNDING",
  "nexus.bias.long": "BULL BIAS",
  "nexus.bias.short": "BEAR BIAS",
  "nexus.bias.balanced": "BALANCED",
  "nexus.totalLiq": "TOTAL LIKUIDASI (DARI 30 EVENT TERAKHIR)",
  "nexus.longsLiq": "LONGS LIQUIDATED",
  "nexus.shortsLiq": "SHORTS LIQUIDATED",
  "nexus.fetchingOnchain": "Mengambil data on-chain...",
  "nexus.recentEvents": "EVENT LIKUIDASI TERBARU",
  "nexus.longLiquidated": "LONG DI-LIQUIDATE",
  "nexus.shortLiquidated": "SHORT DI-LIQUIDATE",
  "nexus.venue": "Venue",
  "nexus.error": "Gagal memuat data on-chain. Coba refresh.",
  "nexus.time.s": "d lalu",
  "nexus.time.m": "m lalu",
  "nexus.time.h": "j lalu",
  "nexus.time.d": "h lalu",

  // Memes
  "memes.dyor":
    "DYOR! Meme coins sangat volatile. Hanya alokasikan dana yang siap hilang.",
  "memes.searching": "Mencari meme coin trending...",
  "memes.error": "Gagal memuat meme coins.",
  "memes.contractInfo": "CONTRACT INFO",
  "memes.network": "Network",
  "memes.ca": "CA",
  "memes.circulating": "Beredar",
  "memes.totalSupply": "Total Supply",
  "memes.liquidity": "Liquidity",
  "memes.traderAnalysis": "TRADER ANALYSIS",
  "memes.spotStrategy": "SPOT STRATEGY",
  "memes.marketCap": "MARKET CAP",
  "memes.vol24h": "VOL 24J",
  "memes.security": "SECURITY",
  "memes.risk": "RISIKO",
  "memes.locked": "TERKUNCI",
  "memes.burn": "BURN",
  "memes.filterAll": "SEMUA",
  "memes.noNetworkResults": "Tidak ada token di jaringan ini.",
  "memes.actionWait": "TUNGGU",
  "memes.noTradeReason": "ALASAN TIDAK TRADE",
  "memes.mindset": "MINDSET TRADER",
  "memes.age.justNow": "Baru saja",
  "memes.age.days": "hari",
  "memes.age.months": "bulan",
  "memes.age.years": "tahun",
  "memes.influencer.trump": "TRUMP CORRELATION",
  "memes.influencer.elon": "ELON CORRELATION",
  "memes.influencer.both": "TRUMP × ELON",

  // LP Lock Section
  "memes.lpLock.title": "LIQUIDITY LOCK",
  "memes.lpLock.status": "Status",
  "memes.lpLock.locked": "TERKUNCI",
  "memes.lpLock.burned": "DIBAKAR",
  "memes.lpLock.partial": "SEBAGIAN",
  "memes.lpLock.unlocked": "TIDAK TERKUNCI",
  "memes.lpLock.unknown": "TIDAK DIKETAHUI",
  "memes.lpLock.verifiedListing": "LISTING TERVERIFIKASI",
  "memes.lpLock.duration": "Durasi",
  "memes.lpLock.expiry": "Berakhir",
  "memes.lpLock.permanent": "PERMANEN",
  "memes.lpLock.provider": "Provider",
  "memes.lpLock.lockedPct": "% Terkunci",
  "memes.lpLock.burnedPct": "% Dibakar",
  "memes.lpLock.unsupported": "Data lock belum terindeks scanner — verifikasi manual via DexScreener / blockchain explorer sebelum trading.",

  // Burn System Section
  "memes.burn.title": "SISTEM BURN",
  "memes.burn.totalBurned": "Total Dibakar",
  "memes.burn.burnAddresses": "Alamat Burn",
  "memes.burn.noBurn": "Tidak ada burn aktif terdeteksi",
  "memes.burn.deadAddress": "Dead Address",

  // Top Holders / Smart Wallets Section
  "memes.holders.title": "TOP HOLDERS / SMART WALLETS",
  "memes.holders.concentration": "Konsentrasi Top 10",
  "memes.holders.contract": "KONTRAK",
  "memes.holders.whale": "WHALE",
  "memes.holders.locked": "LOCKED",
  "memes.holders.empty": "Data holder tidak tersedia",
  "memes.holders.warning": "Konsentrasi tinggi (>50%) = risiko dump besar",
  "memes.smart.title": "SMART MONEY TRACKER",
  "memes.smart.detected": "terdeteksi",
  "memes.smart.summary": "Wallet pintar yang sedang akumulasi —",
  "memes.smart.lockedCount": "wallet sudah lock posisi.",
  "memes.smart.empty":
    "Belum ada wallet pintar terdeteksi (data on-chain terbatas atau distribusi belum jelas).",
  "memes.smart.locked": "LOCKED",
  "memes.smart.label.lockedAccumulator": "LOCKED ACCUMULATOR",
  "memes.smart.label.earlyWhale": "EARLY WHALE",
  "memes.smart.label.convictionHolder": "CONVICTION HOLDER",
  "memes.smart.label.smartMoney": "SMART MONEY",

  // Memes — price chart (lazy-loaded per coin)
  "memes.chart.show": "TAMPILKAN GRAFIK HARGA",
  "memes.chart.hide": "SEMBUNYIKAN GRAFIK",
  "memes.chart.title": "GRAFIK HARGA",
  "memes.chart.loading": "Memuat data harga...",
  "memes.chart.error": "Gagal memuat grafik. Coba lagi.",
  "memes.chart.empty": "Data harga tidak tersedia untuk pool ini.",
  "memes.chart.retry": "COBA LAGI",
  "memes.chart.tf.1h": "1 JAM",
  "memes.chart.tf.24h": "24 JAM",
  "memes.chart.tf.7d": "7 HARI",
  "memes.chart.signal.oversold": "OVERSOLD — Potensi bottom",
  "memes.chart.signal.capitulation": "CAPITULATION — Volume jual ekstrem",
  "memes.chart.signal.near_support": "DEKAT SUPPORT — Zona pembalikan",
  "memes.chart.signal.overbought": "OVERBOUGHT — Hati-hati koreksi",
  "memes.chart.signal.neutral": "NETRAL — Tidak ada sinyal kuat",
  "memes.chart.change": "Perubahan",
  "memes.chart.high": "Tertinggi",
  "memes.chart.low": "Terendah",
  "memes.chart.last": "Harga sekarang",
  "memes.chart.source": "Sumber",
  "memes.chart.unsupported":
    "Grafik tidak tersedia untuk token ini (data pool tidak lengkap).",

  // News
  "news.banner.title": "REAL-TIME CRYPTO INTEL",
  "news.banner.sub":
    "Berita pasar + sinyal Trump / Elon / BlackRock real-time. Tarik untuk refresh.",
  "news.loaderText": "Mengambil berita real-time dari X & sumber crypto...",
  "news.error": "Gagal memuat berita. Periksa koneksi.",
  "news.influencerSection": "INFLUENCER ALERT — TRUMP / ELON / BLACKROCK",
  "news.trendingSection": "TRENDING SEKARANG",
  "news.xSection": "X BUZZ — INFLUENCER CRYPTO",
  "news.mainstreamSection": "MAINSTREAM CRYPTO NEWS",
  "news.xPost": "X POST",
  "news.newsTag": "NEWS",
  "news.openTweet": "BUKA TWEET",
  "news.openArticle": "BUKA ARTIKEL",
  "news.read": "BACA →",
  "news.aiBuzzNote": "Dibuat AI berdasarkan berita real-time. Bukan postingan nyata dari akun tersebut.",
  "news.aiBuzzSimulated": "SIMULASI AI",
};

const EN: Dict = {
  // Tabs
  "tabs.market": "MARKET",
  "tabs.signals": "SIGNALS",
  "tabs.nexus": "NEXUS",
  "tabs.memes": "MEMES",
  "tabs.news": "NEWS",

  // Header subtitles
  "header.altcoins": "Altcoin Watchlist",
  "header.market": "Market Overview",
  "header.signals": "AI Futures Signals",
  "header.nexus": "Liquidations & Derivatives",
  "header.memes": "Trending Meme Coins",
  "header.news": "Live News + X Feed",

  // Common
  "common.loading": "Loading...",
  "common.retry": "Retry",
  "common.quotaError": "AI quota reached. Try again later.",

  // Market
  "market.totalCap": "TOTAL MARKET CAP",
  "market.btcDom": "BTC DOMINANCE",
  "market.changeSuffix": "(24h)",
  "market.bullishTrend": "Bullish trend",
  "market.fgIndex": "FEAR & GREED INDEX",
  "market.fg.extremeFear": "Extreme Fear",
  "market.fg.fear": "Fear",
  "market.fg.neutral": "Neutral",
  "market.fg.greed": "Greed",
  "market.fg.extremeGreed": "Extreme Greed",
  "market.fg.yesterday": "Yesterday",
  "market.fg.lastWeek": "7 Days Ago",
  "market.fg.lastMonth": "30 Days Ago",
  "market.livePrices": "LIVE PRICES",
  "market.spotStrategy": "SPOT STRATEGY",
  "market.strategy.btcDcaTitle": "Monthly BTC DCA",
  "market.strategy.btcDcaBody":
    "Accumulate steadily in the $58,000–$62,000 zone. Long-term 2026 target at $145,000 driven by the halving cycle and ETF inflows.",
  "market.strategy.ethSolTitle": "Rotate ETH ↔ SOL",
  "market.strategy.ethSolBody":
    "Watch the ETH/SOL ratio. Rotate profits into SOL when the ratio hits long-term resistance to maximize altseason gains.",
  "market.error": "Failed to load prices",

  // Signals
  "signals.selectPair": "SELECT PAIR",
  "signals.cta.generate": "GENERATE PRO SIGNAL",
  "signals.cta.loading": "GENERATING...",
  "signals.disclaimer":
    "Signals are computed from 90-day OHLCV + EMA20/50/200, RSI14, MACD, Bollinger, ATR14, Fibonacci & Volume Profile in real time.",
  "signals.loaderText":
    "AI is analyzing EMA, RSI, MACD, Bollinger, Fibonacci & Volume...",
  "signals.confidence": "CONFIDENCE",
  "signals.entry": "ENTRY",
  "signals.leverage": "LEVERAGE",
  "signals.stopLoss": "STOP LOSS",
  "signals.longTarget": "LONG TARGET",
  "signals.support": "SUPPORT",
  "signals.resistance": "RESISTANCE",
  "signals.tpTargets": "TAKE PROFIT TARGETS",
  "signals.confluences": "SIGNAL CONFLUENCES",
  "signals.technicalAnalysis": "TECHNICAL ANALYSIS",
  "signals.invalidation": "INVALIDATION (Setup voided if)",
  "signals.expertMindset": "EXPERT MINDSET",
  "signals.rawIndicators": "RAW INDICATOR DATA",
  "signals.error": "Failed to generate AI signal. Check your connection.",
  "signals.truncatedError": "AI response was truncated. Please regenerate in a few seconds.",
  "signals.noTradeTitle": "NO TRADE — SETUP NOT VALID",
  "signals.noTradeFallback":
    "Setup does not meet minimum criteria. Wait for further confirmation.",
  "signals.confValid": "✓ VALID",
  "signals.confBelowThreshold": "✗ OUTSIDE 45-55 ZONE",
  "signals.spotEntryZone": "SPOT ENTRY ZONE",
  "signals.scalp.title": "SCALPING PLAN",
  "signals.scalp.entry": "ENTRY",
  "signals.scalp.trigger": "ENTRY TRIGGER",
  "signals.scalp.riskManagement": "RISK MANAGEMENT",
  "signals.scalp.disabledNotice": "This feature is temporarily disabled. Backtesting shows the current 1H indicator-based scalping strategy does not have sufficient edge to cover transaction costs, so it is not yet safe to use. A redesign is under evaluation.",
  "signals.scalp.stopLoss": "STOP LOSS",
  "signals.scalp.leverage": "LEVERAGE",
  "signals.scalp.timeframe": "TIMEFRAME",
  "signals.scalp.holdTime": "HOLD TIME",
  "signals.scalp.session": "OPTIMAL SESSION",
  "signals.scalp.tpTargets": "TAKE PROFIT TARGETS",
  "signals.scalp.notes": "NOTES",
  "signals.scalp.noScalp":
    "Scalping setup not ideal right now. Market conditions don't support a fast entry.",
  "signals.validUntil": "Signal valid until:",
  "signals.scoreBreakdown": "SCORE BREAKDOWN",
  "signals.score.trend": "TREND",
  "signals.score.confluence": "CONFLUENCE",
  "signals.score.srLevel": "S/R LEVEL",
  "signals.score.volume": "VOLUME",
  "signals.score.sentiment": "SENTIMENT",
  "signals.score.funding": "FUNDING",
  "signals.score.macro": "MACRO",
  "signals.scenarios.title": "PRICE & TIME SCENARIOS",
  "signals.scenarios.bearish": "BEARISH SCENARIO",
  "signals.scenarios.bullish": "BULLISH SCENARIO",
  "signals.scenarios.target": "Price Target",
  "signals.scenarios.timeframe": "Estimated Time",
  "signals.scenarios.trigger": "Trigger",
  "signals.scenarios.baseCase": "MOST LIKELY SCENARIO",

  // Leverage Calculator
  "signals.leverage.title": "LEVERAGE & RISK CALCULATOR",
  "signals.leverage.capital": "CAPITAL (USDT)",
  "signals.leverage.selectLeverage": "SELECT LEVERAGE",
  "signals.leverage.positionSize": "POSITION SIZE",
  "signals.leverage.qty": "QTY",
  "signals.leverage.liquidation": "LIQUIDATION",
  "signals.leverage.lossAtSL": "LOSS @ SL",
  "signals.leverage.profitPerTP": "ESTIMATED PROFIT PER TP",
  "signals.leverage.warning": "⚠ {lv}x leverage is very high risk. Liquidation occurs at only {pct}% price movement. Use only if experienced.",

  // Spot Accumulation
  "signals.spot.title": "💰 SPOT ACCUMULATION ZONE",
  "signals.spot.riskLow": "LOW RISK — Good time to buy",
  "signals.spot.riskMedium": "MEDIUM RISK — DCA gradually",
  "signals.spot.riskHigh": "HIGH RISK — Wait for correction",
  "signals.spot.aggressive": "AGGRESSIVE",
  "signals.spot.aggressiveDesc": "Fast entry, higher risk",
  "signals.spot.normal": "NORMAL ✓",
  "signals.spot.normalDesc": "Main support, recommended",
  "signals.spot.conservative": "CONSERVATIVE",
  "signals.spot.conservativeDesc": "Strong support, lower risk",
  "signals.spot.dcaStrategy": "DCA STRATEGY",
  "signals.spot.marketConditions": "MARKET CONDITIONS",
  "signals.spot.longTermTarget": "LONG TERM TARGET",

  // Nexus
  "nexus.banner.title": "REAL-TIME LIQUIDATIONS — OKX SWAPS",
  "nexus.banner.sub":
    "Live data from OKX Public API · Funding & Open Interest BTC/ETH/SOL",
  "nexus.openInterest": "OPEN INTEREST",
  "nexus.funding": "FUNDING",
  "nexus.bias.long": "BULL BIAS",
  "nexus.bias.short": "BEAR BIAS",
  "nexus.bias.balanced": "BALANCED",
  "nexus.totalLiq": "TOTAL LIQUIDATIONS (LAST 30 EVENTS)",
  "nexus.longsLiq": "LONGS LIQUIDATED",
  "nexus.shortsLiq": "SHORTS LIQUIDATED",
  "nexus.fetchingOnchain": "Fetching on-chain data...",
  "nexus.recentEvents": "RECENT LIQUIDATION EVENTS",
  "nexus.longLiquidated": "LONG LIQUIDATED",
  "nexus.shortLiquidated": "SHORT LIQUIDATED",
  "nexus.venue": "Venue",
  "nexus.error": "Failed to load on-chain data. Try refreshing.",
  "nexus.time.s": "s ago",
  "nexus.time.m": "m ago",
  "nexus.time.h": "h ago",
  "nexus.time.d": "d ago",

  // Memes
  "memes.dyor":
    "DYOR! Meme coins are highly volatile. Only allocate funds you can afford to lose.",
  "memes.searching": "Searching for trending meme coins...",
  "memes.error": "Failed to load meme coins.",
  "memes.contractInfo": "CONTRACT INFO",
  "memes.network": "Network",
  "memes.ca": "CA",
  "memes.circulating": "Circulating",
  "memes.totalSupply": "Total Supply",
  "memes.liquidity": "Liquidity",
  "memes.traderAnalysis": "TRADER ANALYSIS",
  "memes.spotStrategy": "SPOT STRATEGY",
  "memes.filterAll": "ALL",
  "memes.noNetworkResults": "No tokens on this network.",
  "memes.actionWait": "WAIT",
  "memes.noTradeReason": "NO-TRADE REASON",
  "memes.mindset": "TRADER MINDSET",
  "memes.marketCap": "MARKET CAP",
  "memes.vol24h": "VOL 24H",
  "memes.security": "SECURITY",
  "memes.risk": "RISK",
  "memes.locked": "LOCKED",
  "memes.burn": "BURN",
  "memes.age.justNow": "Just now",
  "memes.age.days": "days",
  "memes.age.months": "months",
  "memes.age.years": "years",
  "memes.influencer.trump": "TRUMP CORRELATION",
  "memes.influencer.elon": "ELON CORRELATION",
  "memes.influencer.both": "TRUMP × ELON",

  // LP Lock Section
  "memes.lpLock.title": "LIQUIDITY LOCK",
  "memes.lpLock.status": "Status",
  "memes.lpLock.locked": "LOCKED",
  "memes.lpLock.burned": "BURNED",
  "memes.lpLock.partial": "PARTIAL",
  "memes.lpLock.unlocked": "NOT LOCKED",
  "memes.lpLock.unknown": "UNKNOWN",
  "memes.lpLock.verifiedListing": "VERIFIED LISTING",
  "memes.lpLock.duration": "Duration",
  "memes.lpLock.expiry": "Expires",
  "memes.lpLock.permanent": "PERMANENT",
  "memes.lpLock.provider": "Provider",
  "memes.lpLock.lockedPct": "% Locked",
  "memes.lpLock.burnedPct": "% Burned",
  "memes.lpLock.unsupported": "Lock data not yet indexed by scanner — verify manually via DexScreener / blockchain explorer before trading.",

  // Burn System Section
  "memes.burn.title": "BURN SYSTEM",
  "memes.burn.totalBurned": "Total Burned",
  "memes.burn.burnAddresses": "Burn Addresses",
  "memes.burn.noBurn": "No active burn mechanism detected",
  "memes.burn.deadAddress": "Dead Address",

  // Top Holders / Smart Wallets Section
  "memes.holders.title": "TOP HOLDERS / SMART WALLETS",
  "memes.holders.concentration": "Top 10 Concentration",
  "memes.holders.contract": "CONTRACT",
  "memes.holders.whale": "WHALE",
  "memes.holders.locked": "LOCKED",
  "memes.holders.empty": "Holder data unavailable",
  "memes.holders.warning": "High concentration (>50%) = major dump risk",
  "memes.smart.title": "SMART MONEY TRACKER",
  "memes.smart.detected": "detected",
  "memes.smart.summary": "Smart wallets currently accumulating —",
  "memes.smart.lockedCount": "wallets have locked their positions.",
  "memes.smart.empty":
    "No smart wallets detected yet (limited on-chain data or unclear distribution).",
  "memes.smart.locked": "LOCKED",
  "memes.smart.label.lockedAccumulator": "LOCKED ACCUMULATOR",
  "memes.smart.label.earlyWhale": "EARLY WHALE",
  "memes.smart.label.convictionHolder": "CONVICTION HOLDER",
  "memes.smart.label.smartMoney": "SMART MONEY",

  // Memes — tier badges & warnings
  "memes.tier.verified": "VERIFIED",
  "memes.tier.watchlist": "WATCHLIST",
  "memes.tier.verified.tooltip": "Passed every anti-rugpull filter",
  "memes.tier.watchlist.tooltip": "Safe from the most obvious rug signals, but flagged — read the warnings",
  "memes.warnings.title": "WATCHLIST WARNINGS",
  "memes.warnings.intro": "This token cleared the most obvious rug filters but is flagged for the issues below. Review before entering:",
  "memes.warning.SECURITY_UNVERIFIABLE": "On-chain provider has no data — smart contract safety could not be auto-verified. Manual review strongly advised.",
  "memes.warning.LP_UNVERIFIED": "LP status could not be verified (UNKNOWN). Circumstantial proof was insufficient.",
  "memes.warning.LP_LOCK_INSUFFICIENT": "LP only partially locked (less than 60% combined lock+burn).",
  "memes.warning.WHALE_CONCENTRATION": "Top 10 holders own 80%–95% of supply — meaningful whale dump risk.",
  "memes.warning.SINGLE_HOLDER_DOMINANT": "A single holder controls 35%–50% of supply — single-wallet dump risk.",

  // Memes — price chart (lazy-loaded per coin)
  "memes.chart.show": "SHOW PRICE CHART",
  "memes.chart.hide": "HIDE CHART",
  "memes.chart.title": "PRICE CHART",
  "memes.chart.loading": "Loading price data...",
  "memes.chart.error": "Failed to load chart. Try again.",
  "memes.chart.empty": "No price data available for this pool.",
  "memes.chart.retry": "RETRY",
  "memes.chart.tf.1h": "1 HOUR",
  "memes.chart.tf.24h": "24 HOURS",
  "memes.chart.tf.7d": "7 DAYS",
  "memes.chart.signal.oversold": "OVERSOLD — Potential bottom",
  "memes.chart.signal.capitulation": "CAPITULATION — Extreme sell volume",
  "memes.chart.signal.near_support": "NEAR SUPPORT — Reversal zone",
  "memes.chart.signal.overbought": "OVERBOUGHT — Watch for pullback",
  "memes.chart.signal.neutral": "NEUTRAL — No strong signal",
  "memes.chart.change": "Change",
  "memes.chart.high": "High",
  "memes.chart.low": "Low",
  "memes.chart.last": "Current",
  "memes.chart.source": "Source",
  "memes.chart.unsupported":
    "Chart not available for this token (pool data incomplete).",

  // News
  "news.banner.title": "REAL-TIME CRYPTO INTEL",
  "news.banner.sub":
    "Market news + real-time Trump / Elon / BlackRock signals. Pull to refresh.",
  "news.loaderText": "Fetching real-time news from X & crypto sources...",
  "news.error": "Failed to load news. Check your connection.",
  "news.influencerSection": "INFLUENCER ALERT — TRUMP / ELON / BLACKROCK",
  "news.trendingSection": "TRENDING NOW",
  "news.xSection": "X BUZZ — CRYPTO INFLUENCERS",
  "news.mainstreamSection": "MAINSTREAM CRYPTO NEWS",
  "news.xPost": "X POST",
  "news.newsTag": "NEWS",
  "news.openTweet": "OPEN TWEET",
  "news.openArticle": "OPEN ARTICLE",
  "news.read": "READ →",
  "news.aiBuzzNote": "AI-generated based on real-time news. Not actual posts from these accounts.",
  "news.aiBuzzSimulated": "AI SIMULATED",
};

const DICTS: Record<Lang, Dict> = { id: ID, en: EN };

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18nCtx>({
  lang: DEFAULT_LANG,
  setLang: () => undefined,
  t: (k) => k,
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (v === "id" || v === "en") setLangState(v);
      })
      .finally(() => setReady(true));
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    AsyncStorage.setItem(STORAGE_KEY, l).catch(() => undefined);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const raw = DICTS[lang][key] ?? DICTS.id[key] ?? key;
      if (!vars) return raw;
      return raw.replace(/\{(\w+)\}/g, (_, k) =>
        vars[k] !== undefined ? String(vars[k]) : `{${k}}`,
      );
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  if (!ready) return null;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useT() {
  return useContext(Ctx).t;
}

export function useLang() {
  const { lang, setLang } = useContext(Ctx);
  return { lang, setLang };
}
