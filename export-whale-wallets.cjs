// export-whale-wallets.cjs
// Tujuan: agregasi performa PER WALLET dari data whale_alerts, supaya kita bisa
// lihat wallet mana yang track record-nya beneran bagus (bukan cuma ikut label GMGN).
// Cara jalan: DATABASE_URL="..." node export-whale-wallets.cjs

const { Client } = require("pg");
const fs = require("fs");

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  // Agregasi per wallet: minimal 2 alert supaya ada dasar untuk dinilai
  // (wallet yang cuma sekali muncul belum bisa dibilang "track record")
  const result = await client.query(`
    SELECT
      wallet_address,
      chain,
      COUNT(*) AS total_alerts,
      ROUND(AVG(ath_multiplier)::numeric, 3) AS avg_ath_multiplier,
      COUNT(*) FILTER (WHERE ath_multiplier >= 2) AS count_ge_2x,
      COUNT(*) FILTER (WHERE ath_multiplier >= 5) AS count_ge_5x,
      COUNT(*) FILTER (WHERE status = 'DEAD') AS count_dead,
      ROUND(AVG(
        CASE WHEN price_at_alert IS NOT NULL AND price_at_alert > 0 AND last_price IS NOT NULL
        THEN (last_price - price_at_alert) / price_at_alert * 100
        ELSE NULL END
      )::numeric, 2) AS avg_pnl_now_pct,
      MIN(sent_at) AS first_seen,
      MAX(sent_at) AS last_seen
    FROM whale_alerts
    GROUP BY wallet_address, chain
    HAVING COUNT(*) >= 2
    ORDER BY avg_ath_multiplier DESC NULLS LAST;
  `);

  fs.writeFileSync(
    "export-whale-wallet-performance.json",
    JSON.stringify(result.rows, null, 2)
  );
  console.log(`Ditemukan ${result.rows.length} wallet dengan >= 2 alert.`);
  console.log(`Disimpan ke export-whale-wallet-performance.json`);

  // Sekalian ringkasan keseluruhan (semua wallet, termasuk yang cuma 1x muncul)
  const summary = await client.query(`
    SELECT
      COUNT(DISTINCT wallet_address) AS total_unique_wallets,
      COUNT(*) AS total_alerts,
      ROUND(AVG(ath_multiplier)::numeric, 3) AS overall_avg_ath_multiplier
    FROM whale_alerts;
  `);
  console.log("\nRingkasan keseluruhan:", summary.rows[0]);

  await client.end();
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
