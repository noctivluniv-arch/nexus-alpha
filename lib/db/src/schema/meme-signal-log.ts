import {
  pgTable, serial, varchar, text, real, integer, timestamp,
} from "drizzle-orm/pg-core";

/**
 * meme_signal_log
 *
 * Forward testing untuk meme coin scanner. Setiap coin yang ditandai
 * GEM/PUMP_IMMINENT dan dikirim ke Telegram, dicatat di sini.
 * Tujuan: mengukur jujur apakah early-gem scoring beneran efektif,
 * bukan untuk "menjamin" menemukan next DOGE/SHIB.
 */
export const memeSignalLog = pgTable("meme_signal_log", {
  id:               serial("id").primaryKey(),
  coinId:           varchar("coin_id", { length: 100 }).notNull(),
  name:             text("name").notNull(),
  symbol:           varchar("symbol", { length: 30 }).notNull(),
  network:          varchar("network", { length: 30 }).notNull(),
  contractAddress:  text("contract_address").notNull(),

  // Snapshot saat pertama kali terdeteksi
  initialPrice:     real("initial_price").notNull(),
  initialMcap:      real("initial_mcap"),
  initialLiquidity: real("initial_liquidity"),
  earlyGemScore:    integer("early_gem_score"),
  buyVerdict:       varchar("buy_verdict", { length: 20 }),
  triggerLabel:     varchar("trigger_label", { length: 30 }), // GEM | PUMP_IMMINENT | BOTH

  // Data yang terus di-update
  lastPrice:        real("last_price"),
  lastMcap:         real("last_mcap"),
  lastLiquidity:    real("last_liquidity"),
  athPrice:         real("ath_price"),       // harga tertinggi sejak terdeteksi
  athMultiplier:    real("ath_multiplier"),  // athPrice / initialPrice
  lastCheckedAt:    timestamp("last_checked_at"),

  status:           varchar("status", { length: 20 }).notNull().default("TRACKING"), // TRACKING | DEAD | STOPPED
  detectedAt:       timestamp("detected_at").defaultNow(),
});

export type MemeSignalLog = typeof memeSignalLog.$inferSelect;
export type InsertMemeSignalLog = typeof memeSignalLog.$inferInsert;
