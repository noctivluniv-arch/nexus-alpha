import {
  pgTable, serial, varchar, bigint, text, timestamp, unique,
} from "drizzle-orm/pg-core";

/**
 * ohlcv_daily
 *
 * Tabel untuk menyimpan daily OHLCV candle per pair dari Bybit.
 * Dipakai untuk:
 *   1. Forward testing — eval sinyal engine secara real (bukan simulasi)
 *   2. Backtest berbasis DB — makin lama data makin banyak, tanpa API
 *
 * Kolom harga/volume pakai text bukan numeric untuk menghindari
 * floating-point error dan agar kompatibel dengan format return Bybit.
 * Konversi ke number saat dibaca di script analisis.
 */
export const ohlcvDaily = pgTable(
  "ohlcv_daily",
  {
    id:          serial("id").primaryKey(),
    pair:        varchar("pair", { length: 20 }).notNull(),
    timestampMs: bigint("timestamp_ms", { mode: "number" }).notNull(), // open time unix ms
    open:        text("open").notNull(),
    high:        text("high").notNull(),
    low:         text("low").notNull(),
    close:       text("close").notNull(),
    volume:      text("volume").notNull(),
    createdAt:   timestamp("created_at").defaultNow(),
  },
  (t) => ({
    pairTsUniq: unique("ohlcv_daily_pair_ts_uniq").on(t.pair, t.timestampMs),
  }),
);

export type OhlcvDaily    = typeof ohlcvDaily.$inferSelect;
export type InsertOhlcvDaily = typeof ohlcvDaily.$inferInsert;
