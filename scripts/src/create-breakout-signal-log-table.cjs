const { Pool } = require("pg");

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS breakout_signal_log (
      id SERIAL PRIMARY KEY,
      pair VARCHAR(20) NOT NULL,
      entry_price REAL NOT NULL,
      sl REAL,
      tp REAL,
      atr14 REAL,
      vol_ratio REAL,
      status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
      closed_price REAL,
      closed_at TIMESTAMP,
      sent_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  console.log("✅ Tabel breakout_signal_log dibuat (atau sudah ada sebelumnya)");
  await pool.end();
}

main().catch((err) => {
  console.error("❌ Gagal buat tabel:", err);
  process.exit(1);
});
