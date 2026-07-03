/**
 * create-whale-alerts-table.ts
 *
 * One-time script untuk membuat tabel whale_alerts di PostgreSQL.
 * IDEMPOTENT — aman dijalankan berulang (pakai IF NOT EXISTS).
 *
 * Jalankan:
 *   cd ~/nexus-alpha
 *   DATABASE_URL="postgresql://...?sslmode=require" tsx scripts/src/create-whale-alerts-table.ts
 */

import pg from "pg";

const { Client } = pg;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL belum di-set. Contoh:");
    console.error('   DATABASE_URL="postgresql://...?sslmode=require" tsx scripts/src/create-whale-alerts-table.ts');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log("Membuat tabel whale_alerts (kalau belum ada)...");

  await client.query(`
    CREATE TABLE IF NOT EXISTS whale_alerts (
      id                SERIAL PRIMARY KEY,
      chain             VARCHAR(20) NOT NULL,
      wallet_address     TEXT NOT NULL,
      side              VARCHAR(10) NOT NULL,
      token_address      TEXT NOT NULL,
      token_symbol       VARCHAR(40),
      amount_usd         REAL,
      price_at_alert     REAL,
      last_price         REAL,
      ath_price          REAL,
      ath_multiplier     REAL,
      last_checked_at    TIMESTAMP,
      tx_hash            TEXT,
      status            VARCHAR(20) NOT NULL DEFAULT 'TRACKING',
      sent_at            TIMESTAMP DEFAULT NOW()
    );
  `);

  console.log("✅ Tabel whale_alerts siap.");
  await client.end();
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
