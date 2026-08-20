/**
 * create-confluence-tpsl-signal-log-table.ts
 *
 * One-time script untuk membuat tabel confluence_tpsl_signal_log — forward-test
 * TP+20%/SL-8% khusus untuk token yang lolos confluence (bukan semua coin
 * GEM/PUMP generik). Lihat CLAUDE_CONTEXT.md 18 Agustus 2026 untuk latar belakang.
 *
 * IDEMPOTENT — aman dijalankan berulang (pakai IF NOT EXISTS).
 *
 * Jalankan:
 *   cd ~/nexus-alpha
 *   DATABASE_URL="postgresql://...?sslmode=require" tsx scripts/src/create-confluence-tpsl-signal-log-table.ts
 */

import pg from "pg";

const { Client } = pg;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL belum di-set. Contoh:");
    console.error('   DATABASE_URL="postgresql://...?sslmode=require" tsx scripts/src/create-confluence-tpsl-signal-log-table.ts');
    process.exit(1);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  console.log("Membuat tabel confluence_tpsl_signal_log (kalau belum ada)...");
  await client.query(`
    CREATE TABLE IF NOT EXISTS confluence_tpsl_signal_log (
      id                 SERIAL PRIMARY KEY,
      token_address      TEXT NOT NULL,
      token_symbol       VARCHAR(40),
      chain              VARCHAR(20),
      wallet_address     TEXT,
      detected_via       VARCHAR(20),
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
  console.log("✅ Tabel confluence_tpsl_signal_log siap.");

  await client.end();
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
