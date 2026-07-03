import {
  pgTable, serial, varchar, text, real, timestamp,
} from "drizzle-orm/pg-core";

/**
 * whale_alerts
 *
 * Mencatat setiap transaksi "smart money" (wallet whale yang terbukti
 * profitable menurut GMGN) yang terdeteksi lewat gmgn-cli dan dikirim
 * ke Telegram. Dipakai untuk forward-testing: apakah token yang
 * dibeli smart money benar-benar naik setelahnya atau tidak.
 *
 * Sumber data: GMGN Smart Money track (bukan wallet pilihan manual),
 * jadi ini murni mengikuti klasifikasi "smart_degen" versi GMGN.
 */
export const whaleAlerts = pgTable("whale_alerts", {
  id:              serial("id").primaryKey(),
  chain:           varchar("chain", { length: 20 }).notNull(), // sol | eth | bsc
  walletAddress:   text("wallet_address").notNull(),
  side:            varchar("side", { length: 10 }).notNull(), // buy | sell
  tokenAddress:    text("token_address").notNull(),
  tokenSymbol:     varchar("token_symbol", { length: 40 }),
  amountUsd:       real("amount_usd"),

  // Snapshot harga token saat alert dikirim (buat forward-test)
  priceAtAlert:    real("price_at_alert"),
  lastPrice:       real("last_price"),
  athPrice:        real("ath_price"),
  athMultiplier:   real("ath_multiplier"),
  lastCheckedAt:   timestamp("last_checked_at"),

  txHash:          text("tx_hash"),
  status:          varchar("status", { length: 20 }).notNull().default("TRACKING"), // TRACKING | DEAD | STOPPED
  sentAt:          timestamp("sent_at").defaultNow(),
});

export type WhaleAlert = typeof whaleAlerts.$inferSelect;
export type InsertWhaleAlert = typeof whaleAlerts.$inferInsert;
