// export-data.cjs
// Tujuan: export data sinyal ke file JSON supaya bisa dianalisis tanpa screenshot.
// Cara jalan: DATABASE_URL="..." node export-data.cjs

const { Client } = require("pg");
const fs = require("fs");

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  // 1. Signal log (rule-based)
  const signalLog = await client.query(`SELECT * FROM signal_log ORDER BY id;`);
  fs.writeFileSync(
    "export-signal_log.json",
    JSON.stringify(signalLog.rows, null, 2)
  );
  console.log(`signal_log: ${signalLog.rows.length} baris disimpan ke export-signal_log.json`);

  // 2. ML signal log (shadow ML)
  const mlLog = await client.query(`SELECT * FROM ml_signal_log ORDER BY id;`);
  fs.writeFileSync(
    "export-ml_signal_log.json",
    JSON.stringify(mlLog.rows, null, 2)
  );
  console.log(`ml_signal_log: ${mlLog.rows.length} baris disimpan ke export-ml_signal_log.json`);

  // 3. Breakout signal log (shadow breakout)
  const breakoutLog = await client.query(`SELECT * FROM breakout_signal_log ORDER BY id;`);
  fs.writeFileSync(
    "export-breakout_signal_log.json",
    JSON.stringify(breakoutLog.rows, null, 2)
  );
  console.log(`breakout_signal_log: ${breakoutLog.rows.length} baris disimpan ke export-breakout_signal_log.json`);

  // 4. Meme signal log
  const memeLog = await client.query(`SELECT * FROM meme_signal_log ORDER BY id;`);
  fs.writeFileSync(
    "export-meme_signal_log.json",
    JSON.stringify(memeLog.rows, null, 2)
  );
  console.log(`meme_signal_log: ${memeLog.rows.length} baris disimpan ke export-meme_signal_log.json`);

  // 5. Whale alerts - ringkasan saja (3795 baris terlalu banyak untuk full dump)
  const whaleColumns = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'whale_alerts';
  `);
  fs.writeFileSync(
    "export-whale_alerts_columns.json",
    JSON.stringify(whaleColumns.rows, null, 2)
  );
  console.log(`whale_alerts: daftar kolom disimpan ke export-whale_alerts_columns.json (untuk cek struktur dulu)`);

  await client.end();
  console.log("\nSELESAI. Semua file export-*.json ada di folder ini, tinggal di-upload.");
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
