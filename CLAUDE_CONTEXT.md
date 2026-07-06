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

## Sesi 2026-06-30 — Backtest v3, Bug Fix, Engine Tuning

### Bug Kritis Ditemukan & Fixed — DONE ✓
- signal-engine-realtime.ts: `trend1d` selama ini pakai `trend4hVal` (4H EMA), bukan Daily EMA
- Akibatnya: `checkHardRejects()` Daily trend filter tidak pernah benar-benar bekerja
- Fix: tambah `const trend1dVal = trendStructure(ema50Val, ema200Val, price)` dan ubah `trend1d: trend1dVal`

### Backtest v3 — DONE ✓
- Script: scripts/src/backtest-v3-paginated.ts
- Upgrade dari v2: paginated fetch (daily up to 4000 candle, 4H up to 5000 candle, time-aligned pakai timestamp)
- volH1/volH6 diapproximasi dari daily volume (eliminasi misalignment 1H di v2)
- Hasil 2813 trades dari 6 pair:

#### Temuan Utama
- v2 SELL 00-40 +1.13% ternyata FALSE POSITIVE — karena 1H volume misaligned (data 41 hari terakhir bukan historical)
- SELL 45-50: WR 48.8%, AvgPnL +0.74%, PF 1.22 — zona paling reliable
- SELL 50-55: WR 48.2%, AvgPnL +0.34%, PF 1.09 — borderline positif
- BUY: semua zona negatif kecuali 65-70 (18 trades — sample terlalu kecil, tidak reliable)
- Daily trend filter (searah trend) justru memperburuk hasil SELL, tidak membantu

#### Sweet Spot Saat Ini di Engine
- SELL: confidence 45-55 (berdasarkan backtest v3)
- BUY: DISABLED — semua zona negatif, belum ada bukti profitable
- Format variabel di engine: `conf` (bukan `scored.score.total`) — pakai `const conf = scored.score.total`

### Step 1 Changes — PARTIALLY DONE
- trend1d bug fix: DONE ✓
- Split sweet spot BUY/SELL: DONE ✓ (tapi langsung direvisi lagi berdasarkan v3)
- Update sweet spot ke SELL 45-55 + BUY disabled: PENDING ⚠️

### PENDING — Sweet Spot Update Gagal di Python
- Python patch error: "old string not found" karena format kode berbeda
- Engine saat ini masih pakai format lama: `if (scored.bias === "BULLISH" && conf >= 50 && conf <= 55) side = "BUY";`
- Perlu lihat baris 185-200 signal-engine-realtime.ts dulu sebelum patch
- Command untuk diagnose: `sed -n '185,200p' artifacts/api-server/src/lib/signal-engine-realtime.ts`
- Target setelah fix:
  - Hapus BUY logic
  - SELL hanya fire kalau conf >= 45 && conf <= 55 && bias === "BEARISH"

### Option A — DONE ✓
- Script backtest-v3-paginated.ts sudah ada di scripts/src/
- Sudah dijalankan dan menghasilkan data valid

### Option B — TODO (belum dimulai)
- Butuh: cat artifacts/api-server/src/db/schema.ts
- Rencana:
  1. Tambah tabel ohlcv_daily di Drizzle schema
  2. Script seed historical data (pakai logika paginated dari Option A)
  3. Modifikasi cron: simpan candle harian otomatis ke PostgreSQL
  4. Tujuan: forward testing — simpan setiap signal + hasil nyata untuk evaluate engine

### Root Cause Engine yang Masih Perlu Diinvestigasi
- Rule scoring kurang diskriminatif (banyak rule overlap, confidence menumpuk di zona yang sama)
- TP/SL ratio (ATR 1.5x) mungkin tidak optimal — perlu disesuaikan
- Belum ada zona BUY yang statistik kuat (WR ≥ 55% + AvgPnL ≥ 1% + n ≥ 50 trades)
- Jangan gunakan BUY untuk uang asli sampai ada zona yang terbukti profitable

### Per-Pair Status (v3)
- ⚠️ BTCUSDT: AvgPnL -0.34%, best bucket 40-45
- ⚠️ ETHUSDT: AvgPnL +0.18%, best bucket 45-50 (WR 56%, AP +1.66%) ← paling menjanjikan
- ⚠️ BNBUSDT: AvgPnL -0.34%, best bucket 60-65
- ❌ SOLUSDT: AvgPnL -1.40% ← perlu dikaji ulang apakah tetap di SUPPORTED_PAIRS
- ⚠️ LINKUSDT: AvgPnL -0.47%
- ⚠️ DOGEUSDT: AvgPnL -0.95%

## Update 2026-06-30 — Option B (PostgreSQL OHLCV)

### Status Option B — PARTIALLY DONE
- Schema dan seed script sudah dibuat, tapi belum di-apply ke repo
- Perlu diselesaikan di sesi berikutnya

### File Yang Perlu Di-copy dari Downloads
1. `~/Downloads/ohlcv-daily.ts` → `lib/db/src/schema/ohlcv-daily.ts`
2. `~/Downloads/seed-ohlcv.ts` → `scripts/src/seed-ohlcv.ts`

### Langkah Option B Yang Belum Selesai (lanjutkan di sesi berikutnya)
1. Copy ohlcv-daily.ts ke lib/db/src/schema/
2. Tambah export ke lib/db/src/schema/index.ts:
   echo 'export * from "./ohlcv-daily";' >> lib/db/src/schema/index.ts
3. Migrasi DB: cd lib/db && pnpm drizzle-kit push
4. Copy seed-ohlcv.ts ke scripts/src/
5. Jalankan seeder: DATABASE_URL="..." tsx scripts/src/seed-ohlcv.ts
6. Patch cron.ts — tambah import db + ohlcvDaily + fungsi saveLatestDailyCandles() + export startDailySaveCron()
7. Patch index.ts — panggil startDailySaveCron() di entry point (perlu lihat isi index.ts dulu)
8. Commit semua

### Desain Tabel ohlcv_daily
- Lokasi schema: lib/db/src/schema/ohlcv-daily.ts
- Kolom: id, pair (varchar 20), timestamp_ms (bigint), open/high/low/close/volume (text), created_at
- Unique constraint: (pair, timestamp_ms)
- onConflictDoNothing() → idempotent, aman dijalankan berulang

### Struktur DB yang Sudah Diketahui
- Config: lib/db/drizzle.config.ts
- Schema index: lib/db/src/schema/index.ts (sebelumnya kosong)
- DB client: lib/db/src/index.ts (export db, pool)
- Import di api-server: from "@workspace/db"
- Dialect: postgresql (node-postgres)

### State Engine Saat Ini (setelah semua fix hari ini)
- SELL: confidence 45-55, bias BEARISH → FIRE
- BUY: DISABLED (semua bucket negatif di backtest v3)
- trend1d bug: FIXED (sekarang pakai daily EMA)
- Daily trend filter: aktif tapi data v3 menunjukkan tidak signifikan efeknya
- Backtest terbaik: SELL 45-50 (PF 1.22, AvgPnL +0.74%, 256 trades)

### Summary Semua Pekerjaan Hari Ini
- ✅ Bug fix: trend1d pakai 4H EMA → fixed ke daily EMA
- ✅ Step 1: Split BUY/SELL sweet spot → revisi lagi berdasarkan v3
- ✅ Engine: SELL 45-55, BUY disabled
- ✅ Backtest v3: paginated, time-aligned, vol approx — 2813 trades, 6 pairs, ~5 tahun
- ✅ Backtest v3 script: scripts/src/backtest-v3-paginated.ts
- ⏳ Option B: file sudah dibuat, belum di-apply ke repo

## Update 2026-06-30 — Option B PostgreSQL Setup

### Status Saat Ini
- nexus-alpha-db: PostgreSQL Free tier dibuat di Render (Singapore), belum Available
- DATABASE_URL belum di-set di environment variable nexus-alpha
- Build sudah sukses tapi runtime crash karena DATABASE_URL belum ada

### Langkah yang Sudah Selesai
- ✅ ohlcv-daily.ts schema dibuat di lib/db/src/schema/
- ✅ seed-ohlcv.ts dibuat di scripts/src/
- ✅ cron.ts: startDailySaveCron() + saveLatestDailyCandles() ditambahkan
- ✅ index.ts schema diperbaiki (hapus duplikat export)
- ✅ cron.ts diperbaiki (hapus duplikat startDailySaveCron)
- ✅ Semua di-commit dan push ke GitHub

### Langkah Berikutnya (lanjutkan di sesi berikutnya)
1. Tunggu nexus-alpha-db Available di Render
2. Copy Internal Database URL dari Connections tab
3. Set DATABASE_URL di Environment nexus-alpha → Save → redeploy
4. Jalankan drizzle-kit push dari lokal:
   cd lib/db && DATABASE_URL="..." pnpm drizzle-kit push
5. Jalankan seeder dari lokal:
   cd ~/nexus-alpha && DATABASE_URL="..." tsx scripts/src/seed-ohlcv.ts
6. Tambah startDailySaveCron() di index.ts (artifacts/api-server/src/index.ts)
7. Commit dan push

### Catatan Penting
- Free tier Render Postgres: expire 90 hari, cukup untuk development
- Internal URL dipakai untuk koneksi dari Render ke Render (lebih cepat, gratis)
- External URL dipakai untuk koneksi dari lokal MacBook (untuk drizzle-kit push dan seeder)
- drizzle-kit push BELUM dijalankan — tabel ohlcv_daily belum ada di DB

## Update 2026-06-30 — Option B SELESAI ✅

### Status Final Option B
- ✅ PostgreSQL dibuat di Render (nexus-alpha-db, Free, Singapore)
- ✅ DATABASE_URL di-set di environment nexus-alpha (Internal URL)
- ✅ Tabel ohlcv_daily dibuat via SQL langsung (drizzle-kit skip karena esbuild mismatch)
- ✅ Seeder dijalankan: 15.449 candles dari 10 pair berhasil masuk DB
- ✅ startDailySaveCron() diaktifkan di index.ts — simpan candle kemarin tiap 24h

### Catatan Teknis
- drizzle-kit push gagal karena esbuild versi mismatch (0.27.3 vs 0.28.1)
- Workaround: buat tabel langsung via node pg SQL
- External URL perlu ?sslmode=require untuk koneksi dari lokal MacBook
- Internal URL (tanpa SSL param) dipakai di Render environment variable

## Agenda Sesi Berikutnya

### TODO #1 — GoPlus Rate Limit (Priority: Medium)
- Error: GoPlus API error code 4029 (rate limit) di log meme cron
- Fix: tambah retry logic dengan exponential backoff + delay antar request
- File: artifacts/api-server/src/routes/memes.ts

### TODO #2 — Telegram Connect Timeout (Priority: High)
- Error: ConnectTimeoutError saat kirim signal ke Telegram (149.154.166.110:443)
- Fix: tambah retry logic di sendTelegram() dengan max 3x retry
- File: artifacts/api-server/src/routes/cron.ts

### TODO #3 — Forward Testing / Signal Tracker (Priority: High)
- Tujuan: validasi apakah signal yang dikirim Telegram menghasilkan profit nyata
- Rencana:
  1. Tambah tabel signal_log di PostgreSQL (pair, side, confidence, entry_price, tp, sl, timestamp)
  2. Setiap signal yang dikirim → simpan ke DB
  3. Cron harian: cek apakah TP atau SL sudah kena berdasarkan harga aktual
  4. Tampilkan win rate aktual di frontend
- Ini adalah langkah kritis sebelum pakai uang asli

### Masalah Fundamental Engine (Perlu Investigasi)
1. WR 48.8% masih di bawah 50% — hanya profitable karena TP > SL ratio
   - Jika kondisi market berubah, bisa langsung merugi
2. Backtest pakai data daily, engine pakai 4H — mismatch timeframe belum divalidasi
3. Sample kecil: hanya 256 trades di bucket terbaik (SELL 45-50) dari 5 tahun data
4. Belum ada forward testing — hasil nyata di Telegram belum pernah divalidasi
5. GoPlus + Telegram timeout menyebabkan signal kadang gagal terkirim

### Rekomendasi Sebelum Pakai Uang Asli
- Paper trading dulu: catat setiap signal Telegram, cek manual TP/SL
- Kumpulkan minimal 50-100 trade nyata
- Target yang layak: WR >= 52%, AvgPnL >= 1%, PF >= 1.3 dari forward test
- Jangan gunakan uang asli sampai forward test menunjukkan profitabilitas konsisten

## Sesi 2026-06-30 (lanjutan) — TODO #3 Forward Testing SELESAI ✅

### Yang Sudah Dikerjakan
- Tabel baru `signal_log` dibuat di PostgreSQL (via Node pg langsung, sama seperti ohlcv_daily)
  - Kolom: id, pair, side, confidence, entry_price, sl, tp1, tp2, tp3, status, closed_price, closed_at, sent_at
  - Schema Drizzle: lib/db/src/schema/signal-log.ts
- cron.ts dipatch:
  - Bug duplikat import (db, ohlcvDaily 2x) — FIXED ✓
  - saveSignalToLog() — setiap signal yang dikirim ke Telegram otomatis tersimpan ke signal_log — DONE ✓
  - checkOpenSignals() — cron baru tiap 15 menit, cek harga real dari Bybit, update status OPEN → TP1_HIT/TP2_HIT/TP3_HIT/SL_HIT — DONE ✓
  - startSignalCheckCron() dipanggil di index.ts — DONE ✓
  - Endpoint baru: GET /api/cron/results — kasih ringkasan win rate dari signal yang sudah closed — DONE ✓
