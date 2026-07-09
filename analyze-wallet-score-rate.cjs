// analyze-wallet-score-rate.cjs
// Tujuan: hitung rate aktual (bukan tebakan) untuk 2 hal:
// 1. Berapa lama rata-rata 1 wallet butuh untuk kumpul cukup alert (>=8) buat
//    dievaluasi status trusted-nya, dan berapa wallet per minggu yang mendekati itu.
// 2. Apakah sudah ada overlap ("confluence") antara wallet trusted dan token yang
//    di-flag GEM/PUMP_IMMINENT di meme scanner (meme_signal_log) — kalau sudah ada,
//    seberapa sering dan seberapa dekat waktunya.
//
// Cara jalan: DATABASE_URL="..." node analyze-wallet-score-rate.cjs

const { Client } = require("pg");

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  console.log("═══════════════════════════════════════════════════════");
  console.log("1. RINGKASAN UMUM whale_alerts");
  console.log("═══════════════════════════════════════════════════════");
  const overall = await client.query(`
    SELECT
      COUNT(DISTINCT wallet_address) AS total_unique_wallets,
      COUNT(*) AS total_alerts,
      MIN(sent_at) AS first_alert,
      MAX(sent_at) AS last_alert,
      EXTRACT(EPOCH FROM (MAX(sent_at) - MIN(sent_at))) / 86400 AS span_days
    FROM whale_alerts;
  `);
  const o = overall.rows[0];
  console.log(`Total wallet unik terpantau : ${o.total_unique_wallets}`);
  console.log(`Total alert tercatat        : ${o.total_alerts}`);
  console.log(`Rentang waktu data          : ${o.first_alert} s/d ${o.last_alert} (${parseFloat(o.span_days).toFixed(1)} hari)`);

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("2. DISTRIBUSI WALLET BERDASARKAN JUMLAH ALERT SAAT INI");
  console.log("═══════════════════════════════════════════════════════");
  const distribution = await client.query(`
    WITH per_wallet AS (
      SELECT wallet_address, chain, COUNT(*) AS n
      FROM whale_alerts
      GROUP BY wallet_address, chain
    )
    SELECT
      COUNT(*) FILTER (WHERE n = 1) AS wallets_1_alert,
      COUNT(*) FILTER (WHERE n BETWEEN 2 AND 4) AS wallets_2_4_alerts,
      COUNT(*) FILTER (WHERE n BETWEEN 5 AND 7) AS wallets_5_7_alerts,
      COUNT(*) FILTER (WHERE n >= 8) AS wallets_8plus_alerts
    FROM per_wallet;
  `);
  const d = distribution.rows[0];
  console.log(`Wallet dengan 1 alert saja      : ${d.wallets_1_alert}`);
  console.log(`Wallet dengan 2-4 alert         : ${d.wallets_2_4_alerts}`);
  console.log(`Wallet dengan 5-7 alert (DEKAT!): ${d.wallets_5_7_alerts}  ← ini kandidat yang paling mungkin naik status trusted duluan`);
  console.log(`Wallet dengan >=8 alert         : ${d.wallets_8plus_alerts}  (sudah dievaluasi kriteria trusted)`);

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("3. RATE: BERAPA HARI RATA-RATA 1 WALLET AKTIF DAPAT 1 ALERT BARU");
  console.log("═══════════════════════════════════════════════════════");
  const rate = await client.query(`
    WITH per_wallet AS (
      SELECT
        wallet_address, chain,
        COUNT(*) AS n,
        EXTRACT(EPOCH FROM (MAX(sent_at) - MIN(sent_at))) / 86400 AS active_span_days
      FROM whale_alerts
      GROUP BY wallet_address, chain
      HAVING COUNT(*) >= 2
    )
    SELECT
      ROUND(AVG(n / NULLIF(active_span_days, 0))::numeric, 3) AS avg_alerts_per_day_per_wallet,
      ROUND(AVG(active_span_days)::numeric, 2) AS avg_active_span_days,
      COUNT(*) AS wallets_considered
    FROM per_wallet
    WHERE active_span_days > 0;
  `);
  const r = rate.rows[0];
  const alertsPerDay = parseFloat(r.avg_alerts_per_day_per_wallet) || 0;
  console.log(`Rata-rata alert/hari per wallet aktif (n>=2) : ${r.avg_alerts_per_day_per_wallet ?? "N/A"}`);
  console.log(`Dihitung dari                                : ${r.wallets_considered} wallet`);
  if (alertsPerDay > 0) {
    const daysNeededFor8 = Math.ceil(8 / alertsPerDay);
    const weeksNeeded = (daysNeededFor8 / 7).toFixed(1);
    console.log(`\n→ Estimasi: wallet yang KONSISTEN aktif butuh ~${daysNeededFor8} hari (~${weeksNeeded} minggu)`);
    console.log(`  transaksi terus-menerus untuk mengumpulkan 8 alert dari NOL.`);
    console.log(`  (Catatan: ini best-case, asumsi wallet aktif stabil — banyak wallet`);
    console.log(`  sebenarnya cuma transaksi sesekali, jadi variasi antar-wallet besar.)`);
  }

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("4. WALLET BARU MASUK PER MINGGU (rate pertumbuhan radar)");
  console.log("═══════════════════════════════════════════════════════");
  const newWalletsPerWeek = await client.query(`
    WITH first_seen AS (
      SELECT wallet_address, chain, MIN(sent_at) AS first_alert_at
      FROM whale_alerts
      GROUP BY wallet_address, chain
    )
    SELECT
      DATE_TRUNC('week', first_alert_at) AS week_start,
      COUNT(*) AS new_wallets
    FROM first_seen
    GROUP BY 1
    ORDER BY 1;
  `);
  for (const row of newWalletsPerWeek.rows) {
    const wk = new Date(row.week_start).toISOString().slice(0, 10);
    console.log(`  Minggu mulai ${wk}: ${row.new_wallets} wallet baru`);
  }

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("5. CEK CONFLUENCE: token yang SAMA muncul di whale_alerts DAN meme_signal_log");
  console.log("═══════════════════════════════════════════════════════");
  const confluence = await client.query(`
    SELECT
      w.token_symbol,
      w.token_address,
      w.chain,
      w.wallet_address,
      w.trusted_at_alert,
      w.sent_at AS whale_alert_at,
      m.trigger_label,
      m.detected_at AS meme_detected_at,
      EXTRACT(EPOCH FROM (w.sent_at - m.detected_at)) / 3600 AS hours_gap
    FROM whale_alerts w
    INNER JOIN meme_signal_log m
      ON LOWER(w.token_address) = LOWER(m.contract_address)
    ORDER BY w.sent_at DESC;
  `);
  if (confluence.rows.length === 0) {
    console.log("Belum ada overlap sama sekali antara whale_alerts dan meme_signal_log.");
    console.log("(Wajar — dua sumber data ini independen, overlap butuh waktu lebih lama muncul.)");
  } else {
    console.log(`Ditemukan ${confluence.rows.length} kejadian overlap:`);
    for (const row of confluence.rows) {
      console.log(
        `  ${row.token_symbol} (${row.chain}) — wallet ${row.wallet_address.slice(0, 10)}... ` +
        `${row.trusted_at_alert ? "[TRUSTED]" : "[belum trusted]"}, ` +
        `meme trigger: ${row.trigger_label}, jarak waktu: ${parseFloat(row.hours_gap).toFixed(1)} jam`
      );
    }
  }

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("6. WALLET TRUSTED SAAT INI");
  console.log("═══════════════════════════════════════════════════════");
  const trusted = await client.query(`
    SELECT wallet_address, chain, total_alerts, win_rate_pct, median_pnl_pct, last_computed_at
    FROM whale_wallet_scores
    WHERE is_trusted = true
    ORDER BY median_pnl_pct DESC NULLS LAST;
  `);
  if (trusted.rows.length === 0) {
    console.log("Belum ada wallet trusted (kemungkinan tabel whale_wallet_scores belum pernah dihitung).");
  } else {
    for (const row of trusted.rows) {
      console.log(`  ${row.wallet_address} (${row.chain}) — ${row.total_alerts} alert, win rate ${row.win_rate_pct}%, median PnL ${row.median_pnl_pct}%`);
    }
  }

  await client.end();
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
