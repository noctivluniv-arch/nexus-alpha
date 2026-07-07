import {
  pgTable, serial, varchar, real, timestamp,
} from "drizzle-orm/pg-core";

/**
 * breakout_signal_log
 *
 * Forward-test untuk sinyal SHADOW breakout momentum BUY (lookback 10 hari +
 * volume filter), TERPISAH dari signal_log (rule-based) dan ml_signal_log (ML).
 * Formula proven di walk-forward backtest: PF 1.45 (2021-2024) / 1.29 (2024-2026).
 *
 * Beda dari ml_signal_log: cuma 1 TP (single target "exit ketat", bukan TP1/2/3),
 * dan ada status EXPIRED (exit karena max-hold 10 hari terlampaui tanpa TP/SL kena,
 * exit di harga close terakhir — sesuai metodologi backtest).
 *
 * Dikirim ke channel Telegram YANG SAMA, dibedakan label "📊 SHADOW BREAKOUT".
 */
export const breakoutSignalLog = pgTable("breakout_signal_log", {
  id:           serial("id").primaryKey(),
  pair:         varchar("pair", { length: 20 }).notNull(),
  entryPrice:   real("entry_price").notNull(),
  sl:           real("sl"),
  tp:           real("tp"),
  atr14:        real("atr14"),
  volRatio:     real("vol_ratio"),
  status:       varchar("status", { length: 20 }).notNull().default("OPEN"), // OPEN | TP_HIT | SL_HIT | EXPIRED
  closedPrice:  real("closed_price"),
  closedAt:     timestamp("closed_at"),
  sentAt:       timestamp("sent_at").defaultNow(),
});

export type BreakoutSignalLog = typeof breakoutSignalLog.$inferSelect;
export type InsertBreakoutSignalLog = typeof breakoutSignalLog.$inferInsert;