- Bug duplikat signal ditemukan & di-fix:
  - Masalah: cron scan tiap 10 menit menyimpan signal yang SAMA berkali-kali kalau kondisi market belum berubah (cth: SOLUSDT SELL tersimpan 2x dalam 10 menit, harga nyaris sama)
  - Fix: saveSignalToLog() sekarang cek dulu — skip kalau pair+side yang sama masih OPEN/TP1_HIT/TP2_HIT — DONE ✓
- Live test pertama (sebelum fix duplikat): SOLUSDT, XRPUSDT, AVAXUSDT semua SELL, semua tersimpan dengan benar ke DB

### State Saat Ini
- Forward testing AKTIF di production — semua signal SELL yang terkirim Telegram otomatis tercatat dan akan otomatis dicek TP/SL-nya
- Belum ada signal yang closed (semua masih OPEN, baru mulai hari ini)
- Cara cek hasil: GET https://nexus-alpha-j3yb.onrender.com/api/cron/results

### PENTING — Jangan Pakai Uang Asli Dulu
- Data forward test baru mulai dikumpulkan hari ini (2026-06-30), masih 0 trade closed
- Tunggu minimal 50-100 trade closed (TP3_HIT atau SL_HIT) sebelum menyimpulkan apa-apa
- Target kelayakan: WR >= 52%, AvgPnL >= 1%, PF >= 1.3 (sesuai rekomendasi sebelumnya)
- JANGAN ambil kesimpulan dari sample kecil (<20 trade) — risiko overfitting ke kebetulan jangka pendek

### Belum Dikerjakan (lanjutkan nanti)
- TODO #1: GoPlus Rate Limit (code 4029) — masih muncul di log, belum di-fix, tidak blocking
- TODO #2: Telegram Connect Timeout — belum dikerjakan
- Frontend belum nampilin data signal_log / win rate (baru endpoint API mentah)

## Sesi 2026-06-30 (lanjutan 2) — TODO #2 Telegram Retry SELESAI ✅

### Yang Sudah Dikerjakan
- Tambah fungsi sendWithRetry() generik di cron.ts — retry max 3x dengan jeda 2s/4s antar percobaan
- sendTelegram() dan sendMemeTelegram() sekarang pakai sendWithRetry()
- Tujuan: atasi ConnectTimeoutError ke Telegram (149.154.166.110:443) yang sebelumnya langsung gagal tanpa retry

### Cara Verifikasi
- Cek log Render: kalau timeout terjadi, akan muncul "[TELEGRAM] ⚠️ Percobaan X/3 gagal" lalu "✅ Berhasil setelah retry ke-X"
- Kalau gagal total 3x, muncul "[TELEGRAM] ❌ Gagal total setelah 3x percobaan" — ini sinyal Telegram API benar-benar down

### Belum Dikerjakan
- TODO #1: GoPlus Rate Limit (code 4029) — masih muncul di log, belum di-fix, tidak blocking

## Sesi 2026-06-30 (lanjutan 3) — TODO #1 GoPlus Rate Limit: DIVERIFIKASI, TIDAK PERLU FIX

### Hasil Investigasi
- Kode gpFetchWithRetry() di memes.ts SUDAH punya retry robust: 4x percobaan, backoff 1.2s/2.4s/4.8s, deteksi error 4029 (bukan cuma HTTP 429)
- Ada juga "second pass" retry sekuensial untuk token yang masih gagal di percobaan pertama
- Test nyata: panggil /api/ai/memes, cek 20 coin hasil scan — 0 dari 20 punya data security kosong
- Kesimpulan: error 4029 di log Render adalah retry yang SEDANG bekerja, bukan kegagalan akhir. Tidak ada dampak ke akurasi data.

### Keputusan
- TODO #1 DITUTUP — tidak perlu patch tambahan, sistem sudah robust dan terverifikasi dengan data real
- Kalau nanti suatu saat ditemukan coin dengan security kosong di hasil scan, baru diinvestigasi ulang

## Sesi 2026-06-30 (lanjutan 4) — Meme Coin Forward Testing DIBUAT ✅

### Tujuan
- Menjawab jujur (dengan data, bukan asumsi): apakah early-gem scoring di memes.ts benar-benar bisa mendeteksi coin yang viral/meledak, atau tidak
- PENTING: ini BUKAN alat untuk "menemukan next DOGE/SHIB" — ini alat UKUR apakah scoring yang sudah ada efektif. Realita: coin yang benar2 viral ribuan % itu sangat langka (outlier), mayoritas meme coin gagal/rug pull.
- XRP TIDAK relevan untuk scanner ini — itu coin lama/established, beda kategori dengan "early gem meme coin baru"

### Yang Dibangun
- Tabel baru `meme_signal_log` (lib/db/src/schema/meme-signal-log.ts) — dibuat di DB via Node pg langsung
  - Kolom kunci: initial_price, ath_price, ath_multiplier (harga tertinggi / harga awal), status (TRACKING/DEAD/STOPPED)
- cron.ts dipatch:
  - saveMemeSignalToLog() — simpan coin yang ditandai GEM/PUMP_IMMINENT setelah alert Telegram terkirim, skip kalau masih TRACKING
  - fetchDexScreenerData() — ambil harga/liquidity/mcap terbaru by contract address
  - checkMemeSignals() — cron tiap 6 jam, update ATH multiplier tiap coin TRACKING; liquidity < $1000 → DEAD (kemungkinan rug pull); umur > 60 hari → STOPPED
  - startMemeSignalCheckCron() dipanggil di index.ts — DONE ✓
  - Endpoint baru: GET /api/cron/meme-results — ringkasan % coin yang tembus 2x/5x/10x, % DEAD, top performers

### State Saat Ini
- Forward testing meme coin BARU MULAI hari ini (2026-06-30), 0 data historis
- Butuh waktu MINGGUAN-BULANAN untuk dapat hasil yang berarti (beda dengan signal trading yang bisa dilihat dalam hitungan hari)
- Cara cek hasil: GET https://nexus-alpha-j3yb.onrender.com/api/cron/meme-results

### PENTING — Jangan Ambil Kesimpulan Terlalu Cepat
- Sample kecil (<30-50 coin tracked) tidak cukup untuk menyimpulkan apakah scoring efektif
- Realistis: mayoritas meme coin akan berakhir DEAD/gagal, itu NORMAL untuk kategori aset ini, bukan berarti scoring-nya salah
- Tujuan akhir: tahu apakah probabilitas "menang" dari sistem ini lebih baik dari acak, bukan menjamin menemukan gem

### Agenda Tertunda
- Rotate password database PostgreSQL (sempat di-expose di chat beberapa kali) — PENDING, prioritas keamanan
- Meme alert volume tinggi (11 alert sekaligus dalam 1 scan) — perlu dipertimbangkan apakah threshold perlu diperketat

## Verifikasi Live 2026-06-30 (setelah deploy meme forward testing)
- [MEME-CHECK] cron 6 jam aktif dan jalan normal — DONE ✓
- [SIGNAL-LOG] anti-duplikat TERBUKTI bekerja di production: SOLUSDT/XRPUSDT/AVAXUSDT signal yang sama berhasil di-skip dari pencatatan dobel, tapi tetap terkirim ke Telegram seperti biasa — DONE ✓

## Update Keamanan 2026-06-30 — SELESAI ✅
- Password database di-rotate via Render Dashboard (kredensial baru: nexusalphadb_u6z5_user)
- DATABASE_URL di environment variable nexus-alpha (backend) sudah diupdate ke kredensial baru
- Verifikasi: backend redeploy sukses, semua cron (DAILY-SAVE, SIGNAL-LOG, MEME-CHECK) jalan normal tanpa error koneksi
- Kredensial lama (nexus_alpha_db_user) sudah DIHAPUS dari Render — password lama yang sempat ter-paste di chat sekarang tidak berguna lagi
- Topik keamanan database DITUTUP

## Penutup Sesi 2026-06-30 — Dashboard + Cleanup

### Dashboard Forward Test — DONE ✅
- Endpoint baru: GET /api/cron/dashboard — halaman HTML visual, auto-refresh 60 detik
- Menampilkan ringkasan + tabel detail untuk signal trading dan meme coin tracker
- Tidak mengubah frontend React utama — terpisah aman di backend

### Insiden & Fix: DATABASE_URL belum terupdate setelah rotate password
- Setelah rotate password DB, env var DATABASE_URL di service nexus-alpha sempat belum diupdate ke kredensial baru
- Akibat: /api/cron/results dan /api/cron/meme-results sempat error 500 ("role nexus_alpha_db_user is not permitted to log in") karena masih pakai username lama yang sudah dihapus
- Fix: DATABASE_URL diupdate ke kredensial baru (nexusalphadb_u6z5_user), redeploy, semua normal kembali
- PELAJARAN untuk sesi berikutnya: setiap kali rotate DB credential, WAJIB cross-check env var DATABASE_URL di SEMUA service yang connect ke DB (bukan cuma database-nya sendiri) sebelum hapus kredensial lama

### Cleanup Data Duplikat (sisa dari sebelum fix anti-duplikat live)
- 6 baris signal_log duplikat (entry SOLUSDT/XRPUSDT/AVAXUSDT yang sama, tercatat 3x sebelum fix anti-duplikat aktif) dihapus manual via SQL
- Tersisa 3 signal unik, semua status OPEN, menunggu TP/SL
- Tidak ada duplikat lagi sejak fix anti-duplikat live (dikonfirmasi dari log: "[SIGNAL-LOG] ⏭️ Skip" muncul normal sejak ~jam 02:58)

### State Akhir Hari Ini (2026-06-30)
- Forward testing signal trading: AKTIF, 3 signal OPEN (SOLUSDT, XRPUSDT, AVAXUSDT, semua SELL)
- Forward testing meme coin: AKTIF, 18 coin TRACKING, 1 coin (AIB) sudah ATH x1.40
- Dashboard visual: LIVE di /api/cron/dashboard
- Database credential: sudah dirotate, kredensial lama dihapus, env var sudah sinkron
- Keputusan user: tidak perlu hindari paste connection string di chat untuk project ini (personal project)

### Belum Dikerjakan / Agenda Selanjutnya
- Pantau hasil forward test beberapa hari-minggu ke depan (jangan ambil kesimpulan dari sample kecil)
- Meme alert volume tinggi (11 alert sekaligus per scan) — pertimbangkan perketat threshold kalau dirasa kebanyakan
- Frontend React utama belum nampilkan data signal_log/meme_signal_log secara native (dashboard sementara via /api/cron/dashboard sudah cukup untuk sekarang)

## Bug Fix 2026-06-30 — Web App "Generate Pro Signal" gagal untuk XRP/DOGE/AVAX

### Penyebab
- Web app NexusAlpha (nexus-alpha-api-server.vercel.app/signals) pakai endpoint terpisah: POST /api/ai/signal (AI-generated, beda dari cron rule-based engine yang ke Telegram)
- Endpoint ini validasi pair lewat SYMBOL_TO_ID (di binance.ts) dan PAIR_TO_OKX (di ai.ts) — DUA map terpisah yang harus manual diupdate
- Waktu SUPPORTED_PAIRS diupdate (tambah XRP/DOGE/AVAX, hapus ZEC/ASTER) di sesi sebelumnya, SYMBOL_TO_ID dan PAIR_TO_OKX TIDAK ikut terupdate
- Akibat: pilih XRP/DOGE/AVAX di web app → "Failed to generate AI signal" (request ditolak di awal karena unsupported pair)

### Fix — DONE ✓
- SYMBOL_TO_ID (binance.ts): tambah XRPUSDT→ripple, DOGEUSDT→dogecoin, AVAXUSDT→avalanche-2; hapus ASTERUSDT/ZECUSDT
- PAIR_TO_OKX (ai.ts): tambah XRPUSDT→XRP, DOGEUSDT→DOGE, AVAXUSDT→AVAX; hapus ASTERUSDT/ZECUSDT
- Catatan: data source untuk endpoint ini SUDAH pakai OKX (primer) + CoinGecko (fallback) — BUKAN Binance lagi meskipun nama filenya binance.ts. Catatan lama soal "Binance 418 ban" sudah tidak relevan untuk file ini.

### PENTING — Untuk Penambahan/Perubahan Pair di Masa Depan
Kalau nanti SUPPORTED_PAIRS diubah lagi, WAJIB cek & update semua tempat ini bersamaan (jangan cuma satu):
1. artifacts/nexusalpha/lib/types.ts — TradingPair type + SUPPORTED_PAIRS array
2. artifacts/api-server/src/routes/binance.ts — SYMBOL_TO_ID (untuk CoinGecko fallback ID)
3. artifacts/api-server/src/routes/ai.ts — PAIR_TO_OKX (untuk funding rate/OKX data) dan SYMBOL_TO_ID import (dipakai validasi /ai/signal)
4. Cron rule-based engine (cron.ts, signal-engine-realtime.ts) pakai SUPPORTED_PAIRS langsung dari types.ts — otomatis ikut, TIDAK perlu diubah terpisah

## Penutup Sesi 2026-06-30 (final) — Konsistensi Signal & Anti-Spam Telegram

