import {
  pgTable, serial, varchar, real, timestamp,
} from "drizzle-orm/pg-core";

/**
 * ml_signal_log
 *
 * Forward-test untuk sinyal SHADOW dari model logistic regression (ML),
 * TERPISAH dari signal_log (rule-based yang live). Tujuan: kumpulkan bukti
 * nyata apakah model ML lebih baik dari scoring manual, sebelum dipakai
 * menggantikan signal engine production.
 *
 * Dikirim ke channel Telegram YANG SAMA dengan sinyal biasa, dibedakan
 * lewat label "🧪 SHADOW ML" di pesan — TIDAK mempengaruhi sinyal rule-based.
 */
export const mlSignalLog = pgTable("ml_signal_log", {
  id:           serial("id").primaryKey(),
  pair:         varchar("pair", { length: 20 }).notNull(),
  side:         varchar("side", { length: 10 }).notNull(), // BUY | SELL
  probBuy:      real("prob_buy").notNull(),
  probSell:     real("prob_sell").notNull(),
  confidence:   real("confidence").notNull(), // probabilitas sisi yang dipilih, dalam %
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

export type MlSignalLog = typeof mlSignalLog.$inferSelect;
export type InsertMlSignalLog = typeof mlSignalLog.$inferInsert;
