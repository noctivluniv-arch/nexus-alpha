import { pgTable, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const circuitBreaker = pgTable("circuit_breaker", {
  pair: varchar("pair", { length: 20 }).primaryKey(),
  consecutiveLosses: integer("consecutive_losses").notNull().default(0),
  lastLossAt: timestamp("last_loss_at"),
  pausedUntil: timestamp("paused_until"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