### Masalah yang Ditemukan User
1. Web app (Gemini AI) dan Telegram (rule-based) kasih hasil BERBEDA untuk pair yang sama — membingungkan
2. Telegram tetap kirim notifikasi berulang untuk sinyal yang sama meski anti-duplikat DB sudah aktif (karena anti-duplikat itu cuma cegah simpan dobel ke DB, bukan cegah kirim Telegram ulang)

### Fix — DONE ✓ (terverifikasi live di production)
1. **Cooldown Telegram**: cron.ts sekarang cek dulu apakah pair+side masih ada signal OPEN/TP1_HIT/TP2_HIT di signal_log SEBELUM kirim Telegram. Kalau masih ada → skip total (tidak kirim, tidak proses lebih lanjut). Verified log: "[CRON] ⏭️ Skip kirim Telegram XRPUSDT SELL — masih ada signal OPEN (id #2)"
2. **Web app pakai otak yang sama dengan Telegram**: endpoint POST /api/ai/signal di ai.ts SUDAH TIDAK PAKAI GEMINI lagi. Sekarang manggil computeRealtimeSignal() dari signal-engine-realtime.ts (sama persis dengan cron). Response time turun drastis dari ~beberapa detik (Gemini) ke ~240ms (rule-based) — bukti konkret perubahan berhasil.
3. Kode Gemini lama di ai.ts TIDAK dihapus, hanya jadi dead code (tidak pernah tereksekusi karena ada early return). Aman dihapus nanti kalau sudah yakin tidak dibutuhkan lagi.

### State Akhir
- SATU sumber kebenaran sekarang: signal-engine-realtime.ts dipakai oleh CRON (Telegram) DAN web app (/api/ai/signal) — tidak ada lagi inkonsistensi
- Telegram tidak lagi spam — sinyal yang sama hanya dikirim sekali sampai closed (TP/SL kena)
- Gemini AI (@workspace/integrations-gemini-ai) masih ter-install tapi sudah tidak dipakai untuk /ai/signal — bisa dipertimbangkan dihapus dependency-nya di masa depan kalau tidak ada fitur lain yang masih pakai

### Ringkasan Penuh Hari Ini (2026-06-30)
1. Forward testing signal trading (signal_log) — DONE, aktif
2. Telegram retry logic — DONE, aktif
3. GoPlus rate limit — diverifikasi sudah robust, tidak perlu fix
4. Forward testing meme coin (meme_signal_log) — DONE, aktif, 19 coin tracked
5. Dashboard visual (/api/cron/dashboard) — DONE, live
6. Database password rotation — DONE, kredensial lama dihapus
7. Data duplikat signal_log — dibersihkan
8. Bug fix: pair XRP/DOGE/AVAX gagal di web app AI signal (SYMBOL_TO_ID/PAIR_TO_OKX belum diupdate) — FIXED
9. Cooldown Telegram + unifikasi otak web app+Telegram — DONE

### Agenda Selanjutnya
- Pantau hasil forward test signal & meme coin beberapa hari-minggu ke depan
- Pertimbangkan hapus dependency Gemini AI kalau tidak dipakai fitur lain
- Meme alert volume — pantau apakah masih terlalu banyak per scan

## Sesi 2026-07-02 — Cek Forward Test + Dashboard PnL

### Status Forward Test Saat Ini
- Signal trading: 6 signal OPEN (LINKUSDT, ETHUSDT, SUIUSDT, AVAXUSDT, XRPUSDT, SOLUSDT), 0 closed
- Meme coin: 47 coin tracked, PnL sekarang -$1,284.75 dari $4,700 modal virtual
  - Hanya 2.1% coin yang tembus ≥2x, 0% yang ≥5x atau ≥10x
  - PnL ATH terbaik +$581.19 (kalau sempat jual di harga tertinggi tiap coin)
  - Mayoritas coin merugi dalam 2 hari pertama — ini konfirmasi awal bahwa threshold GEM terlalu longgar

### Yang Dikerjakan Hari Ini
- Dashboard paper trading: tambah kolom PnL per trade (realized + unrealized) dan meme coin — DONE ✓
- Unrealized PnL real-time untuk signal OPEN (berdasarkan harga pasar via /api/binance/tickers) — DONE ✓, sudah di-push, menunggu Render deploy
- Fix pair XRP/DOGE/AVAX gagal di web app AI signal — DONE ✓ (sesi sebelumnya)
- Cooldown Telegram + unifikasi web app dengan rule-based engine — DONE ✓ (sesi sebelumnya)

### Observasi Penting Meme Coin
- Scanner sekarang bereaksi SETELAH coin sudah listed di GeckoTerminal/DexScreener — bukan early detection sesungguhnya
- Coin yang benar-benar "early gem" biasanya sudah naik 5-20x sebelum masuk agregator data
- Kemungkinan yang terdeteksi sekarang adalah coin di fase distribusi (smart money jual ke pembeli baru)
- Diskusi soal perbaikan meme scanner DITUNDA — tunggu data 2-3 minggu dulu sebelum ubah threshold
- Opsi perbaikan yang dibahas: perketat filter (lebih sedikit coin, lebih selektif) vs monitor social media untuk narrative awal (butuh API berbayar)

### BTC Tidak Keluar Sinyal
- BTC confidence selalu 57-61 (NEUTRAL/BEARISH) — di luar sweet spot SELL 45-55
- Engine menilai kondisi BTC belum cukup kuat untuk entry — ini NORMAL, bukan bug
- Perlu divalidasi dari forward-test: apakah engine terlalu ketat untuk BTC atau memang kondisi market jarang masuk zona teruji

### Agenda Selanjutnya
- Pantau dashboard tiap 2-3 hari, beri pembacaan awal setelah 15-20 trade closed
- Setelah 2-3 minggu data meme coin terkumpul, evaluasi ulang threshold GEM (apakah perlu diperketat)
- Diskusi lanjutan soal early detection meme coin yang lebih akurat

## Update 2026-07-02 — Dashboard PnL Real-Time SELESAI ✅

### Fix Unrealized PnL
- Bug: /api/binance/tickers (plural) return [] karena koma di URL ter-encode saat fetch dari JS
- Fix: ganti fetch ke /api/binance/ticker (singular) per pair secara paralel — DONE ✓
- Dashboard sekarang tampilkan unrealized PnL real-time berdasarkan harga pasar: "+$1.00 (+1.00%) @ $7.46"

### Snapshot Posisi Saat Ini (2026-07-02, ~15:22 WIB)
- LINKUSDT SELL entry $7.535 → +$1.00 (+1.00%) @ $7.46 (profit tipis)
- ETHUSDT SELL entry $1628.45 → +$0.70 (+0.70%) @ $1617.11 (profit tipis)
- SUIUSDT SELL entry $0.7149 → -$1.63 (-1.63%) @ $0.72656 (rugi)
- AVAXUSDT SELL entry $6.645 → -$0.38 (-0.38%) @ $6.67 (rugi tipis)
- XRPUSDT SELL entry $1.0487 → -$0.98 (-0.98%) @ $1.059 (rugi)
- SOLUSDT SELL entry $74.32 → -$5.10 (-5.10%) @ $78.11 (rugi terbesar)
- Catatan: SOLUSDT merugi -5.10% → SOL naik dari $74 ke $78, engine SELL ternyata salah arah untuk ini

## Sesi 2026-07-02 (lanjutan) — DexScreener Early Radar

### Status Implementasi: IN PROGRESS (belum di-push)

### Rancangan DexScreener Early Radar
- Tujuan: deteksi token yang sedang aktif marketing SEBELUM masuk GeckoTerminal/meme scanner biasa
- Sumber data:
  - DexScreener Token Boosts (/token-boosts/latest/v1) — token yang bayar untuk di-boost
  - DexScreener Token Profiles (/token-profiles/latest/v1) — token yang baru pasang social profile
- Logika: crossmatch kedua list → kalau token yang sama muncul di KEDUANYA = sinyal aktif launch/marketing
- Filter tambahan: harus punya Twitter atau website, chain harus supported (solana/ethereum/bsc/base/arbitrum/polygon)
- Alert ke Telegram meme coin channel dengan label "🔍 EARLY RADAR" (beda dari label GEM biasa)
- Cooldown: 1 jam per token address
- Interval: tiap 15 menit (sama dengan meme scan)

### Test API (VERIFIED ✅)
- DexScreener Boosted: ✅ return 30 token, struktur {tokenAddress, chainId, url, links, totalAmount}
- DexScreener Token Profiles: ✅ return 30 token, struktur {tokenAddress, chainId, url, description, links, cto}
- Reddit r/CryptoMoonShots: ❌ DIBLOKIR — tidak bisa dipakai tanpa API key berbayar

### Yang Belum Dikerjakan (lanjutkan sesi berikutnya)
1. Jalankan patch cron.ts untuk tambah fungsi startDexRadarCron()
2. Patch index.ts untuk panggil startDexRadarCron()
3. Commit & push ke GitHub
4. Verifikasi log Render: "[DEX-RADAR] DexScreener early radar started"
5. Pantau apakah ada crossmatch alert yang terkirim ke Telegram

### Catatan Penting
- DexScreener Boosted = token yang BAYAR untuk promosi, bukan sinyal organik murni
- Justru berguna: team yang keluar uang untuk boost biasanya sedang aktif marketing
- Crossmatch Boosted+Profiles lebih "early" dari GeckoTerminal karena DexScreener update lebih cepat
- SANGAT SPEKULATIF — belum ada validasi profit/loss, ini eksperimen deteksi awal
- Jangan gunakan untuk uang asli sampai ada data forward-test yang cukup (sama seperti signal trading)

### Kode Yang Sudah Disiapkan (tinggal dijalankan)
- Fungsi: runDexRadarScan(), fetchDexScreenerBoosted(), fetchDexScreenerProfiles(), startDexRadarCron()
- File: artifacts/api-server/src/routes/cron.ts (patch Python sudah siap, belum dijalankan)
- File: artifacts/api-server/src/index.ts (patch Python sudah siap, belum dijalankan)

### Command Untuk Lanjutkan Di Sesi Berikutnya
Jalankan patch cron.ts dulu:
  python3 << patch script dari sesi ini >>
Cek syntax:
  node --check artifacts/api-server/src/routes/cron.ts
Patch index.ts:
  python3 << patch script dari sesi ini >>
Commit & push:
  git add artifacts/api-server/src/routes/cron.ts artifacts/api-server/src/index.ts
  git commit -m "Add DexScreener early radar: crossmatch Boosted+Profiles for pre-hype token detection"
  git push

## Sesi 2026-07-03 — Bug Fix + DexScreener Radar + Dashboard Link

### Yang Dikerjakan
- Fix duplikat startDexRadarCron di cron.ts (build error) — FIXED ✓
- Sanity check anomali harga meme coin: kalau athMultiplier > 500x kemungkinan bug DexScreener (denominasi ETH bukan USD) → skip update — DONE ✓
- Reset data corrupt TAIKO (x11324 → x1.00) di database — DONE ✓
- Tambah kolom dex_url ke tabel meme_signal_log di DB dan schema Drizzle — DONE ✓
- Isi dex_url otomatis dari contract_address + network untuk semua coin existing — DONE ✓
- Dashboard: tambah kolom Chart dengan link DexScreener per coin — DONE ✓
- saveMemeSignalToLog() sekarang simpan dexUrl dari coin.dexUrl — DONE ✓

### Konfirmasi Masalah Fundamental Meme Scanner
- TERBUKTI dari data: coin banyak terdeteksi SETELAH pump tinggi — scanner reaktif, bukan predictive
- GeckoTerminal baru index pool setelah ada volume/liquidity signifikan = pump awal sudah terjadi
- DexScreener Early Radar (baru deploy) diharapkan lebih awal — belum ada data forward-test

### DexScreener Early Radar — Status
- Sudah live di production (startDexRadarCron aktif, interval 15 menit)
- Logika: crossmatch Token Boosts + Token Profiles → alert ke Telegram meme channel dengan label "🔍 EARLY RADAR"
- Filter: harus punya Twitter atau website, chain supported (solana/eth/bsc/base/arbitrum/polygon)
- Cooldown: 1 jam per token address
- Belum ada data forward-test — pantau beberapa hari ke depan

### Agenda Selanjutnya
- Pantau DexScreener Early Radar: apakah crossmatch alerts yang masuk ke Telegram benar-benar lebih early dari GeckoTerminal scanner
- Evaluasi meme scanner setelah 2-3 minggu data: threshold GEM kemungkinan perlu diperketat
- Pantau signal trading forward-test — belum ada yang closed (semua masih OPEN)

## Agenda Berikutnya — Whale/Smart Wallet Tracker (PLANNED, belum dimulai)

### Keputusan
- Target chain: Solana + Ethereum/BSC (keduanya)
- Pendekatan: bangun otomatis dari data historis (lebih akurat, lebih kompleks)
- Saran Claude: mulai dengan hybrid approach (fase 1: seed wallet publik dulu, fase 2: auto-scoring, fase 3: full historical analysis)

### Rencana Fase 1 (prioritas berikutnya)
- Seed 20-30 wallet smart money yang sudah dikenal publik (dari gmgn.ai, Twitter research)
- API yang akan ditest: Helius (Solana, free tier 100k credit/bulan), Etherscan (Ethereum, free 5 req/detik)
- Monitor transaksi tiap 15-30 menit → alert Telegram kalau ada wallet beli token baru
- Simpan ke tabel baru: wallet_watchlist (address, chain, label, win_rate) dan whale_alerts (wallet, token, chain, amount, timestamp)

