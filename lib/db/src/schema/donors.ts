import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const donorsTable = pgTable("donors", {
  id: text("id").primaryKey(),
  ip: text("ip").notNull(),
  txHash: text("tx_hash").notNull().unique(),
  ethFromAddress: text("eth_from_address").notNull(),
  ethAmountWei: text("eth_amount_wei").notNull(),
  tier: text("tier").notNull().$type<"small" | "medium" | "lifetime">(),
  huntLimit: integer("hunt_limit"),
  huntsUsed: integer("hunts_used").notNull().default(0),
  expiresAt: timestamp("expires_at"),
  isSponsor: boolean("is_sponsor").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertDonorSchema = createInsertSchema(donorsTable).omit({ createdAt: true });
export type InsertDonor = z.infer<typeof insertDonorSchema>;
export type Donor = typeof donorsTable.$inferSelect;
