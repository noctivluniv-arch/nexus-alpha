/**
 * create-meme-tpsl-signal-log-table.ts
 *
 * One-time script untuk membuat tabel meme_tpsl_signal_log — forward-test
 * strategi exit TP+20%/SL-8% pada meme coin GEM/PUMP_IMMINENT (lihat
 * CLAUDE_CONTEXT.md bagian D2 untuk latar belakang backtest-nya).
 *
 * IDEMPOTENT — aman dijalankan berulang (pakai IF NOT EXISTS).
 *
 * Jalankan:
 *   cd ~/nexus-alpha
 *   DATABASE_URL="postgresql://...?sslmode=require" tsx scripts/src/create-meme-tpsl-signal-log-table.ts
 */

import pg from "pg";

const { Client } = pg;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL belum di-set. Contoh:");
    console.error('   DATABASE_URL="postgresql://...?sslmode=require" tsx scripts/src/create-meme-tpsl-signal-log-table.ts');
    process.exit(1);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  console.log("Membuat tabel meme_tpsl_signal_log (kalau belum ada)...");
  await client.query(`
    CREATE TABLE IF NOT EXISTS meme_tpsl_signal_log (
      id                 SERIAL PRIMARY KEY,
      coin_id            TEXT NOT NULL,
      symbol             VARCHAR(40),
      network            VARCHAR(20),
      contract_address   TEXT,
      entry_price        REAL NOT NULL,
      tp                 REAL NOT NULL,
      sl                 REAL NOT NULL,
      last_price         REAL,
      status             VARCHAR(20) NOT NULL DEFAULT 'TRACKING',
      closed_price       REAL,
      closed_at          TIMESTAMP,
      detected_at        TIMESTAMP DEFAULT NOW(),
      last_checked_at    TIMESTAMP
    );
  `);
  console.log("✅ Tabel meme_tpsl_signal_log siap.");

  await client.end();
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
