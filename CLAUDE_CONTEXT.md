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
