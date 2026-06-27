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
- Signal confidence sweet spot: 45-55 (hasil backtesting)
- Telegram notifications: aktif, cron tiap 10 menit via cron.ts
- escapeHtml() sudah diterapkan di confluences untuk cegah Telegram 400 error
- Git tag stable: stable-telegram-signals
- Meme cron: aktif, scan tiap 15 menit, alert kalau earlyGemLabel=GEM atau volumeSignal=PUMP_IMMINENT
- Meme cron cooldown: 30 menit per coin agar tidak spam

## Bug Aktif Yang Perlu Diselesaikan
- Tidak ada bug aktif saat ini.

## Bug Yang Sudah Diselesaikan
- File: artifacts/api-server/src/routes/memes.ts
- Error: "narrativeData is not defined" (ReferenceError scope) — FIXED ✓
- Root cause: narrativeData tidak di-return dari evaluated.map sehingga tidak tersedia di survivors.map
- Fix: tambah narrativeData ke return object evaluated.map dan destructuring survivors.map
- Tanggal fix: 2026-06-27

## File-File Kunci
- artifacts/api-server/src/routes/cron.ts — cron job & Telegram sender (signal + meme)
- artifacts/api-server/src/routes/memes.ts — meme coin screener
- artifacts/api-server/src/lib/signal-engine-realtime.ts — signal engine utama
- artifacts/api-server/src/lib/types.ts — SUPPORTED_PAIRS dan tipe data
- artifacts/api-server/src/index.ts — entry point, panggil startCron() dan startMemeCron()

## Cara Kerja Signal
1. Cron jalan tiap 10 menit
2. Fetch OHLCV dari Bybit untuk 9 pair
3. Hitung confidence score (rule-based)
4. Kalau confidence 45-55 DAN side != NO_TRADE → kirim Telegram

## Cara Kerja Meme Cron
1. Cron jalan tiap 15 menit via startMemeCron()
2. Fetch dari endpoint /ai/memes (reuse cache TTL 5 menit)
3. Filter: earlyGemLabel === "GEM" ATAU volumeSignal === "PUMP_IMMINENT"
4. Cooldown 30 menit per coin (Map in-memory)
5. Kirim Telegram alert dengan score lengkap (quality, viral, organic, earlyGem, narrative)
