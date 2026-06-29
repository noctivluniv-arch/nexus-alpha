# Nexus Alpha — Claude Context File

## Project Overview
Crypto trading signal web app. Monorepo dengan pnpm.

## Lokasi Folder
- Working directory: ~/nexus-alpha
- GitHub: https://github.com/noctivluniv-arch/nexus-alpha
- Frontend: nexus-alpha-zeta.vercel.app (Vercel)
- Backend: Render (TypeScript/Express)

## Stack
- Monorepo: pnpm workspace
- Backend: TypeScript + Express (artifacts/api-server/)
- Frontend: React (Vercel)
- Database: PostgreSQL via Drizzle ORM
- Signal Engine: rule-based (signal-engine-realtime.ts), bukan AI

## State Terkini
- Data source: Bybit API (Binance ditinggal karena HTTP 418 ban di Render)
- Signal confidence sweet spot: 40-65 (diperlebar dari 45-55 agar BTC dan pair lain tidak miss)
- SUPPORTED_PAIRS: BTCUSDT, ETHUSDT, BNBUSDT, SUIUSDT, SOLUSDT, HYPEUSDT, LINKUSDT, XRPUSDT, DOGEUSDT, AVAXUSDT (10 pair)
- Telegram signal biasa: aktif, cron tiap 10 menit via startCron()
- Telegram meme coin: aktif, cron tiap 15 menit via startMemeCron()
- escapeHtml() sudah diterapkan di confluences untuk cegah Telegram 400 error
- Git tag stable: stable-telegram-signals
- LunarCrush API: free tier tidak support endpoint yang dibutuhkan, tidak dipakai

## Cara Kerja Signal Biasa
1. Cron jalan tiap 10 menit
2. Fetch OHLCV dari Bybit untuk 9 pair
3. Hitung confidence score (rule-based)
4. Kalau confidence 45-55 DAN side != NO_TRADE → kirim Telegram via TELEGRAM_BOT_TOKEN

## Cara Kerja Meme Cron
1. Cron jalan tiap 15 menit via startMemeCron()
2. POST ke /api/ai/memes (reuse cache TTL 5 menit)
3. Filter: earlyGemLabel === "GEM" ATAU volumeSignal === "PUMP_IMMINENT"
4. Skip coin dengan buyVerdict === "HINDARI"
5. Cooldown 30 menit per coin (Map in-memory)
6. Kirim Telegram via MEME_TELEGRAM_BOT_TOKEN ke MEME_TELEGRAM_CHAT_ID

## Logika Scoring Meme Coin (memes.ts)
- PUMP_IMMINENT: volume 1H >= 4x rata-rata 6H (diturunkan dari 10x)
- ACCUMULATION: volume 1H >= 1.5x rata-rata 6H (diturunkan dari 3x)
- Buy pressure bonus: 70%+ buy ratio = +15 poin, 60%+ = +10, 50%+ = +5, <35% = -10
- LP_UNLOCKED: hard reject untuk non-Solana, warning saja untuk Solana
- CoinGecko trending: +20 poin ke buyScore kalau coin masuk trending CoinGecko
- GeckoTerminal trending: +10 poin ke buyScore kalau fromTrending = true
- buyVerdict: LAYAK_BELI / WASPADA / HINDARI (berdasarkan calcBuyRecommendation)
- Hard reject: LIQUIDITY_TOO_THIN (<$50K), TOO_NEW (<12 jam), NO_REAL_VOLUME (<$5K), EXTREME_VOLATILITY (>400%), MCAP_LIQ_MISMATCH, WHALE_CONCENTRATION_EXTREME (>=95%), SINGLE_HOLDER_EXTREME (>50%)

## Sumber Data Trending Yang Dipakai
- GeckoTerminal trending_pools — fromTrending field, sudah ada sejak awal
- CoinGecko /search/trending — fetchCoinGeckoTrending(), cache 15 menit, gratis
- DexScreener socials — enrichWithDexScreenerSocials(), isi twitter/telegram field