### Yang Perlu Dilakukan Sebelum Mulai Kode
1. Test Helius API: daftar di helius.dev untuk dapat API key gratis
2. Test Etherscan API: daftar di etherscan.io untuk dapat API key gratis
3. Research 20-30 smart wallet addresses yang sudah dikenal (gmgn.ai → filter by PnL)
4. Baru mulai implementasi setelah API key tersedia dan wallet list siap

### Catatan Penting
- Ini fitur paling kompleks yang pernah dibangun di NexusAlpha — estimasi 5-10 sesi
- Jangan mulai sampai forward-test signal trading punya minimal 15-20 trade closed
- Infrastruktur Render free tier mungkin perlu di-upgrade untuk fase 3 (historical analysis)

## Sesi 2026-07-03 (lanjutan) — Whale/Smart Money Tracker (GMGN) — TAHAP 1 DONE

### Keputusan Desain
- TIDAK riset manual 20-30 wallet — dipakai fitur `gmgn-cli track smartmoney` dari GMGN
  yang sudah mengklasifikasikan sendiri wallet "smart money" berdasarkan track record
  mereka di platform GMGN. Sumber data terverifikasi dari dokumentasi resmi:
  https://github.com/GMGNAI/gmgn-skills/blob/main/docs/cli-usage.md
- Alasan: lebih real-time, tidak perlu manual maintenance daftar wallet.

### Yang Sudah Dibuat (belum di-deploy, menunggu langkah selanjutnya)
- Schema: lib/db/src/schema/whale-alerts.ts (tabel whale_alerts)
- Export ditambahkan ke lib/db/src/schema/index.ts
- Script buat tabel: scripts/src/create-whale-alerts-table.ts (idempotent, IF NOT EXISTS)
- cron.ts dipatch:
  - Konstanta WHALE_TELEGRAM_API, WHALE_CHAT_ID (dari env WHALE_TELEGRAM_BOT_TOKEN, WHALE_TELEGRAM_CHAT_ID)
  - sendWhaleTelegram() — kirim pesan pakai sendWithRetry() yang sudah ada
  - fetchGmgnSmartMoney(chain) — panggil `npx gmgn-cli track smartmoney --chain <chain> --side buy --limit 30 --raw` via child_process, parse JSON
  - runWhaleScan() — loop chain sol & eth, filter cooldown 30 menit per wallet+token, kirim Telegram + simpan ke whale_alerts
  - startWhaleCron() — interval 15 menit
- index.ts: import & panggil startWhaleCron() di app.listen()
- package.json api-server: tambah dependency "gmgn-cli": "^1.5.0" (versi asli dicek dari npm registry, bukan tebakan)

### Environment Variables Baru yang PERLU di-set di Render
- GMGN_API_KEY = gmgn_407b853bad4c7f57945e16ab2ddf2713
- WHALE_TELEGRAM_BOT_TOKEN = 8600452403:AAEiXLbLg9xDCTISZCI0UFm50K-HR-Y5j-U
- WHALE_TELEGRAM_CHAT_ID = 305425021

### Belum Dikerjakan (lanjutkan sesi berikutnya)
1. Jalankan scripts/src/create-whale-alerts-table.ts dari lokal (buat tabel di DB)
2. Set 3 env variable di atas ke Render dashboard
3. Commit & push kode ke GitHub, tunggu Render auto-deploy
4. Cek log Render: cari "[WHALE] Whale/smart money tracker started"
5. Pantau apakah alert masuk ke Telegram Whale channel
6. Kalau gmgn-cli error di log (auth/format berubah), evaluasi ulang — JANGAN asumsikan asal jalan
7. PENTING: catatan ada endpoint LAMA /api/ai/whales yang generate data whale PAKAI GEMINI AI
   (bukan data asli) — berpotensi data halusinasi. Belum didiskusikan apakah masih dipakai
   frontend atau perlu dihapus/diganti dengan data whale_alerts yang asli.
8. Belum ada checkMemeSignals-style cron untuk update ATH/status whale_alerts (forward-test)
   — perlu dibuat mirip checkMemeSignals() supaya bisa evaluasi performa whale tracker.
9. Belum ada dashboard section untuk whale_alerts di /api/cron/dashboard
10. GMGN_PRIVATE_KEY TIDAK di-set (sengaja) — kita hanya butuh READ, bukan trading otomatis

### Catatan Penting — Verifikasi, Bukan Asumsi
- Command gmgn-cli yang dipakai sudah diverifikasi dari dokumentasi resmi GitHub GMGNAI/gmgn-skills,
  bukan tebakan endpoint. TAPI belum pernah dites langsung (sandbox kerja tidak bisa akses gmgn.ai).
  Testing sesungguhnya baru bisa dilakukan setelah deploy ke Render — WAJIB cek log untuk pastikan
  sukses, jangan asumsikan otomatis benar.

## Sesi 2026-07-03 (lanjutan) — Deploy Whale Tracker: TROUBLESHOOTING LOCKFILE (BELUM SELESAI)

### Status Saat Ini
- Kode whale tracker (schema, cron.ts, index.ts) SUDAH benar dan sudah ter-push ke GitHub
- Deploy ke Render BERULANG KALI GAGAL karena masalah pnpm-lock.yaml tidak sinkron dengan berbagai package.json
- Sudah diperbaiki bertahap: root package.json, lib/db/package.json, scripts/package.json — masing-masing sempat outdated

### Masalah Terakhir yang Sedang Diperbaiki (BELUM SELESAI — lanjutkan di sini)
- Error baru: `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: @google/genai@1.52.0`
- Ini terjadi karena versi pnpm baru butuh approval eksplisit untuk package yang punya build script (security feature)
- @google/genai ini dependency Gemini AI yang statusnya SUDAH DEAD CODE (tidak dipakai lagi untuk /ai/signal, lihat sesi 2026-06-30)
- Fix yang SEDANG dijalankan (user diminta jalankan, belum ada konfirmasi hasil):
  ```bash
  cd ~/nexus-alpha
  python3 << 'PYEOF'
  import json
  path = "package.json"
  with open(path) as f:
      data = json.load(f)
  if "pnpm" not in data:
      data["pnpm"] = {}
  data["pnpm"]["onlyBuiltDependencies"] = ["@google/genai"]
  with open(path, "w") as f:
      json.dump(data, f, indent=2)
      f.write("\n")
  print("✅ package.json diperbaiki")
  PYEOF
  cat package.json | head -20
  ```
  Lalu:
  ```bash
  rm -rf node_modules pnpm-lock.yaml
  pnpm install
  git status --short pnpm-lock.yaml package.json
  ```

### LANGKAH SELANJUTNYA (lanjutkan sesi berikutnya)
1. Cek hasil `cat package.json | head -20` — pastikan field `"pnpm": {"onlyBuiltDependencies": ["@google/genai"]}` masuk dengan benar
2. Cek hasil `git status --short pnpm-lock.yaml package.json` — HARUS cuma 2 file itu yang berubah (bukan node_modules)
3. Kalau bersih: `git diff package.json` dulu untuk verifikasi, baru:
   ```bash
   git add pnpm-lock.yaml package.json
   git commit -m "Approve @google/genai build script to fix pnpm ignored-builds error"
   git push
   ```
4. Tunggu Render redeploy, cek Logs tab — cari "Build succeeded" dan "[WHALE] Whale/smart money tracker started"
5. KALAU MASIH ADA package.json lain yang mismatch lagi (pola error yang sama berulang: "specifiers in the lockfile don't match..."), REPEAT proses yang sama:
   - `git diff <file>.json` untuk lihat apa yang berubah
   - Kalau perubahan itu file dependency asing/tidak diminta (misal ada versi macOS-specific atau package tidak dikenal) → `git checkout -- <file>` dulu untuk buang, baru cek ulang
   - Kalau perubahan itu legit (misal cuma nomor versi beda tipis) → biarkan, lanjut commit
   - Selalu regenerate dengan `rm -rf node_modules pnpm-lock.yaml && pnpm install` sebelum commit final, supaya SEMUA package.json dan lockfile benar-benar sinkron sekali jalan

### PENTING — Root Cause Masalah Ini
- Project ini sepertinya SERING dikerjakan dari mesin/sesi Claude Code berbeda-beda dengan cache pnpm lokal yang beda-beda, menyebabkan pnpm-lock.yaml sering "kebawa" perubahan kecil tidak disengaja
- Solusi jangka panjang (TODO nanti, bukan sekarang): pastikan tiap sesi kerja SELALU `git pull` dulu sebelum mulai edit, dan SELALU cek `git status` sebelum commit supaya tidak ada file tidak sengaja ikut ter-commit
- node_modules SEHARUSNYA di .gitignore tapi ternyata ada isi node_modules yang ke-track di git (lihat banyak sekali " M node_modules/..." di git status sepanjang sesi ini) — ini bug lama di repo, TIDAK diperbaiki sesi ini karena high-risk, hanya dihindari dengan cara TIDAK PERNAH `git add node_modules` atau `git add .`, SELALU add file spesifik satu-satu

### Environment Variables yang MASIH PERLU di-set di Render (belum dikerjakan, tunggu deploy sukses dulu)
- GMGN_API_KEY = gmgn_407b853bad4c7f57945e16ab2ddf2713
- WHALE_TELEGRAM_BOT_TOKEN = 8600452403:AAEiXLbLg9xDCTISZCI0UFm50K-HR-Y5j-U
- WHALE_TELEGRAM_CHAT_ID = 305425021

### Command Untuk Lanjut Sesi Berikutnya (copy-paste langsung)
```bash
cd ~/nexus-alpha
cat package.json | head -20
git status --short pnpm-lock.yaml package.json
```
Baru lanjutkan dari situ sesuai LANGKAH SELANJUTNYA di atas.

## Sesi 2026-07-04 — Deploy Whale Tracker: LOCKFILE FIXED, DEPLOY SUKSES ✓

### Root Cause Sebenarnya (bukan yang diduga sesi sebelumnya)
- Field `"pnpm": {"onlyBuiltDependencies": [...]}` di `package.json` **TIDAK BERGUNA** di pnpm v11 —
  field itu sudah dipindah lokasinya oleh pnpm v11, package.json tidak dibaca lagi untuk setting ini.
  pnpm v11 kasih WARNING soal ini kalau field itu ada, tapi tetap jalan (diabaikan diam-diam).
- Lokasi setting yang BENAR untuk pnpm v11: file `pnpm-workspace.yaml`, field `allowBuilds`
  (bukan `onlyBuiltDependencies` lagi — nama field-nya juga berubah).
- Saat `pnpm install` dijalankan, pnpm OTOMATIS menambahkan entry baru ke `pnpm-workspace.yaml`
  untuk dependency yang build script-nya di-skip, tapi dengan nilai **`false`** (placeholder,
  artinya "tetap diblokir") — bukan `true`. Harus diubah manual jadi `true` untuk approve.

### Fix yang Berhasil — DONE ✓
1. Revert perubahan `package.json` (field `pnpm.onlyBuiltDependencies` dibuang, karena percuma) —
   `git checkout -- package.json`
2. Edit `pnpm-workspace.yaml`, ubah baris yang pnpm auto-generate:
   `'@google/genai': false` → `'@google/genai': true` (di bagian `allowBuilds:`)
3. `rm -rf node_modules pnpm-lock.yaml && pnpm install` — warning ERR_PNPM_IGNORED_BUILDS hilang,
   malah muncul `Running preinstall script, done` untuk @google/genai
4. `pnpm-lock.yaml` ternyata regenerate jadi identik dengan versi lama (tidak berubah) — cuma
   `pnpm-workspace.yaml` yang perlu di-commit
5. Commit & push: `git commit -m "Allow @google/genai build script (pnpm v11 allowBuilds) to fix Render deploy"`

### Catatan Bug Lama yang Ditemukan (BELUM diperbaiki, TODO nanti)
- Saat `git status` dijalankan tanpa filter file spesifik, muncul RIBUAN baris
  `D node_modules/.pnpm/react-native@.../...` — artinya ada isi node_modules yang ke-track
  di git sejak lama (bug lama, sudah dicatat sesi sebelumnya, high-risk untuk diperbaiki sekarang).
- MITIGASI yang dipakai: SELALU `git status --short -- <file spesifik>` dan
  `git add <file spesifik>` satu-satu, JANGAN PERNAH `git add .` atau `git add -A`.
- Solusi permanen (bersihkan node_modules dari git tracking) masih belum dikerjakan — risiko
  tinggi, perlu sesi terpisah yang fokus khusus untuk ini.

### Hasil Deploy — VERIFIED DARI LOG RENDER ✓
- `==> Build successful 🎉`
- `==> Your service is live 🎉`
- `[WHALE] Whale/smart money tracker started. Interval: 900s`
- `[WHALE] sol: 10 trade ditemukan dari smart money`
- `[WHALE] eth: 15 trade ditemukan dari smart money`
- `[WHALE] Scan selesai. 0 alert terkirim.` — gmgn-cli BENAR-BENAR jalan dan dapat data asli,
  tapi belum ada bukti alert Telegram konkret terkirim (bisa jadi semua kena cooldown filter,
  atau belum ada trade baru yang lolos). BELUM DIVERIFIKASI apakah pesan Telegram whale
  benar-benar sampai ke channel.
