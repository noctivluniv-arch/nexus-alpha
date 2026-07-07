import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS circuit_breaker (
      pair VARCHAR(20) PRIMARY KEY,
      consecutive_losses INTEGER NOT NULL DEFAULT 0,
      last_loss_at TIMESTAMP,
      paused_until TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  console.log("✅ Tabel circuit_breaker dibuat (atau sudah ada sebelumnya)");
  await pool.end();
}

main().catch((err) => {
  console.error("❌ Gagal buat tabel:", err);
  process.exit(1);
});
