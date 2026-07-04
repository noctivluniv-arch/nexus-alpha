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