- Semua sistem lain (signal cron, meme scanner, dex radar, daily-save) tetap jalan normal,
  tidak ada regresi.

### Belum Dikerjakan (lanjutkan sesi berikutnya)
1. Verifikasi 3 env variable sudah ke-set di Render dashboard:
   GMGN_API_KEY, WHALE_TELEGRAM_BOT_TOKEN, WHALE_TELEGRAM_CHAT_ID
   (nilai-nilainya ada di sesi 2026-07-03 sebelumnya di file ini)
2. Cek apakah tabel `whale_alerts` sudah dibuat di database — jalankan
   `scripts/src/create-whale-alerts-table.ts` dari lokal kalau belum
3. Pantau beberapa jam/hari untuk lihat apakah ada alert Telegram whale yang BENAR-BENAR
   terkirim ke channel (bukan cuma "0 alert terkirim" terus-terusan)
4. Item lama yang masih belum dikerjakan dari sesi 2026-07-03:
   - Endpoint lama `/api/ai/whales` (pakai Gemini AI, data berpotensi halusinasi) — putuskan
     apakah masih dipakai frontend, kalau iya perlu diganti dengan data whale_alerts asli
   - Belum ada cron forward-test (ATH/status update) untuk whale_alerts
   - Belum ada dashboard section untuk whale_alerts di `/api/cron/dashboard`

---

## Update sesi 4 Juli 2026 — Whale Tracker Fix & Repo Cleanup

### 1. Bug fix kritis: whale tracker 0 alert terkirim
Root cause: field `trade.token_address` yang dipakai kode tidak pernah ada di response asli GMGN API (field asli `base_address`). Akibatnya `token` selalu `undefined` dan semua trade ke-skip di baris `if (!wallet || !token) continue`.
Fix: fallback ke `base_address`, `base_token.symbol`, `transaction_hash`.
Status: **VERIFIED WORKING** — log Render menunjukkan `[WHALE] Scan selesai. 22 alert terkirim.`

### 2. Forward-test cron untuk whale_alerts (baru)
- `checkWhaleAlerts()` + `startWhaleCheckCron()` — jalan tiap 6 jam, reuse `fetchDexScreenerData()`.
- Update `lastPrice`/`athPrice`/`athMultiplier` otomatis. Status `DEAD` kalau liquidity < $1000, `STOPPED` setelah 30 hari.
- Endpoint baru: `GET /api/cron/whale-results` — ringkasan total alert, %≥2x, %≥5x, %dead, top performers.
- Dashboard `/api/cron/dashboard` — section baru "🐋 Whale / Smart Money Tracker".

### 3. Warning badge token lookalike/scam (baru)
Ditemukan whale alert sering kirim token dengan nama lookalike scam (contoh: МУДЭНГ vs МУДЕНГ, лосось/лось pakai huruf Cyrillic niru token asli). Diputuskan **tidak pakai filter blocking GoPlus** (mahal, rawan rate limit, nambah delay) — cukup regex simpel deteksi karakter non-ASCII di symbol, tambahin baris `⚠️ WARNING: nama token pakai karakter non-Latin` di pesan Telegram. Catatan: GoPlus security check itu HANYA dipakai di meme scanner (`memes.ts`), TIDAK PERNAH terhubung ke whale scan (`cron.ts`) — jadi whale tracker dari awal memang tanpa filter keamanan token.

### 4. Repo cleanup: node_modules ke-track di git
Ditemukan root `.gitignore` cuma exclude `.DS_Store`, tidak ada `node_modules/` — 53.951 file node_modules ke-track ke GitHub. Sudah di-fix:
- `.gitignore` root diperbaiki (node_modules, dist, .env, *.backup, *.bak*, dll)
- `git rm -r --cached .` + `git add .` untuk untrack node_modules & file backup lama
- Sempat ada regresi kecil: `pnpm-workspace.yaml` allowBuilds `'@google/genai'` sempat balik ke `false` (bakal break build Gemini) — sudah dikembalikan ke `true` sebelum commit.

### Status whale tracker sekarang: FULLY OPERATIONAL
- Scan tiap 15 menit ✅
- Forward-test tiap 6 jam ✅
- Dashboard section ✅
- Warning badge lookalike token ✅
- Belum ada: filter keamanan blocking (sengaja tidak dipasang, sesuai keputusan trade-off di atas)

### Belum Dikerjakan (update)
- Monitor beberapa hari: apakah 22 alert/scan itu wajar atau kebanyakan noise (cooldown-nya sudah pas?)
- Belum dicek: apakah channel Telegram whale terpisah dari channel signal/meme (biar tidak campur aduk)
- `/api/ai/whales` (Gemini-based) dikonfirmasi dead code, tidak dipakai frontend manapun — aman dihapus kapan saja kalau mau beres-beres lebih lanjut

---

## Update sesi 4 Juli 2026 (lanjutan) — Wash Trading Filter untuk Whale Tracker

### Masalah yang ditemukan
Setelah whale tracker jalan normal (22-23 alert/scan), ketahuan banyak alert berasal dari token lookalike/scam — contoh nama pakai huruf Cyrillic niru token asli: `лосось`/`ЛОСОСЬ`/`лось` (mirip "salmon"/"elk" dalam bahasa Rusia), muncul berkali-kali dari banyak wallet berbeda dalam window waktu singkat. Polanya khas wash trading terkoordinasi, bukan smart money organik.

Diputuskan **tidak pakai GoPlus security filter** (mahal, sering kena rate limit 4029, nambah delay) — dan dikonfirmasi GoPlus memang cuma dipakai di meme scanner (`memes.ts`), tidak pernah terhubung ke whale scan (`cron.ts`).

### Solusi: filter wash-trading 2 lapis (built-in, tanpa API tambahan)
1. **Per alamat kontrak token** — kalau ≥3 wallet berbeda beli token (alamat sama) dalam window 10 menit → skip & suppress token itu 24 jam.
2. **Per nama simbol (case-insensitive)** — nangkep pola yang lebih canggih: scammer deploy banyak kontrak berbeda dengan nama sama/mirip (misal лосось vs ЛОСОСЬ = alamat kontrak beda tapi nama sama). Trigger kalau:
   - Wallet yang sama beli token dengan nama sama dari ≥2 kontrak berbeda, ATAU
   - ≥3 wallet berbeda beli token dengan nama sama (lintas kontrak)
   
   Kalau kena, simbol itu di-suppress 24 jam (semua kontrak dengan nama itu ikut ke-skip).

Implementasi: in-memory `Map` (whaleTokenBuyerHistory, whaleSuspiciousTokens, whaleSymbolBuyerHistory, whaleSuspiciousSymbols), reset kalau server restart (bukan persisten ke DB — cukup untuk kebutuhan sekarang, bisa dipindah ke DB kalau restart jadi masalah).

### Badge tambahan (lapisan ketiga, non-blocking)
Untuk token yang lolos dari 2 filter di atas tapi tetap namanya pakai karakter non-Latin, tetap dikasih warning di pesan Telegram: `⚠️ WARNING: nama token pakai karakter non-Latin — waspada lookalike/scam token.`

### Hasil verifikasi (log Render)
- Filter alamat kontrak terbukti trigger: `eth:0x7a22af4a3832ea8fd8b8895f893d9fed617ee458 — 3 wallet berbeda beli dalam 10 menit`
- Filter simbol terbukti bekerja: keluarga лосось/ЛОСОСЬ/лось tidak lagi muncul di alert baru setelah fix (cuma nongol di forward-test check buat record lama sebelum fix)
- Total alert per scan turun dari 22-23 → 14, tanpa kehilangan sinyal dari wallet yang genuinely independen (contoh: SALMON masih lolos karena baru 2 wallet berbeda, belum kena threshold 3)

### Status whale tracker sekarang: FULLY OPERATIONAL + FILTERED
- Scan tiap 15 menit ✅
- Forward-test tiap 6 jam ✅
- Dashboard section ✅
- Badge warning karakter non-Latin ✅
- Filter wash-trading per alamat kontrak ✅
- Filter wash-trading per nama simbol (cross-contract) ✅

### Belum Dikerjakan (update)
- Monitor beberapa hari lagi: apakah 14 alert/scan masih ada noise, atau threshold (3 wallet / 10 menit / 24 jam suppress) perlu di-tuning
- Pertimbangkan pindahkan wash-trade state dari in-memory Map ke DB kalau server sering restart (biar suppress list tidak ke-reset)
- Belum dicek: apakah channel Telegram whale terpisah dari channel signal/meme
- `/api/ai/whales` (Gemini-based) masih dead code, aman dihapus kapan saja
- **Investigasi belum jalan:** kenapa signal SELL forward-test 0% win rate (4/4 loss saat terakhir dicek) — backtest bilang 48.8% WR, realita jauh di bawah. Perlu di-follow-up.

---

## Update sesi 4 Juli 2026 (lanjutan) — Investigasi Signal SELL 0% Win Rate

### Temuan awal
4 signal closed terakhir semuanya SL_HIT (0% WR), semuanya SELL, padahal backtest v3 klaim WR ~45-49%. Semua 12 signal terakhir (termasuk yang OPEN) juga SELL semua, tidak ada BUY — ternyata ini **BY DESIGN**, bukan bug:
```ts
// signal-engine-realtime.ts baris ~190
if (scored.bias === "BEARISH" && conf >= 45 && conf <= 55) side = "SELL";
// BUY disabled — re-enable setelah ada bukti zona profitable (backtest v3: semua bucket negatif)
```

### Hasil re-run backtest-v3-paginated.ts (2809 signals, 6 pair: BTC/ETH/BNB/SOL/LINK/DOGE, ~5 tahun data)
Angka SELL 45-55 yang dipakai production **valid diambil dari tabel "SELL saja" (unfiltered)**:
- 45-50: 488 trades, WR 48.8%, PF 1.22 ⚠️
- 50-55: 659 trades, WR 49.5%, PF 1.14 ⚠️
- **Kedua bucket ini ditandai ⚠️ oleh tools-nya sendiri, BUKAN ✅** — cuma bucket 65-70 (50 trades, sample kecil) yang ✅ bersih.

**Temuan kritis:** kode live TIDAK PERNAH cek `trend1d` (EMA50/200 structure), padahal backtest nunjukkin filter searah-trend bikin hasil lebih baik:
- "Searah trend — SELL" 45-50: WR 50.0%, PF 1.17 ✅ (126 trades, lebih baik dari unfiltered)
- "Searah trend — SELL" 50-55: WR 50.0%, PF 1.04 ✅ (198 trades)

Kesimpulan: **edge yang ada di seluruh sistem ini TIPIS di semua kombinasi yang dites** (PF mayoritas 0.7-1.2 di semua confidence bucket, semua pair). Ini bukan strategi dengan edge kuat — backtest sendiri menandai hampir semua hasil dengan ⚠️, bukan ✅.

### Keputusan/arahan dari user
Tujuan utama: profit konsisten, benerin fondasi dulu sebelum kejar profit besar. User paham risiko edge tipis dan setuju prioritas:
1. Circuit breaker otomatis (auto-pause SELL kalau loss beruntun) — **BELUM DIKERJAKAN**
2. Filter trend1d ke kondisi live signal engine — **BELUM DIKERJAKAN**
3. Walk-forward / out-of-sample validation (backtest saat ini in-sample, rawan overfitting) — **BELUM DIKERJAKAN**
4. Tambahan fitur baru yang diminta: **saran leverage & position sizing di tiap alert Telegram sinyal** (sifatnya cuma masukan/tidak mengikat, keputusan akhir tetap di tangan trader) — **BELUM DIKERJAKAN**

### Belum Dikerjakan (prioritas signal engine, urutan disepakati)
1. Circuit breaker: auto-pause kalau N loss beruntun dalam periode tertentu
2. Filter trend1d: tambahkan syarat trend1d harus align sebelum kirim sinyal SELL
3. Walk-forward validation: pisah data training vs testing biar tau edge asli atau overfit
4. Tambah rekomendasi leverage + position sizing (non-binding) di pesan Telegram sinyal
5. (Longer term) Evaluasi apakah pendekatan TA lagging (EMA/RSI/MACD) masih punya edge di market yang makin efisien, atau perlu pivot ke sumber informasi lain (whale tracker dinilai lebih menjanjikan karena ngikutin transaksi riil, bukan pola grafik)

---

## Update sesi 5 Juli 2026 — Circuit Breaker SELESAI ✅ (Prioritas #1)

### Yang Sudah Dikerjakan
- Tabel baru `circuit_breaker` dibuat di PostgreSQL (via node .cjs script langsung, sama pola seperti tabel lain)
  - Kolom: pair (PK), consecutive_losses, last_loss_at, paused_until, updated_at
  - Schema Drizzle: lib/db/src/schema/circuit-breaker.ts
  - Script buat tabel: scripts/src/create-circuit-breaker-table.cjs (pakai `node` biasa, BUKAN tsx — hindari masalah esbuild yang sering muncul di project ini)
