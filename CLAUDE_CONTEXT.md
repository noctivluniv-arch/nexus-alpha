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

## Bug Aktif Yang Perlu Diselesaikan
- File: artifacts/api-server/src/routes/memes.ts
- Error: "narrativeData is not defined" (ReferenceError scope)
- narrativeData didefinisikan di line 2154 (dalam scope evaluated map)
- Dipakai di line 2349-2352 (di luar scope tersebut, di bagian list = survivors.map)
- Akibat: halaman Memes error "Failed to load meme coins"
- Langkah debug: sed -n '2140,2200p' artifacts/api-server/src/routes/memes.ts

## File-File Kunci
- artifacts/api-server/src/routes/cron.ts — cron job & Telegram sender
- artifacts/api-server/src/routes/memes.ts — meme coin screener (ada bug narrativeData)
- artifacts/api-server/src/lib/signal-engine-realtime.ts — signal engine utama
- artifacts/api-server/src/lib/types.ts — SUPPORTED_PAIRS dan tipe data

## Cara Kerja Signal
1. Cron jalan tiap 10 menit
2. Fetch OHLCV dari Bybit untuk 9 pair
3. Hitung confidence score (rule-based)
4. Kalau confidence 45-55 DAN side != NO_TRADE → kirim Telegram
