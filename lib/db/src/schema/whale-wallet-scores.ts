import {
  pgTable, serial, varchar, text, integer, real, boolean, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * whale_wallet_scores
 *
 * Scoring wallet "smart money" versi kita SENDIRI, dihitung dari histori
 * `whale_alerts` yang sudah dikumpulkan — bukan ikut label GMGN mentah-mentah.
 *
 * Kenapa perlu ini (lihat analisis 8 Juli 2026, bagian D3): MEAN sangat
 * menyesatkan untuk data fat-tail seperti meme coin — satu wallet bisa
 * kelihatan hebat (avg +932%) padahal cuma didorong 1-2 token yang meledak,
 * sementara median transaksi aslinya minus. Jadi tabel ini WAJIB pakai
 * MEDIAN + win rate sebagai metrik utama, meanPnlPct cuma disimpan sebagai
 * pembanding/debug, BUKAN untuk keputusan trusted/tidak.
 *
 * Kriteria "trusted wallet" (disepakati): win rate > 70% DAN median PnL
 * positif DAN sample >= 8 alert. Dihitung ulang tiap hari oleh cron
 * (lihat computeWalletScores di routes/cron.ts).
 */
export const whaleWalletScores = pgTable("whale_wallet_scores", {
  id:             serial("id").primaryKey(),
  walletAddress:  text("wallet_address").notNull(),
  chain:          varchar("chain", { length: 20 }).notNull(),
  totalAlerts:    integer("total_alerts").notNull(),
  winRatePct:     real("win_rate_pct").notNull(),      // % transaksi dgn pnl > 0
  medianPnlPct:   real("median_pnl_pct"),               // metrik utama (fat-tail safe)
  meanPnlPct:     real("mean_pnl_pct"),                 // cuma pembanding, JANGAN dipakai keputusan
  countGe2x:      integer("count_ge_2x").notNull().default(0),
  isTrusted:      boolean("is_trusted").notNull().default(false),
  lastComputedAt: timestamp("last_computed_at").defaultNow(),
}, (table) => ({
  walletChainUnique: uniqueIndex("whale_wallet_scores_wallet_chain_idx").on(table.walletAddress, table.chain),
}));

export type WhaleWalletScore = typeof whaleWalletScores.$inferSelect;
export type InsertWhaleWalletScore = typeof whaleWalletScores.$inferInsert;
