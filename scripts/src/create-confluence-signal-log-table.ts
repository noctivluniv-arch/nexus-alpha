/**
 * create-confluence-signal-log-table.ts
 *
 * One-time script untuk membuat tabel confluence_signal_log — forward-test
 * ide "confluence" (token GEM/PUMP_IMMINENT + dibeli wallet trusted).
 * Lihat komentar lengkap di lib/db/src/schema/confluence-signal-log.ts.
 *
 * IDEMPOTENT — aman dijalankan berulang (pakai IF NOT EXISTS).
 *
 * Jalankan:
 *   cd ~/nexus-alpha
 *   DATABASE_URL="postgresql://...?sslmode=require" tsx scripts/src/create-confluence-signal-log-table.ts
 */

import pg from "pg";

const { Client } = pg;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL belum di-set. Contoh:");
    console.error('   DATABASE_URL="postgresql://...?sslmode=require" tsx scripts/src/create-confluence-signal-log-table.ts');
    process.exit(1);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  console.log("Membuat tabel confluence_signal_log (kalau belum ada)...");
  await client.query(`
    CREATE TABLE IF NOT EXISTS confluence_signal_log (
      id                     SERIAL PRIMARY KEY,
      token_address          TEXT NOT NULL,
      token_symbol           VARCHAR(40),
      chain                  VARCHAR(20) NOT NULL,
      wallet_address         TEXT NOT NULL,
      wallet_median_pnl_pct  REAL,
      wallet_win_rate_pct    REAL,
      meme_trigger_label     VARCHAR(30),
      detected_via           VARCHAR(20) NOT NULL,
      price_at_detection     REAL,
      last_price             REAL,
      ath_price              REAL,
      ath_multiplier         REAL,
      last_checked_at        TIMESTAMP,
      status                 VARCHAR(20) NOT NULL DEFAULT 'TRACKING',
      detected_at            TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log("✅ Tabel confluence_signal_log siap.");

  await client.end();
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