## Environment Variables di Render
- TELEGRAM_BOT_TOKEN — bot signal biasa
- TELEGRAM_CHAT_ID — chat ID signal biasa
- MEME_TELEGRAM_BOT_TOKEN — bot khusus meme coin
- MEME_TELEGRAM_CHAT_ID — chat ID meme coin (305425021)
- BASE_URL — URL backend Render (https://nexus-alpha-j3yb.onrender.com)
- LUNARCRUSH_API_KEY — tersimpan tapi tidak dipakai (free tier tidak support)

## File-File Kunci
- artifacts/api-server/src/routes/cron.ts — cron job & Telegram sender (signal + meme)
- artifacts/api-server/src/routes/memes.ts — meme coin screener
- artifacts/api-server/src/lib/signal-engine-realtime.ts — signal engine utama
- artifacts/api-server/src/lib/types.ts — SUPPORTED_PAIRS dan tipe data
- artifacts/api-server/src/index.ts — entry point, panggil startCron() dan startMemeCron()

## Bug Yang Sudah Diselesaikan
- narrativeData is not defined (ReferenceError scope) di memes.ts — FIXED ✓
- Meme cron fetch 404 karena URL salah (/ai/memes → /api/ai/memes) — FIXED ✓
- Meme cron fetch 404 karena method salah (GET → POST) — FIXED ✓

## Improvement Yang Sudah Diimplementasikan
- PUMP_IMMINENT threshold turun 10x → 4x untuk deteksi lebih awal — DONE ✓
- Buy pressure scoring ditambahkan ke evaluateQuality — DONE ✓
- LP_UNLOCKED jadi warning untuk Solana, bukan hard reject — DONE ✓
- calcBuyRecommendation: verdict LAYAK_BELI/WASPADA/HINDARI — DONE ✓
- Telegram meme alert tampilkan verdict + alasan + red flags — DONE ✓
- CoinGecko trending enrichment (fetchCoinGeckoTrending, cache 15 menit) — DONE ✓

## Yang Belum Selesai / Perlu Dilanjutkan
- buyVerdict belum tampil di halaman Memes web app (frontend React) — TODO
- Test end-to-end: apakah fromCoinGeckoTrending benar terdeteksi di log Render — DONE ✓ (terdeteksi di log)

## Sesi 2026-06-29 — Bug Fix & Backtest

### Fix Signal Engine — DONE ✓
- Sweet spot diperlebar 45-55 → 40-65 (awal), lalu akan direvisi lagi setelah backtest
- CONFIDENCE_THRESHOLD = 58 di cron.ts dihapus (dead code)
- Tambah Daily trend filter di checkHardRejects() — cegah BUY saat trend1d BEARISH dan sebaliknya
- volH1 dan volH6 di signal-engine-realtime.ts sudah diisi dari data 1H Bybit nyata (bukan 0)

### Fix SUPPORTED_PAIRS — DONE ✓
- Hapus ZECUSDT (confidence 9, data tidak reliable)
- Hapus ASTERUSDT (terlalu baru, data historis kurang)
- Tambah XRPUSDT, DOGEUSDT, AVAXUSDT (Tier 1 futures)
- Pairs saat ini: BTCUSDT, ETHUSDT, BNBUSDT, SUIUSDT, SOLUSDT, HYPEUSDT, LINKUSDT, XRPUSDT, DOGEUSDT, AVAXUSDT

### Backtest Sweet Spot — IN PROGRESS
- Script: scripts/src/backtest-sweet-spot.ts (jalankan: tsx scripts/src/backtest-sweet-spot.ts)
- Hasil 3124 trades dari 8 pair x 1000 candle daily:
  - 00-40: WinRate 43.8%, AvgPnL -0.34% ⚠️
  - 40-45: WinRate 43.9%, AvgPnL -0.62% ⚠️
  - 45-50: WinRate 42.0%, AvgPnL -0.46% ⚠️
  - 50-55: WinRate 45.6%, AvgPnL +0.27% ⚠️ (terbaik tapi lemah)
  - 55-60: WinRate 28.7%, AvgPnL -2.97% ❌
  - 60-65: WinRate 27.8%, AvgPnL -3.81% ❌
- Kesimpulan: belum ada bucket benar-benar profitable
- Root cause: volume 1H data hanya cover ~41 hari (1000 candle 1H) vs 1000 daily (~2.7 tahun)
- Next step: upgrade backtest dengan breakdown per pair, BUY vs SELL, filter Daily trend jelas

### Sweet Spot Saat Ini di Engine
- Signal-engine-realtime.ts masih pakai SWEET_SPOT_MIN=40, SWEET_SPOT_MAX=65
- BELUM diubah kembali — tunggu hasil backtest yang lebih detail dulu
- Jangan gunakan untuk uang asli sampai backtest menunjukkan profitable zone yang jelas

### GoPlus Rate Limit (TODO)
- GoPlus API error code 4029 (rate limit) muncul di log meme cron
- Belum difix — perlu tambah retry/delay
- Tidak blocking, meme cron tetap berjalan normal

### Telegram Connect Timeout (TODO)
- ConnectTimeoutError saat kirim signal ke Telegram (149.154.166.110:443)
- Perlu tambah retry logic di sendTelegram()
- Signal gagal kirim tanpa fallback

## Fix Signal Engine 2026-06-29
- Sweet spot diperlebar 45-55 → 40-65 agar BTC dan pair lain tidak miss — DONE ✓
- CONFIDENCE_THRESHOLD = 58 di cron.ts dihapus (dead code) — DONE ✓
- Tambah Daily trend filter di checkHardRejects() — DONE ✓
  - BUY diblokir kalau trend1d BEARISH
  - SELL diblokir kalau trend1d BULLISH
  - Mencegah false signal seperti kasus HYPE (4H bounce tapi Daily masih lemah)

## Update 2026-06-29

### Fix Signal Sweet Spot — DONE ✓
- Sweet spot diperlebar dari 45-55 → 40-65
- Sebelumnya BTC dan pair lain sering miss karena range terlalu sempit (10 poin)
- CONFIDENCE_THRESHOLD = 58 di cron.ts dihapus (dead code, tidak pernah dipakai)



### TODO #1 — buyVerdict di frontend — DONE ✓
- Tambah field ke MemeCoin type (artifacts/nexusalpha/lib/types.ts):
  - buyVerdict?: "LAYAK_BELI" | "WASPADA" | "HINDARI"
  - buyScore?: number
  - buyReasons?: string[]
  - buyRedFlags?: string[]
- Tambah komponen BuyVerdictSection di memes.tsx
  - Tampil di atas spotStrategy
  - Warna: hijau (LAYAK_BELI), kuning (WASPADA), merah (HINDARI)
  - Menampilkan: verdict badge, buyScore bar, daftar alasan, daftar red flags
- Sudah di-commit dan push ke GitHub
