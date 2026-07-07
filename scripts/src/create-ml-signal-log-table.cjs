const { Client } = require("pg");

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes("render.com") ? { rejectUnauthorized: false } : undefined });
  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS ml_signal_log (
      id SERIAL PRIMARY KEY,
      pair VARCHAR(20) NOT NULL,
      side VARCHAR(10) NOT NULL,
      prob_buy REAL NOT NULL,
      prob_sell REAL NOT NULL,
      confidence REAL NOT NULL,
      entry_price REAL NOT NULL,
      sl REAL,
      tp1 REAL,
      tp2 REAL,
      tp3 REAL,
      status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
      closed_price REAL,
      closed_at TIMESTAMP,
      sent_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log("✅ Tabel ml_signal_log siap (dibuat atau sudah ada sebelumnya)");
  await client.end();
}

main().catch((err) => { console.error("❌ Error:", err); process.exit(1); });