- cron.ts dipatch (5 bagian):
  1. Import `circuitBreaker` dari `@workspace/db`
  2. Fungsi `isCircuitBreakerPaused(pair)` — cek apakah pair sedang di-pause
  3. Fungsi `recordCircuitBreakerResult(pair, status)` — dipanggil tiap signal closed:
     - SL_HIT → tambah consecutive_losses; kalau sudah 4x → paused_until = now + 7 hari
     - TP3_HIT → reset consecutive_losses ke 0, paused_until = null
  4. Di `runSignalScan()`: sebelum kirim Telegram, cek `isCircuitBreakerPaused(pair)` dulu — kalau true, skip kirim & lanjut ke pair berikutnya
  5. Di `checkOpenSignals()`: setelah signal closed (TP3_HIT/SL_HIT), panggil `recordCircuitBreakerResult()`
- Endpoint baru:
  - `GET /api/cron/circuit-breaker/status` — lihat status semua pair (consecutive_losses, paused_until)
  - `POST /api/cron/circuit-breaker/reset/:pair` — reset manual paksa (misal: `reset/SOLUSDT`)

### Keputusan Desain
- Threshold: 4x SL_HIT berturut-turut → pause
- Durasi pause: 7 hari (auto-reset), atau manual kapan saja lewat endpoint reset
- Scope: PER PAIR (bukan global) — SOLUSDT bisa di-pause sementara BTCUSDT tetap jalan normal
- Fail-safe: kalau ada error saat cek/catat status circuit breaker (misal DB down), sinyal TETAP dikirim seperti biasa (tidak mau 1 bug kecil bikin semua sinyal berhenti total). Error tetap dicatat di log Render.

### Hasil Deploy — VERIFIED ✅
- Build & deploy Render sukses tanpa error
- `curl https://nexus-alpha-j3yb.onrender.com/api/cron/circuit-breaker/status` → `[]` (kosong, normal — belum ada pair yang kena pause sejak fitur ini aktif)
- Belum ada data forward-test untuk circuit breaker ini sendiri (baru live hari ini) — pantau beberapa minggu ke depan apakah threshold 4x/7hari sudah pas atau perlu di-tuning

### Status: FULLY OPERATIONAL

---

## Prioritas Selanjutnya (disepakati, urutan 1/1 — kerjakan satu-satu)

1. ~~Circuit breaker~~ — DONE ✅ (5 Juli 2026)
2. **Filter trend1d** — syarat tambahan: sinyal SELL hanya boleh terkirim kalau trend Daily (EMA50/200) juga BEARISH (searah trend). Backtest v3 menunjukkan versi searah-trend punya WR lebih baik (50.0% vs 48.8% unfiltered) dan ditandai ✅ oleh tools backtest (bukan ⚠️ seperti versi unfiltered yang dipakai production sekarang). Field `trend1d` di signal-engine-realtime.ts SUDAH benar (bug lama sudah di-fix sesi 2026-06-30), tinggal dipakai sebagai syarat tambahan di logika kirim sinyal — BELUM DIKERJAKAN.
3. **Walk-forward validation** — backtest saat ini in-sample (rawan overfitting), perlu dipisah data training vs testing untuk tau edge asli — BELUM DIKERJAKAN.
4. **Saran leverage & position sizing** (non-binding) ditambahkan ke pesan Telegram sinyal — BELUM DIKERJAKAN.

---

## Sesi 5 Juli 2026 — Trend1d Filter, Riset Breakout, Walk-Forward, Analisis Scoring

### 1. Filter trend1d — DONE ✅ (Prioritas #2)
- signal-engine-realtime.ts dipatch: SELL sekarang WAJIB `trend1dVal === "BEARISH"` juga (searah Daily trend), bukan cuma bias BEARISH 4H + confidence 45-55
- Alasan: backtest v3 menunjukkan versi searah-trend WR 50.0% (✅) vs 48.8% unfiltered (⚠️)
- Sudah di-commit & deploy ke production

### 2. Fix lingkungan lokal: esbuild/tsx akhirnya BENERAN FIXED
- Root cause: `pnpm-workspace.yaml` sengaja EXCLUDE `esbuild>@esbuild/darwin-arm64` (komentar asli: "replit uses linux-x64 only") — jadi Mac M-series memang dari awal didesain TIDAK BISA install esbuild untuk dirinya sendiri
- Fix: hapus baris exclude itu di `overrides:`, ubah `allowBuilds: esbuild: false` → `true`, lalu `rm -rf node_modules pnpm-lock.yaml && pnpm install`
- HASIL: `npx tsx` sekarang jalan normal di MacBook lokal tanpa workaround `.cjs` lagi. Render (Linux) tidak terpengaruh sama sekali oleh perubahan ini.
- Kalau ke depan `npx tsx` error lagi soal esbuild, cek dulu `pnpm-workspace.yaml` sebelum coba solusi lain

### 3. Riset BUY dengan filter trend1d — HASIL: TETAP TIDAK PROFITABLE
- Re-run backtest-v3-paginated.ts: semua bucket confidence BUY searah-trend tetap negatif (WR 37-42%, AvgPnL negatif semua kecuali 65-70 yang cuma 18 trade/sample kecil)
- Kesimpulan: filter trend1d TIDAK menyelamatkan BUY mean-reversion (EMA/RSI). Masalahnya bukan di situ — kemungkinan besar karena strategi ini swing-trading jangka pendek (≤10 hari, SL/TP ketat ATR-based), sementara indikator EMA/RSI/dll bersifat "lagging" (telat), sering entry BUY pas tren sudah mau habis
- BUY mean-reversion TETAP DISABLED

### 4. Riset baru: BREAKOUT MOMENTUM strategy — HASIL POSITIF, walk-forward LOLOS
- Script: scripts/src/backtest-breakout.ts (riset awal, 12 kombinasi) dan scripts/src/backtest-breakout-walkforward.ts (validasi)
- Logika: BUY kalau close > highest-high N hari + volume > 1.5x rata-rata N hari (breakout momentum, BUKAN mean-reversion)
- PENTING: versi awal backtest-breakout.ts (12 kombinasi) awalnya PUNYA BUG — tidak ada anti-overlap (bisa catat sinyal breakout berkali-kali untuk 1 pergerakan harga yang sama). SUDAH DIPERBAIKI (skip sampai trade selesai sebelum cari sinyal baru) — kalau mau reuse script ini, pastikan pakai versi yang sudah di-patch, bukan versi awal
- Kandidat terbaik setelah fix: **Lookback 10 hari + Volume filter ON (1.5x) + Exit ketat (SL 1.5xATR, TP 1.5xATR, max 10 hari)**
  - Walk-forward: Periode 2021-2024: 192 trades, WR 52.6%, AvgPnL +1.49%, PF 1.45 ✅
  - Walk-forward: Periode 2024-2026: 110 trades, WR 50.0%, AvgPnL +0.97%, PF 1.29 ✅
  - KEDUA periode ✅ konsisten — kandidat kuat, lebih baik dari SELL yang sekarang live
- Kandidat kedua (Lookback 20 hari) sedikit lebih lemah di periode baru (WR 48.8%, masih profit tapi ⚠️)
- **BELUM diimplementasikan ke production** — masih tahap riset, forward-test infrastructure belum dibuat

### 5. Walk-forward validation SELL yang SEDANG LIVE — HASIL MENGKHAWATIRKAN
- Script: scripts/src/backtest-sell-walkforward.ts
- Periode 1 (2022-2024, LAMA): cuma 12 trades — sample TERLALU KECIL untuk dipercaya, meski tertanda ✅
- Periode 2 (2024-2026, BARU, 432 trades — sample besar & valid): WR 48.1%, **AvgPnL -0.18%, PF 0.95** ⚠️ NEGATIF
- Kesimpulan: SELL yang sedang live KEMUNGKINAN BESAR OVERFITTING dari backtest v3 sebelumnya. Data real (432 trade di periode baru) menunjukkan tidak profitable
- INI KONSISTEN dengan laporan forward-test real Telegram sebelumnya: 4/4 signal closed = 0% win rate
- User memutuskan: JANGAN cuma ubah angka confidence range lagi, tapi PERBAIKI SCORING-nya (component-level), bukan cuma threshold

### 6. Analisis komponen scoring (rule-based-engine.ts) — TEMUAN PENTING
- Script: scripts/src/analyze-scoring-components.ts (per komponen: trend/confluence/srLevel/volume) dan scripts/src/analyze-scoring-rules.ts (per aturan individual)
- **CATATAN METODOLOGI PENTING**: komponen `sentiment`, `funding`, `macro` (total 25/100 poin) TIDAK BISA dianalisis dari backtest historis karena datanya (fgi, fundingRate, lsRatio, btcDom) SELALU NULL di semua script backtest kita — nilainya konstan. Artinya 25% dari sistem scoring "buta" saat backtest, cuma teruji beneran di production real-time. Ini gap penting yang harus diingat.
- **VOLUME formula PUNYA BUG DESAIN**: skornya TIDAK PERNAH mencapai kategori "Tinggi" (>=70% dari 15 poin) di ribuan sample data manapun — perlu diperbaiki formulanya dulu sebelum bisa dinilai valid/tidaknya
- **TREND (bobot 20, komponen terbesar) — LAGGING INDICATOR TRAP TERKONFIRMASI DATA**: skor "Tinggi" (EMA stack sejajar sempurna) hasilnya LEBIH JELEK (-0.67%) daripada skor "Sedang" (+0.03%). EMA stack sejajar sempurna biasanya baru terjadi SETELAH tren sudah berjalan lama (late entry), bukan di awal
- **2 ATURAN TERBUKTI KONTRA-PRODUKTIF (bukan cuma netral, tapi MERUSAK)**:
  - "Dekat Support/Resistance kuat": Aktif -0.83% ❌ vs Tidak aktif +0.13% (SELL: aktif -0.56% vs tidak aktif +0.63%)
  - "BOS (Break of Structure) terkonfirmasi": SELL — Aktif -1.89% ❌ (WR 36.7%) vs Tidak aktif +0.10%
  - Kedua aturan ini dapat bonus poin di formula sekarang, padahal data bilang seharusnya JUSTRU dikurangi/dibalik
- **CONFLUENCE untuk BUY** — salah satu yang paling positif: Tinggi (>=70%) = +0.99% ✅ WR 51.9% (133 trades)
- **KESIMPULAN BESAR**: hampir SEMUA 7 aturan individual yang ditest (EMA stack, Ichimoku, 4H trend, S/R, BB, BOS) TIDAK menunjukkan "Aktif" konsisten lebih baik dari "Tidak aktif" di 3 potongan data (gabungan/BUY/SELL). Confidence score 45-55 yang kelihatan OK di backtest sebelumnya kemungkinan besar itu KEBETULAN kombinasi sinyal-sinyal lemah/kebalik yang saling meniadakan jadi 1 angka yang terlihat masuk akal — BUKAN karena logika yang benar-benar prediktif

### 7. Riset eksternal (web search) — dasar untuk metode baru
- Riset akademis mengonfirmasi: menggabungkan machine learning (logistic regression/random forest/gradient boosting) dengan indikator teknikal itu pendekatan yang lebih valid dibanding bobot manual (source: PMC studi ML crypto, ScienceDirect trend-forecast study)
- Freqtrade (open-source crypto trading bot terbesar) juga menekankan: forward-test (dry-run) jauh lebih dipercaya dari backtest, dan strategi publik/backtest sering menyesatkan kalau dipakai sebagai patokan mutlak
- KEPUTUSAN: pivot dari "tebak bobot manual" ke METODE STATISTIK (logistic regression) — kasih semua indikator mentah + hasil menang/kalah aktual, biarkan matematika cari kombinasi & bobot yang benar-benar berkorelasi, bukan ditebak manusia

## Belum Dikerjakan / Next Steps (urutan disepakati, kerjakan 1/1)

