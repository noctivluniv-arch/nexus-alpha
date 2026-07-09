import {
  pgTable, serial, varchar, text, real, timestamp,
} from "drizzle-orm/pg-core";

/**
 * confluence_signal_log
 *
 * Forward-test untuk ide "confluence" (disepakati 8 Juli 2026, bagian D4.3):
 * token yang SAMA kena flag GEM/PUMP_IMMINENT di meme scanner DAN dibeli oleh
 * wallet yang sudah berstatus "trusted" sendiri (lihat whale_wallet_scores) —
 * dua sumber independen searah, berpotensi jauh lebih kuat dari masing-masing
 * sendirian. MASIH HIPOTESIS, makanya dicatat di sini untuk divalidasi dulu
 * dengan data nyata sebelum dipakai sebagai sinyal beli/jual.
 *
 * Satu baris = satu kejadian overlap yang terdeteksi (token + wallet trusted
 * + waktu). Dipantau ATH/last price-nya sama seperti signal log lain.
 */
export const confluenceSignalLog = pgTable("confluence_signal_log", {
  id:              serial("id").primaryKey(),
  tokenAddress:    text("token_address").notNull(),
  tokenSymbol:     varchar("token_symbol", { length: 40 }),
  chain:           varchar("chain", { length: 20 }).notNull(),
  walletAddress:   text("wallet_address").notNull(),
  walletMedianPnlPct: real("wallet_median_pnl_pct"),
  walletWinRatePct:   real("wallet_win_rate_pct"),
  memeTriggerLabel: varchar("meme_trigger_label", { length: 30 }), // GEM | PUMP_IMMINENT | BOTH
  detectedVia:     varchar("detected_via", { length: 20 }).notNull(), // WHALE_FIRST | MEME_FIRST

  priceAtDetection: real("price_at_detection"),
  lastPrice:       real("last_price"),
  athPrice:        real("ath_price"),
  athMultiplier:   real("ath_multiplier"),
  lastCheckedAt:   timestamp("last_checked_at"),

  status:          varchar("status", { length: 20 }).notNull().default("TRACKING"), // TRACKING | DEAD | STOPPED
  detectedAt:      timestamp("detected_at").defaultNow(),
});

export type ConfluenceSignalLog = typeof confluenceSignalLog.$inferSelect;
export type InsertConfluenceSignalLog = typeof confluenceSignalLog.$inferInsert;
