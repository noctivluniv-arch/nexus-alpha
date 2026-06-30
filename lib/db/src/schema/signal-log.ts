import {
  pgTable, serial, varchar, bigint, text, timestamp, real,
} from "drizzle-orm/pg-core";

/**
 * signal_log
 *
 * Tabel untuk forward testing — setiap signal yang dikirim ke Telegram
 * disimpan di sini, lalu dicek belakangan apakah TP atau SL kena duluan.
 * Ini bukti nyata (bukan backtest) apakah engine profitable atau tidak.
 */
export const signalLog = pgTable("signal_log", {
  id:           serial("id").primaryKey(),
  pair:         varchar("pair", { length: 20 }).notNull(),
  side:         varchar("side", { length: 10 }).notNull(), // BUY | SELL
  confidence:   real("confidence").notNull(),
  entryPrice:   real("entry_price").notNull(),
  sl:           real("sl"),
  tp1:          real("tp1"),
  tp2:          real("tp2"),
  tp3:          real("tp3"),
  status:       varchar("status", { length: 20 }).notNull().default("OPEN"), // OPEN | TP1_HIT | TP2_HIT | TP3_HIT | SL_HIT
  closedPrice:  real("closed_price"),
  closedAt:     timestamp("closed_at"),
  sentAt:       timestamp("sent_at").defaultNow(),
});

export type SignalLog = typeof signalLog.$inferSelect;
export type InsertSignalLog = typeof signalLog.$inferInsert;
