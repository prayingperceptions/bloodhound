import { pgTable, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const huntsTable = pgTable("hunts", {
  id: text("id").primaryKey(),
  repoUrl: text("repo_url").notNull(),
  repoName: text("repo_name").notNull(),
  mode: text("mode").notNull().$type<"code4rena" | "immunefi">(),
  status: text("status").notNull().default("pending").$type<"pending" | "running" | "complete" | "failed">(),
  contractsFound: integer("contracts_found"),
  findings: jsonb("findings").$type<Finding[]>(),
  reportMarkdown: text("report_markdown"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export interface Finding {
  id: string;
  severity: "critical" | "high" | "medium" | "low" | "informational" | "gas";
  title: string;
  contract: string;
  function?: string | null;
  description: string;
  impact: string;
  recommendation: string;
  category: string;
  codeSnippet?: string | null;
}

export const insertHuntSchema = createInsertSchema(huntsTable).omit({ createdAt: true, updatedAt: true });
export type InsertHunt = z.infer<typeof insertHuntSchema>;
export type Hunt = typeof huntsTable.$inferSelect;