1. ~~Circuit breaker~~ — DONE ✅
2. ~~Filter trend1d~~ — DONE ✅
3. ~~Riset breakout momentum + walk-forward~~ — DONE ✅ (kandidat: Lookback 10 hari, siap lanjut ke implementasi production)
4. ~~Walk-forward SELL yang live~~ — DONE ✅ (hasil: kemungkinan overfitting, PF 0.95 di data terbaru)
5. ~~Analisis komponen & aturan scoring~~ — DONE ✅ (temuan: banyak aturan kontra-produktif/lagging)
6. **SEDANG DIKERJAKAN: bangun model scoring pakai logistic regression** (data-driven, bukan bobot manual) — untuk BUY dan SELL. BELUM ADA SCRIPT-NYA, baru rencana.
7. **BELUM**: implementasi breakout BUY (Lookback 10 hari) ke production — kode signal generator baru, tabel forward-test baru, dashboard, dll
8. **BELUM**: leverage & position sizing recommendation di Telegram (prioritas #4 dari daftar sangat awal)
9. **BELUM**: setelah scoring baru (regresi) jadi, WAJIB walk-forward validation lagi sebelum deploy — jangan ulangi kesalahan yang sama (deploy dulu, validasi belakangan)

### Catatan penting untuk sesi berikutnya
- SELL yang SEKARANG LIVE di production kemungkinan besar TIDAK PROFITABLE (walk-forward PF 0.95 di data 2 tahun terakhir) — pertimbangkan apakah perlu dikecilkan porsi/dihentikan sementara sambil scoring baru dikembangkan, sirkuit breaker yang sudah ada tetap jadi pengaman minimal
- Semua script riset (backtest-v3-paginated.ts, backtest-breakout.ts, backtest-breakout-walkforward.ts, backtest-sell-walkforward.ts, analyze-scoring-components.ts, analyze-scoring-rules.ts) ada di scripts/src/ — murni file riset, TIDAK menyentuh kode production, aman dijalankan ulang kapan saja
- npx tsx sekarang sudah normal jalan di lokal (lihat poin 2), tidak perlu lagi workaround .cjs untuk script baru

---

## Sesi 5 Juli 2026 (lanjutan 2) — Logistic Regression Scoring: RISET SELESAI, BELUM PRODUCTION

### Tujuan
Ganti bobot manual di rule-based-engine.ts (yang terbukti banyak aturan kontra-produktif) dengan model logistic regression data-driven. Prioritas #1 dari daftar yang disepakati.

### Yang Dibangun
- `scripts/src/build-ml-dataset.ts` — generate dataset fitur mentah (37 fitur, dalam satuan ATR/rasio, BUKAN skor 0-100) + label menang/kalah, identik formula dengan backtest-v3-paginated.ts (SL/TP 1.5x ATR, RR 1:1, max hold 10 hari). Output: `scripts/output/ml-dataset.csv` (4884 baris, 6 pair x ~814 baris, periode 2024-04 s/d 2026-06, dibatasi ketersediaan 4H candle Bybit ~2.3 tahun).
- `scripts/src/train-logistic-model.ts` — training logistic regression dari nol (gradient descent + L2), split KRONOLOGIS 70/30 (bukan random — data tidak anti-overlap, baris berdekatan waktu berkorelasi). Model tersimpan di `scripts/output/model-buy.json` dan `model-sell.json`.
- `scripts/src/validate-model-robustness.ts` — dua uji ketahanan: walk-forward 4-fold (lintas waktu) dan leave-one-pair-out (lintas pair, test di pair yang tidak pernah dilihat model).
- `scripts/src/compare-perpair-vs-general.ts` — bandingkan model general (semua pair digabung) vs model per-pair (dilatih khusus per pair), diuji di baris test yang sama persis.

### Temuan Kunci

**Single split 70/30 (uji pertama):**
- BUY: desil tertinggi PF 1.65 vs desil terendah PF 0.37 — pola naik hampir monoton
- SELL: desil tertinggi PF 3.31 vs desil terendah PF 0.59 — pola lebih jelas dan lebih kuat dari BUY
- Fitur paling berpengaruh di kedua model: jarak ke EMA200 dalam satuan ATR (bukan sinyal biner EMA stack seperti scoring manual lama)

**Walk-forward 4-fold (lintas waktu) — SELL lebih meyakinkan dari BUY:**
- BUY: 2 dari 4 fold GAGAL (Top 20% justru lebih jelek dari Bottom 20%) — tidak stabil, JANGAN lanjut ke production dulu
- SELL: 3 dari 4 fold BERHASIL dengan tren membaik (PF 0.98→1.39→2.18 di 3 fold terakhir), cuma fold 1 gagal (kemungkinan karena training data paling sedikit, 976 baris)
- Kesimpulan: **fokus ke model SELL**, BUY ditunda

**Leave-one-pair-out (lintas pair) — KONSISTEN 12/12 (BUY dan SELL, semua 6 pair):**
- Model general TIDAK menghafal karakteristik pair spesifik — terbukti tetap prediktif di pair yang sama sekali tidak dilihat saat training
- Jawaban untuk pertanyaan "gimana kalau nambah pair baru?": model general kemungkinan besar tetap relevan tanpa retrain khusus, SELAMA pair baru punya karakter likuiditas/pergerakan yang sebanding (bukan meme coin baru umur hitungan hari)

**General vs Per-pair model — GENERAL MENANG untuk SELL:**
- SELL: model general menang di 4/6 pair, rata-rata selisih Top-Bottom AvgPnL lebih tinggi (4.74% vs 2.85% per-pair)
- BUY: per-pair "menang" di 4/6 pair tapi rata-rata selisihnya malah LEBIH RENDAH (3.08% vs 3.76%) — indikasi overfitting, konsisten dengan temuan walk-forward BUY yang juga tidak stabil
- Sample per-pair (~569 baris training) terlalu kecil untuk personalisasi yang stabil
- **KEPUTUSAN: pakai model GENERAL (bukan per-pair)** — selain lebih stabil untuk SELL, juga otomatis bisa dipakai untuk pair baru sejak hari pertama tanpa perlu histori panjang dulu

### Keputusan Akhir Sesi Ini
- Model SELL logistic regression: kandidat kuat, LEBIH BAIK dari scoring manual yang sedang live (yang walk-forward-nya PF 0.95, di bawah breakeven)
- Model BUY: TIDAK dilanjutkan dulu — walk-forward tidak stabil, butuh investigasi lebih lanjut atau lebih banyak data sebelum dipertimbangkan lagi
- BELUM ADA yang diimplementasi ke production. Semua masih tahap riset di scripts/src/, tidak menyentuh rule-based-engine.ts atau signal-engine-realtime.ts yang live

### Belum Dikerjakan (lanjutkan sesi berikutnya)
1. **Investigasi kenapa fold 1 (walk-forward) gagal** di kedua model — kemungkinan sample training terlalu sedikit (976 baris), perlu dicek apakah threshold minimum data tertentu yang bikin model mulai stabil
2. **Bangun shadow forward-test untuk model SELL** — jalan PARALEL di background, kirim ke channel Telegram/dashboard TERPISAH dari sinyal yang sudah live (tidak mengganti sistem yang sudah jalan), threshold awal yang diusulkan: probabilitas SELL >= 0.37 (setara desil 8 ke atas dari uji pertama)
3. Setelah shadow forward-test kumpul cukup data (minimal 15-20 sinyal closed, sesuai standing instruction), baru evaluasi apakah layak GANTI signal engine production dari scoring manual ke logistic regression SELL
4. Breakout BUY (Lookback 10 hari, dari riset sebelumnya) masih menunggu implementasi — belum digarap sesi ini
5. Leverage & position sizing recommendation di Telegram — masih belum dikerjakan (prioritas #4 lama)

### File-File Baru Sesi Ini
- scripts/src/build-ml-dataset.ts
- scripts/src/train-logistic-model.ts
- scripts/src/validate-model-robustness.ts
- scripts/src/compare-perpair-vs-general.ts
- scripts/output/ml-dataset.csv (data, tidak perlu di-commit ke git — bisa di-regenerate kapan saja dari script)
- scripts/output/model-buy.json, model-sell.json (hasil training, riset saja)

### Catatan Penting untuk Sesi Berikutnya
- Script-script riset di atas TIDAK menyentuh kode production sama sekali — aman dijalankan ulang kapan saja untuk re-training atau re-validasi
- scripts/output/*.csv dan *.json sebaiknya JANGAN di-commit ke git kalau ukurannya besar (cek dulu ukurannya) — atau tambahkan ke .gitignore kalau memang tidak perlu di-track
- Kalau lanjut ke shadow forward-test, WAJIB pakai channel Telegram BARU (bukan channel signal yang sudah ada) supaya tidak campur aduk dengan sinyal production yang sedang berjalan

---

## Sesi 5 Juli 2026 (lanjutan 3) — Logistic Regression: Dataset Diperbesar, Fitur Volatilitas TERBUKTI Membantu, BUY & SELL Sama-Sama Layak

### Ringkasan Keputusan Akhir
- **Dataset diperbesar dari ~2.3 tahun (4884 baris) menjadi ~6 tahun 2020-2026 (9204 baris)** — H4_BATCHES di build-ml-dataset.ts dinaikkan dari 5 ke 14
- **Fitur volatilitas rolling (`rolling_vol_pct`) TERBUKTI signifikan membantu** — walk-forward 8-fold naik dari BUY 5/8→7/8, SELL 7/8→8/8 (sempurna)
- **Fitur market breadth (`breadth_bearish_pct`/`breadth_bullish_pct`) TERBUKTI TIDAK membantu, malah merusak SELL** (8/8→6/8) — dibuang, tidak dipakai
- **Model final yang dipakai: 38 fitur (37 asli + rolling_vol_pct)** — SELL 8/8 fold, BUY 7/8 fold
- **BUY dan SELL sekarang SAMA-SAMA layak dipertimbangkan** — keputusan sebelumnya (fokus SELL saja, BUY ditunda) DIREVISI berdasarkan bukti baru ini

### Kenapa Data Diperbesar (atas permintaan user)
User menanyakan apakah data 2.3 tahun cukup atau perlu ditarik dari 2020. Jawaban: TIDAK cukup — 4H candle dibatasi H4_BATCHES lama (5 batch = 2.3 tahun) meski Daily candle sudah 5 tahun, sehingga dataset gabungan kepotong ke periode pendek. Diperbesar ke 14 batch H4 (~6 tahun), mencakup siklus pasar jauh lebih beragam (bear 2022, recovery 2023, konsolidasi 2024-2025, kondisi 2026).

**Sumber data**: Bybit API resmi (`api.bybit.com/v5/market/kline`, category=spot) — SAMA PERSIS dengan sumber data signal engine live. Bukan data sintetis. Sempat didiskusikan TradingView sebagai alternatif — DITOLAK karena tidak ada API resmi gratis untuk data historis besar, cuma ada scraper tidak resmi yang melanggar ToS dan tidak stabil. Kalau nanti butuh histori lebih panjang dari yang Bybit sediakan (terutama BNB/SOL yang listing spot belakangan), alternatif resmi & gratis adalah Binance public API (khusus untuk RISET, bukan production, karena Binance pernah kena ban HTTP 418 di Render).

### Investigasi Ketidakstabilan BUY (root cause ditemukan)
- Walk-forward 8-fold (SEBELUM fitur volatilitas): BUY 5/8 berhasil, gagal di fold 5,6,7 (Agu 2024-Jan 2026)
- Dibedah 3 cara: (1) regime market per fold, (2) breakdown per-pair, (3) sensitivitas hyperparameter
- **Setelah ditambah rolling_vol_pct: fold 5,6,7 SEMUA jadi berhasil.** Cuma fold 8 (Jan-Jun 2026, PALING BARU) yang masih gagal
- **Fold 8 dibedah tuntas dan TERBUKTI bukan cacat model**: downtrend market-wide serentak di SEMUA 6 pair (BTC/ETH/BNB/SOL/LINK/DOGE sama-sama rugi kalau asal BUY), dan gagal di SEMUA kombinasi hyperparameter tanpa kecuali — artinya memang tidak ada peluang BUY yang bisa ditemukan model manapun di periode itu, bukan model yang "gagal menemukan" sesuatu yang sebenarnya ada
- Kesimpulan: BUY sekarang genuinely solid (7/8 fold, kegagalan 1 fold bisa dijelaskan penuh), bukan cuma "kebetulan" seperti sebelumnya

### Riset Literatur Eksternal (sebelum eksperimen fitur baru)
Dicari sumber kredibel (bukan asal googling) soal regime filtering:
- Palazzi (2025, Journal of Futures Markets, peer-reviewed) — volatility filter menekan sinyal saat volatilitas >1.5x rata-rata
- Moskowitz et al., Lempérière et al. (dikutip di arXiv) — trend-following punya edge struktural, bukan kebetulan, terbukti lintas 2 abad data
- QuantMonitor.net — regime filter praktis: strategi aktif hanya saat trend + volatilitas mendukung
- Kaminski & Lo — exit adaptif lebih baik dari SL/TP statis

Sempat dicoba TERAPKAN langsung sebagai filter keras (trend1d BULLISH/BEARISH sebagai syarat wajib SEBELUM masuk model) — HASILNYA JUSTRU MEMPERBURUK performa (SELL raw WR turun dari 47.4%→44.0%, PF 1.12→0.92). Alasan: trend1d_bull SUDAH jadi salah satu dari 37 fitur yang dipelajari model dengan bobot proporsional — filter biner di luar model membuang sinyal-sinyal bagus yang sebenarnya masih untung meski trend tidak 100% searah. Pelajaran: masukkan variabel BARU sebagai FITUR yang ikut dilatih (biar bobotnya dicari otomatis), JANGAN sebagai filter keras manual di luar model — ini konsisten dengan temuan lama soal aturan biner kontra-produktif di scoring manual.

### Uji General vs Per-Pair Model (sudah dilakukan sebelum dataset diperbesar, kesimpulan masih berlaku)
- User bertanya: apakah model per-pair (dilatih khusus per pair) lebih akurat dari model general?
- SELL: model general menang 4/6 pair, rata-rata improvement lebih tinggi (4.74% vs 2.85%)
- BUY: per-pair "menang" 4/6 pair TAPI rata-rata improvement malah lebih rendah (indikasi overfitting karena sample per-pair terlalu kecil)
- **KEPUTUSAN: tetap pakai model GENERAL** (bukan per-pair) — lebih stabil, DAN otomatis bisa dipakai untuk pair baru sejak hari pertama tanpa perlu histori panjang dulu (jawaban langsung untuk pertanyaan ekspansi pair)

### Uji Ketahanan Lintas Pair (Leave-One-Pair-Out)
Diulang 2x (sebelum & sesudah fitur volatilitas) — HASIL: **12/12 konsisten di kedua uji** (BUY dan SELL, semua 6 pair, model general tetap prediktif bahkan di pair yang sama sekali tidak dilihat saat training). Ini bukti kuat model general TIDAK menghafal karakteristik pair spesifik, aman digunakan untuk pair baru yang punya karakter likuiditas/pergerakan sebanding.

### File-File Baru Sesi Ini
- scripts/src/investigate-buy-instability.ts — diagnosa regime + hyperparameter sensitivity (versi awal 4-fold)
- scripts/src/compare-perpair-vs-general.ts — perbandingan model general vs per-pair
- scripts/src/test-regime-filters.ts — uji filter trend1d keras (hasil: MEMPERBURUK, tidak dipakai)
- scripts/src/check-feature-correlation.ts — cek korelasi fitur volatilitas sebelum retrain (murah, tanpa training penuh)
- scripts/src/retrain-with-volatility.ts — retrain dengan rolling_vol_pct (BERHASIL, dipakai)
- scripts/src/investigate-fold8-and-leaveoneout.ts — bedah tuntas fold 8 + leave-one-pair-out ulang
- scripts/src/retrain-with-breadth.ts — retrain dengan fitur market breadth (GAGAL, tidak dipakai)
- scripts/src/build-ml-dataset.ts — H4_BATCHES diubah dari 5 menjadi 14 (permanen, untuk regenerate dataset kapan saja)

### Belum Dikerjakan (lanjutkan sesi berikutnya)
1. **Latih model FINAL** (38 fitur: 37 asli + rolling_vol_pct) memakai SELURUH data sampai hari terakhir (bukan cuma sampai titik cutoff testing) — untuk BUY dan SELL, siap dipakai shadow forward-test
2. **Bangun shadow forward-test untuk BUY DAN SELL** (bukan cuma SELL seperti rencana sebelumnya) — jalan paralel di background, channel Telegram/dashboard TERPISAH dari sinyal live yang sudah ada, tidak mengganti sistem production
3. Setelah shadow forward-test kumpul cukup data (standing instruction: minimal 15-20 sinyal closed untuk pembacaan awal, 50+ untuk kesimpulan), baru evaluasi apakah layak GANTI signal engine production dari scoring manual ke logistic regression
4. Breakout BUY (Lookback 10 hari, dari riset lama sebelum sesi logistic regression) masih menunggu — mungkin sudah tidak relevan sekarang karena logistic regression BUY sudah terbukti solid, perlu dibandingkan mana yang lebih baik nanti
5. Leverage & position sizing recommendation di Telegram — masih belum dikerjakan

### Catatan Penting
- rolling_vol_pct dihitung dari bb_bandwidth dengan window rolling 90 hari, TANPA lookahead (percentile hari ke-i cuma pakai data sampai hari ke-i, tidak termasuk hari itu sendiri)
- Dataset scripts/output/ml-dataset.csv sekarang jauh lebih besar (9204 baris) — kalau mau regenerate, tsx scripts/src/build-ml-dataset.ts akan makan waktu 8-12 menit (bukan 1 menit lagi) karena 14 batch x 6 pair
- BELUM ADA yang disentuh di kode production (rule-based-engine.ts, signal-engine-realtime.ts) — semua masih murni riset di scripts/src/

---

## Sesi 5-6 Juli 2026 — Shadow ML Signal LIVE DI PRODUCTION ✅

### Ringkasan
Model logistic regression (38 fitur: 37 asli + rolling_vol_pct, BUY dan SELL) berhasil dibangun, divalidasi ketat, dan di-deploy sebagai **shadow forward-test paralel** ke production — TIDAK menggantikan sinyal rule-based yang sudah live, jalan berdampingan untuk kumpulkan bukti nyata sebelum keputusan ganti.

### Yang Sudah Live
- Cron baru `startMlSignalCron()` — interval 15 menit, scan semua `SUPPORTED_PAIRS`, hitung probabilitas BUY/SELL pakai model logistic regression
- Cron baru `startMlSignalCheckCron()` — interval 15 menit, cek TP/SL sinyal ML yang OPEN (forward-test)
- Tabel DB baru `ml_signal_log` — struktur mirip `signal_log`, plus kolom `prob_buy`/`prob_sell`
- Sinyal ML dikirim ke channel Telegram YANG SAMA dengan sinyal biasa, dibedakan label jelas: `🧪 SHADOW ML SIGNAL — NEXUSALPHA (Logistic Regression)`, dengan disclaimer "EKSPERIMEN — MASIH FORWARD-TEST, JANGAN dipakai uang asli"
- Endpoint baru `GET /api/cron/ml-results` — ringkasan win rate ML, terpisah dari `/api/cron/results` (rule-based)
- Threshold sinyal: probabilitas >= 0.52 (BUY dan SELL dievaluasi terpisah, side dengan probabilitas tertinggi yang dipilih)
- VERIFIED LIVE (deploy 6 Juli 2026): 2 sinyal ML pertama terkirim sukses — DOGEUSDT BUY @ 0.07814, AVAXUSDT BUY @ 6.923

### Perjalanan Teknis Menuju Model Ini (ringkasan dari sesi-sesi sebelumnya)
1. Dataset diperbesar dari 2.3 tahun → ~6 tahun (2020-2026, H4_BATCHES 5→14), 9204 baris, 6 pair (BTC/ETH/BNB/SOL/LINK/DOGE)
2. Model dasar (37 fitur): SELL kuat (8/8 fold walk-forward), BUY tidak stabil (5/8 fold)
3. Ditemukan lewat riset literatur (Palazzi 2025 J.Futures Markets, dll): volatility regime penting, TAPI filter keras (trend1d sebagai syarat wajib) justru MEMPERBURUK hasil — solusinya masukkan sebagai FITUR yang dilatih, bukan filter manual
4. Fitur `rolling_vol_pct` (percentile bb_bandwidth rolling 90 hari, no lookahead) ditambahkan → BUY naik ke 7/8 fold, SELL jadi 8/8 (sempurna)
5. Fold 8 BUY yang masih gagal dibedah tuntas: TERBUKTI downtrend market-wide serentak di semua 6 pair, gagal di semua hyperparameter — bukan cacat model, memang tidak ada peluang BUY yang bisa ditemukan di periode itu
6. Fitur market breadth dicoba (persentase pair lain yang bearish/bullish) — HASIL: memperburuk SELL (8/8→6/8), TIDAK dipakai
7. Model FINAL: 38 fitur (37 asli + rolling_vol_pct), dilatih pakai SELURUH data historis, tersimpan di scripts/output/model-buy-final.json dan model-sell-final.json
8. Leave-one-pair-out (test di pair yang tidak pernah dilihat model): 12/12 konsisten (BUY & SELL, 6 pair) — model general TERBUKTI bisa dipakai untuk pair baru tanpa retrain
9. General vs per-pair model: general MENANG untuk SELL (4/6 pair, avg improvement lebih tinggi), per-pair BUY "menang" tapi indikasi overfitting (avg improvement malah lebih rendah) — KEPUTUSAN: pakai model general

### Detail Implementasi Teknis (penting untuk sesi berikutnya)
- File model: `artifacts/api-server/src/lib/models/model-buy-final.json` dan `model-sell-final.json` — di-import LANGSUNG sebagai JSON module (bukan fs.readFileSync), karena esbuild bundle JSON secara native ke dalam `dist/index.mjs` — TIDAK butuh `resolveJsonModule` di tsconfig SEBENARNYA untuk esbuild, tapi ditambahkan juga di `tsconfig.json` LOKAL api-server (bukan tsconfig.base.json global) untuk keperluan `tsc --noEmit` typecheck
- Engine prediksi: `artifacts/api-server/src/lib/ml-signal-engine.ts` — fungsi `computeMlSignal(pair)`, hitung fitur PERSIS sama seperti training (termasuk approksimasi volH1/volH6 dari volume daily, BUKAN fetch 1H asli — supaya distribusi fitur konsisten dengan training)
- rolling_vol_pct dihitung live dari histori bollinger bandwidth 90 hari terakhir (fungsi `computeRollingVolPct()`), fallback ke 0.5 (netral) kalau data kurang dari threshold
- PENTING: mean/std standardisasi WAJIB pakai yang tersimpan di file model (dari training), TIDAK dihitung ulang dari data live
- Build project ini pakai esbuild bundle (`bundle: true`, format esm, satu file `dist/index.mjs`) — BUKAN `tsc` compile biasa. File pendukung (JSON, dll) HARUS di-import langsung di kode biar ikut ter-bundle, TIDAK BISA taruh di folder terpisah dan diakses via path relatif runtime (`__dirname` tidak reliable di ESM bundle)
- Verifikasi WAJIB sebelum deploy: build lokal (`pnpm run build`) + jalankan hasil build lokal beberapa detik sebelum push — cara ini berhasil menangkap masalah `resolveJsonModule` SEBELUM sempat gagal deploy di Render

### Belum Dikerjakan (lanjutkan sesi berikutnya)
1. **PANTAU shadow ML signal** — kumpulkan minimal 15-20 sinyal closed sebelum evaluasi awal (sesuai standing instruction), 50+ untuk kesimpulan lebih meyakinkan
2. Endpoint `/api/cron/ml-results` siap dipakai untuk cek progress kapan saja
3. JANGAN ganti signal engine production dari rule-based ke ML sampai forward-test membuktikan konsisten lebih baik
4. Breakout BUY (Lookback 10 hari, riset lama sebelum era logistic regression) — pertimbangkan apakah masih relevan dibanding logistic regression BUY yang sekarang sudah solid, atau bandingkan keduanya nanti
5. Leverage & position sizing recommendation di Telegram — belum dikerjakan (prioritas lama, masih tertunda)
6. Kalau nanti mau tambah pair baru: model general seharusnya langsung bisa dipakai (terbukti dari leave-one-pair-out), TAPI tetap pantau performa live-nya dulu sebelum yakin sepenuhnya

### Catatan File Riset (semua di scripts/src/, tidak menyentuh production)
build-ml-dataset.ts, train-logistic-model.ts, validate-model-robustness.ts, compare-perpair-vs-general.ts, test-regime-filters.ts, check-feature-correlation.ts, retrain-with-volatility.ts, investigate-fold8-and-leaveoneout.ts, retrain-with-breadth.ts, train-final-model.ts, investigate-buy-instability.ts, test-ml-signal-engine.ts — semua aman dijalankan ulang kapan saja untuk riset lanjutan.

---

## Sesi 6 Juli 2026 (lanjutan) — Shadow ML Signal Ditambahkan ke Dashboard ✅

### Yang Dikerjakan
- Section baru "🧪 Shadow ML Signal (Logistic Regression — Eksperimen)" ditambahkan ke `/api/cron/dashboard`, diposisikan di antara section "Signal Trading" dan "Meme Coin"
- Tabel menampilkan: Pair, Side, Prob Buy, Prob Sell, Entry, Status, Close, PnL (dari modal virtual $100), Sent — pola sama persis dengan tabel Signal Trading yang sudah ada (fetch harga live dari `/api/binance/ticker` untuk PnL unrealized)
- Endpoint `/api/cron/ml-results` dipatch: sekarang juga mengirim field `signals` (array data mentah tiap sinyal ML), sebelumnya cuma kirim ringkasan `byPair`
- Build lokal diverifikasi dulu (`pnpm run build`) sebelum push — konsisten dengan langkah aman yang sudah terbukti sebelumnya

### Cara Cek Progress
- Dashboard visual: https://nexus-alpha-j3yb.onrender.com/api/cron/dashboard (section Shadow ML Signal, auto-refresh 60 detik)
- Endpoint API mentah: https://nexus-alpha-j3yb.onrender.com/api/cron/ml-results

### State Saat Ini
- Shadow ML signal LIVE sejak 6 Juli 2026, 2 sinyal pertama tercatat: DOGEUSDT BUY @ 0.07814, AVAXUSDT BUY @ 6.923 (keduanya masih OPEN, forward-test berjalan)
- SEMUA sistem lain (rule-based CRON, meme, whale, dex-radar) tetap berjalan normal tanpa regresi

### Belum Dikerjakan (lanjutkan sesi berikutnya)
1. **PANTAU** — kumpulkan minimal 15-20 sinyal ML closed sebelum pembacaan awal (sesuai standing instruction), 50+ untuk kesimpulan lebih meyakinkan. Cek dashboard atau `/api/cron/ml-results` secara berkala.
2. JANGAN ganti signal engine production dari rule-based ke ML sampai forward-test membuktikan konsisten lebih baik dalam sample yang cukup
3. Breakout BUY (Lookback 10 hari, riset lama) — belum dibandingkan dengan logistic regression BUY yang sekarang sudah solid
4. Leverage & position sizing recommendation di Telegram — masih belum dikerjakan (prioritas lama)
5. Kalau nanti nambah pair baru — model general seharusnya langsung bisa dipakai (terbukti leave-one-pair-out), tapi tetap pantau performa live-nya dulu

### Catatan Penting untuk Sesi Berikutnya
- SEMUA infrastruktur ML (model, engine, cron, tabel DB, dashboard) sudah lengkap dan live — sesi berikutnya TIDAK perlu membangun apa-apa lagi soal ini, cukup PANTAU hasil forward-test
- Kalau ingin retrain model dengan data lebih baru nanti (misal setelah beberapa bulan), alurnya: jalankan ulang scripts/src/build-ml-dataset.ts (update dataset) → scripts/src/train-final-model.ts (retrain) → copy model JSON baru ke artifacts/api-server/src/lib/models/ → build & deploy ulang
