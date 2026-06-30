/**
 * seed-ohlcv.ts
 *
 * One-time script untuk seed historical OHLCV daily dari Bybit ke PostgreSQL.
 * Script ini IDEMPOTENT — aman dijalankan berulang kali (duplicate di-skip).
 *
 * Jalankan:
 *   cd ~/nexus-alpha
 *   DATABASE_URL="postgresql://..." tsx scripts/src/seed-ohlcv.ts
 *
 * Atau kalau DATABASE_URL sudah ada di .env:
 *   dotenv -e .env -- tsx scripts/src/seed-ohlcv.ts
 *
 * Estimasi waktu: 2–3 menit (10 pairs × 4 batch API calls)
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { pgTable, serial, varchar, bigint, text, timestamp, unique } from "drizzle-orm/pg-core";

// ─── Inline schema (hindari masalah build dependency) ────────────────────────
const ohlcvDaily = pgTable(
  "ohlcv_daily",
  {
    id:          serial("id").primaryKey(),
    pair:        varchar("pair", { length: 20 }).notNull(),
    timestampMs: bigint("timestamp_ms", { mode: "number" }).notNull(),
    open:        text("open").notNull(),
    high:        text("high").notNull(),
    low:         text("low").notNull(),
    close:       text("close").notNull(),
    volume:      text("volume").notNull(),
    createdAt:   timestamp("created_at").defaultNow(),
  },
  (t) => ({
    pairTsUniq: unique("ohlcv_daily_pair_ts_uniq").on(t.pair, t.timestampMs),
  }),
);

// ─── DB setup ────────────────────────────────────────────────────────────────
if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL tidak di-set");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db   = drizzle(pool);

// ─── Config ──────────────────────────────────────────────────────────────────
const PAIRS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SUIUSDT",
  "SOLUSDT", "HYPEUSDT", "LINKUSDT", "XRPUSDT",
  "DOGEUSDT", "AVAXUSDT",
];
const DAILY_BATCHES = 4;  // 4 × 1000 = up to 4000 candles (~10.9 tahun)
const INSERT_BATCH  = 200;

// ─── Paginated fetch ─────────────────────────────────────────────────────────
interface RawCandle {
  pair:        string;
  timestampMs: number;
  open:        string;
  high:        string;
  low:         string;
  close:       string;
  volume:      string;
}

async function fetchDailyAll(symbol: string): Promise<RawCandle[]> {
  const batches: any[][] = [];
  let endTime: number | undefined = undefined;

  for (let b = 0; b < DAILY_BATCHES; b++) {
    const params: Record<string, string> = {
      category: "spot",
      symbol,
      interval: "D",
      limit:    "1000",
    };
    if (endTime !== undefined) params.end = String(endTime);

    const url = `https://api.bybit.com/v5/market/kline?${new URLSearchParams(params)}`;
    const res  = await fetch(url);
    if (!res.ok) break;
    const json = (await res.json()) as any;
    if (json.retCode !== 0) break;

    const raw: any[] = [...(json.result?.list ?? [])];
    if (raw.length === 0) break;

    raw.reverse();        // oldest first
    batches.unshift(raw); // prepend → chronological order

    endTime = parseInt(raw[0][0], 10) - 1;
    if (raw.length < 1000) break;
    await new Promise(r => setTimeout(r, 400));
  }

  const result: RawCandle[] = [];
  for (const batch of batches) {
    for (const k of batch) {
      result.push({
        pair:        symbol,
        timestampMs: parseInt(k[0], 10),
        open:   k[1],
        high:   k[2],
        low:    k[3],
        close:  k[4],
        volume: k[5],
      });
    }
  }
  return result;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(60));
  console.log("NEXUS ALPHA — OHLCV Daily Seeder");
  console.log(`Pairs  : ${PAIRS.join(", ")}`);
  console.log(`Batches: ${DAILY_BATCHES} × 1000 per pair`);
  console.log("=".repeat(60));

  let grandTotal = 0;

  for (const pair of PAIRS) {
    process.stdout.write(`\n[${pair}] Fetching... `);

    let candles: RawCandle[];
    try {
      candles = await fetchDailyAll(pair);
    } catch (err) {
      console.error(`❌ gagal:`, err);
      continue;
    }
    console.log(`${candles.length} candles`);

    let inserted = 0;
    for (let i = 0; i < candles.length; i += INSERT_BATCH) {
      const batch = candles.slice(i, i + INSERT_BATCH);
      await db.insert(ohlcvDaily).values(batch).onConflictDoNothing();
      inserted += batch.length;
    }

    console.log(`[${pair}] ✅ ${inserted} rows (duplicate di-skip otomatis)`);
    grandTotal += inserted;
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Total rows diproses: ${grandTotal}`);
  console.log("=".repeat(60));
  await pool.end();
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
