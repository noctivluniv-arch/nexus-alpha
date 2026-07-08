/**
 * create-whale-wallet-scores-table.ts
 *
 * One-time script untuk:
 * 1. Membuat tabel whale_wallet_scores (scoring wallet berbasis win rate + median PnL)
 * 2. Menambah kolom trusted_at_alert di whale_alerts (flag: apakah wallet sudah
 *    berstatus "trusted" pada saat alert ini dikirim — berguna untuk uji ide
 *    confluence: token GEM/PUMP_IMMINENT + dibeli wallet trusted, lihat rencana
 *    D4 di CLAUDE_CONTEXT.md)
 *
 * IDEMPOTENT — aman dijalankan berulang (pakai IF NOT EXISTS).
 *
 * Jalankan:
 *   cd ~/nexus-alpha
 *   DATABASE_URL="postgresql://...?sslmode=require" tsx scripts/src/create-whale-wallet-scores-table.ts
 */

import pg from "pg";

const { Client } = pg;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL belum di-set. Contoh:");
    console.error('   DATABASE_URL="postgresql://...?sslmode=require" tsx scripts/src/create-whale-wallet-scores-table.ts');
    process.exit(1);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  console.log("Membuat tabel whale_wallet_scores (kalau belum ada)...");
  await client.query(`
    CREATE TABLE IF NOT EXISTS whale_wallet_scores (
      id                 SERIAL PRIMARY KEY,
      wallet_address     TEXT NOT NULL,
      chain              VARCHAR(20) NOT NULL,
      total_alerts       INTEGER NOT NULL,
      win_rate_pct       REAL NOT NULL,
      median_pnl_pct     REAL,
      mean_pnl_pct       REAL,
      count_ge_2x        INTEGER NOT NULL DEFAULT 0,
      is_trusted         BOOLEAN NOT NULL DEFAULT FALSE,
      last_computed_at   TIMESTAMP DEFAULT NOW()
    );
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS whale_wallet_scores_wallet_chain_idx
    ON whale_wallet_scores (wallet_address, chain);
  `);
  console.log("✅ Tabel whale_wallet_scores siap.");

  console.log("Menambah kolom trusted_at_alert di whale_alerts (kalau belum ada)...");
  await client.query(`
    ALTER TABLE whale_alerts
    ADD COLUMN IF NOT EXISTS trusted_at_alert BOOLEAN NOT NULL DEFAULT FALSE;
  `);
  console.log("✅ Kolom trusted_at_alert siap.");

  await client.end();
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
