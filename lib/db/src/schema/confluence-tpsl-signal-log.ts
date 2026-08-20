import {
  pgTable, serial, varchar, text, real, timestamp,
} from "drizzle-orm/pg-core";

/**
 * confluence_tpsl_signal_log
 *
 * Forward-test TP+20%/SL-8% KHUSUS untuk token yang lolos CONFLUENCE
 * (dibeli wallet trusted DAN kena flag GEM/PUMP di meme scanner) — bukan
 * semua coin GEM/PUMP generik.
 *
 * Latar belakang (18 Agustus 2026, lihat CLAUDE_CONTEXT.md): shadow forward-test
 * generik (`meme_tpsl_signal_log`) DIHENTIKAN karena plateau di win rate ~28,3%
 * (breakeven butuh ~31%) dari 2.172 closed — bukti sample besar bahwa TP/SL ini
 * tidak profitable untuk SEMBARANG coin GEM/PUMP. TAPI token yang lolos
 * confluence (VIBE 12,2x, "01" 4,73x) menunjukkan performa jauh lebih baik dari
 * rata-rata coin generik. Eksperimen ini menguji hipotesis: apakah filter
 * confluence (entry yang lebih selektif) memperbaiki win rate, dengan RASIO
 * TP/SL YANG SAMA PERSIS (+20%/-8%) — supaya perbandingan apple-to-apple,
 * cuma satu variabel yang beda (kualitas entry), bukan aturan exit.
 *
 * MASIH HIPOTESIS — belum tervalidasi, JANGAN dipakai keputusan uang asli.
 */
export const confluenceTpslSignalLog = pgTable("confluence_tpsl_signal_log", {
  id:              serial("id").primaryKey(),
  tokenAddress:    text("token_address").notNull(),
  tokenSymbol:     varchar("token_symbol", { length: 40 }),
  chain:           varchar("chain", { length: 20 }),
  walletAddress:   text("wallet_address"),
  detectedVia:     varchar("detected_via", { length: 20 }), // WHALE_FIRST | MEME_FIRST
  entryPrice:      real("entry_price").notNull(),
  tp:              real("tp").notNull(),   // entryPrice * 1.20
  sl:              real("sl").notNull(),   // entryPrice * 0.92
  lastPrice:       real("last_price"),
  status:          varchar("status", { length: 20 }).notNull().default("TRACKING"), // TRACKING | TP_HIT | SL_HIT | EXPIRED | DEAD
  closedPrice:     real("closed_price"),
  closedAt:        timestamp("closed_at"),
  detectedAt:      timestamp("detected_at").defaultNow(),
  lastCheckedAt:   timestamp("last_checked_at"),
});

export type ConfluenceTpslSignalLog = typeof confluenceTpslSignalLog.$inferSelect;
export type InsertConfluenceTpslSignalLog = typeof confluenceTpslSignalLog.$inferInsert;
