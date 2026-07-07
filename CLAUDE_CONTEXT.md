# Nexus Alpha — Context Snapshot
_Terakhir diupdate: 7 Juli 2026, 18:15_

## Ringkasan Proyek
Nexus Alpha: proyek personal crypto futures trading (monorepo), kirim sinyal trading via Telegram. Server produksi di Render (Linux), dev lokal di MacBook Air Apple Silicon (arm64). Owner bukan programmer — semua perubahan kode dilakukan lewat patch Python otomatis (bukan edit manual), selalu diverifikasi lewat `node --check` + `pnpm build` sebelum commit.

## Status Sistem Stabil (per 7 Juli 2026)
- **Pipeline sinyal:** `cron.ts` jalan tiap 10 menit → `signal-engine-realtime.ts` (rule-based, bukan AI) → data dari Bybit API (Binance di-drop karena IP Render kena rate-limit/418)
- **Confidence sweet spot:** 45–55 (tervalidasi backtest)
- **Telegram:** HTML parse_mode + `escapeHtml()` pada confluences text
- **Git tag checkpoint stabil:** `stable-telegram-signals`

## Circuit Breaker (live sejak 5 Juli 2026)
- Auto-pause per pair setelah 4 SL_HIT beruntun, auto-reset 7 hari, reset ke 0 saat TP3_HIT
- Fail-safe: error DB tidak menghalangi sinyal
- Endpoint: `GET /api/cron/circuit-breaker/status`, `POST /api/cron/circuit-breaker/reset/:pair`

## Trend1d Filter
Ditambahkan ke logika SELL — sinyal SELL hanya muncul kalau trend Daily (EMA50/200) juga BEARISH, selaras arah bias 4H.

## Riset Scoring Engine
- Rule near-S/R dan BOS confirmation ditemukan kontraproduktif
- Komponen TREND kena lagging indicator trap
- Formula VOLUME ada bug desain (mencegah skor tinggi)
- **Keputusan:** rebuild scoring pakai logistic regression (data-driven weights), bukan heuristik manual — belum dikerjakan

## Forward-Test Status (per 7 Juli 2026)
- **Rule-based SELL (production):** 6 sinyal closed, 0 win / 6 loss (0% WR) — konsisten dengan walk-forward validation (PF 0.95, di bawah breakeven). Circuit breaker belum trigger pause di pair manapun.
- **Shadow ML BUY/SELL:** 9 sinyal open dari threshold lama (0.52), 0 closed. Threshold sudah dinaikkan ke 0.65 (6 Juli) — belum ada data representatif untuk threshold baru.
- **Shadow Breakout BUY:** 0 sinyal — wajar, breakout momentum memang jarang trigger (backtest ~302 sinyal/5 tahun/6 pair)

## Sesi 7 Juli 2026 — Perbaikan Whale-Check DexScreener Rate Limit

**Masalah ditemukan:** Log Render menunjukkan hampir semua token di whale-check kena "data DexScreener tidak tersedia, skip".

**Investigasi:**
1. Cek `fetchDexScreenerData()` — endpoint `/latest/dex/tokens/{address}` dites manual via curl dengan alamat kontrak asli (RTM: `3d1qHSAkQhoN7kN1C6tvpAArCkXWxwYdBng6taXCDM6u`) → berhasil, data valid
2. Cek `token_address` di DB (`whale_alerts` table, kolom asli: `wallet_address`, `token_symbol`, `token_address`) — data di DB sudah benar, sama dengan hasil curl manual
3. Kesimpulan: bukan masalah data, tapi koneksi Render→DexScreener. Ditambahkan debug logging (`[DEX-DEBUG]`) untuk pastikan.
4. Log debug konfirmasi: **HTTP 429 rate limit** dari DexScreener terhadap IP Render, bahkan setelah retry+backoff sampai 6 detik masih gagal.

**Root cause:** Terlalu banyak request individual (satu per token) ke DexScreener dalam waktu singkat dari IP Render yang sama.

**Fix:**
1. Tambah retry+backoff (4x percobaan, delay 0/1.5s/3s/6s) — belum cukup sendirian
2. **Refactor ke batch fetching** — DexScreener API mendukung multiple alamat sekaligus per request (dipisah koma, tes manual berhasil untuk 2+ token dalam 1 call)
3. `checkWhaleAlerts()` direstruktur jadi 3 pass:
   - Pass 1: filter alert valid (skip 30 hari expired, skip priceAtAlert invalid) — tanpa network call
   - Pass 2: fetch DexScreener secara batch (25 token/request, jeda 1 detik antar-batch)
   - Pass 3: proses tiap alert pakai data yang sudah didapat — tanpa network call lagi

**Fungsi baru:** `fetchDexScreenerBatch(addresses: string[])` — return `Map<address, {price, liquidity, mcap}>`, handle multiple pairs per response dengan grouping by `baseToken.address` (ambil liquidity terbesar per token)

**Verifikasi hasil (18:11 WIB):**
- 3650 total whale_alerts, mayoritas `lastCheckedAt` ter-update serentak (bukti batch processing bekerja)
- `athMultiplier` ter-update dengan angka valid (BENNY x13.3, VITALIK x30.5, dst)
- 747 DEAD (20.5%), 7.1% pernah 2x, 2.2% pernah 5x — angka realistis
- Beberapa token spesifik (ЛОСОСЬ `0x65089bf19d741bb746a939cbc32a5034d760cccc`, fwWBTC `0x2078f336fdd260f708bec4a20c82b063274e1b23`) tetap `lastPrice: null` — **bukan bug**, DexScreener memang tidak punya data pair untuk token ini (kemungkinan likuiditas sudah hilang total)

**Status: SELESAI ✅** — rate limit 429 teratasi, whale-check forward-test kembali jalan normal.

## Housekeeping Selesai (7 Juli 2026)
- Hapus 5 file `cron.ts.backup2` s/d `.backup6` (sudah tidak relevan, ter-track git)
- Hapus 5 file `whale-*.patch` lama (tidak pernah ter-track git)
- ⚠️ **Belum dikerjakan:** `node_modules` masih ke-track di git — item terpisah, high-risk, butuh sesi khusus

## Agenda Selanjutnya (belum dikerjakan)
1. Tunggu forward-test ML BUY (threshold 0.65 baru) dan Breakout BUY kumpulkan cukup data
2. Filter berdasarkan `sentAt`/`probBuy` saat evaluasi nanti (biar tidak ikut data dari threshold lama)
3. Bandingkan performa rule-based vs ML vs Breakout setelah data cukup
4. Rebuild scoring engine pakai logistic regression (data-driven weights) — keputusan sudah diambil, implementasi belum mulai
5. Cleanup `node_modules` dari git tracking — high-risk, sesi terpisah
