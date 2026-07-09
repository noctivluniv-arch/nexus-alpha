import {
  pgTable, serial, varchar, text, real, timestamp,
} from "drizzle-orm/pg-core";

/**
 * meme_tpsl_signal_log
 *
 * Forward-test untuk strategi exit TP+20% / SL-8% pada meme coin GEM/PUMP_IMMINENT,
 * TERPISAH dari meme_signal_log (yang murni tracking ATH tanpa exit rule).
 *
 * Latar belakang (lihat CLAUDE_CONTEXT.md bagian D2, analisis 8 Juli 2026):
 * backtest atas data historis 109 coin menunjukkan baseline hold-tanpa-exit
 * (-30.75%) berubah jadi +1.80% dengan kombinasi TP+20%/SL-8% — TAPI itu cuma
 * backtest atas data yang sudah ada (initial/last/ATH price saja, BUKAN histori
 * harga penuh), belum ada biaya transaksi/slippage, dan belum tervalidasi
 * forward (real-time, data baru yang belum dipakai nemuin pola itu).
 *
 * Tabel ini WAJIB dianggap MASIH HIPOTESIS sampai closed sample cukup besar
 * (target sama seperti sinyal lain: 15-20 closed evaluasi awal, 50 closed
 * kesimpulan solid) — lihat catatan "note" di dashboard.
 *
 * Max hold 14 hari (EXPIRED, exit di harga terakhir) kalau TP/SL belum kena —
 * dipilih karena mayoritas meme coin di data historis menunjukkan pola
 * pump/dump dalam hitungan hari, bukan minggu.
 */
export const memeTpslSignalLog = pgTable("meme_tpsl_signal_log", {
  id:              serial("id").primaryKey(),
  coinId:          text("coin_id").notNull(),
  symbol:          varchar("symbol", { length: 40 }),
  network:         varchar("network", { length: 20 }),
  contractAddress: text("contract_address"),
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

export type MemeTpslSignalLog = typeof memeTpslSignalLog.$inferSelect;
export type InsertMemeTpslSignalLog = typeof memeTpslSignalLog.$inferInsert;
