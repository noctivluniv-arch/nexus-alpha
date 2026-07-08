// list-tables.cjs
// Tujuan: melihat semua nama tabel + kolom yang ada di database,
// supaya kita tahu persis apa saja yang bisa di-export.
// Cara jalan: node list-tables.cjs

const { Client } = require("pg");

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // wajib kalau konek dari MacBook ke Render external URL
  });

  await client.connect();

  const tablesResult = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name;
  `);

  console.log("=== DAFTAR TABEL ===");
  for (const row of tablesResult.rows) {
    console.log("-", row.table_name);
  }

  console.log("\n=== JUMLAH BARIS PER TABEL ===");
  for (const row of tablesResult.rows) {
    const countResult = await client.query(
      `SELECT COUNT(*) FROM "${row.table_name}";`
    );
    console.log(`${row.table_name}: ${countResult.rows[0].count} baris`);
  }

  await client.end();
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
