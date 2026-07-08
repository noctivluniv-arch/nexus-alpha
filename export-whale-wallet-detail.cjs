// export-whale-wallet-detail.cjs
// Tujuan: lihat detail SETIAP alert dari wallet-wallet kandidat terbaik,
// supaya kita bisa cek apakah performa bagusnya konsisten atau cuma
// disumbang 1-2 token yang kebetulan meledak (outlier).
// Cara jalan: DATABASE_URL="..." node export-whale-wallet-detail.cjs

const { Client } = require("pg");
const fs = require("fs");

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  // Ambil SEMUA wallet dengan >=5 alert dan detail tiap alertnya,
  // supaya kita punya data lengkap untuk hitung median & win rate.
  const result = await client.query(`
    SELECT
      wallet_address,
      chain,
      token_symbol,
      price_at_alert,
      last_price,
      ath_multiplier,
      status,
      sent_at
    FROM whale_alerts
    WHERE wallet_address IN (
      SELECT wallet_address
      FROM whale_alerts
      GROUP BY wallet_address
      HAVING COUNT(*) >= 5
    )
    ORDER BY wallet_address, sent_at;
  `);

  fs.writeFileSync(
    "export-whale-wallet-detail.json",
    JSON.stringify(result.rows, null, 2)
  );
  console.log(`${result.rows.length} baris detail (dari wallet dengan >=5 alert) disimpan ke export-whale-wallet-detail.json`);

  await client.end();
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
