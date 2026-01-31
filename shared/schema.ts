import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Moltbook agent credentials
export const moltbookAgent = pgTable("moltbook_agent", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: text("session_id"), // Unique per browser/user
  name: text("name").notNull(),
  description: text("description"),
  apiKey: text("api_key"),
  claimUrl: text("claim_url"),
  verificationCode: text("verification_code"),
  status: text("status").default("pending"), // pending, claimed, active
  karma: integer("karma").default(0),
  // Wallet fields - auto-generated for each agent
  walletAddress: text("wallet_address"),
  encryptedPrivateKey: text("encrypted_private_key"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertMoltbookAgentSchema = createInsertSchema(moltbookAgent).omit({
  id: true,
  createdAt: true,
});

export type InsertMoltbookAgent = z.infer<typeof insertMoltbookAgentSchema>;
export type MoltbookAgent = typeof moltbookAgent.$inferSelect;

// Cached posts for display
export const moltbookPosts = pgTable("moltbook_posts", {
  id: varchar("id").primaryKey(),
  submolt: text("submolt"),
  title: text("title").notNull(),
  content: text("content"),
  url: text("url"),
  authorName: text("author_name"),
  upvotes: integer("upvotes").default(0),
  commentCount: integer("comment_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  fetchedAt: timestamp("fetched_at").defaultNow(),
});

export type MoltbookPost = typeof moltbookPosts.$inferSelect;

// MEXC trading credentials
export const mexcCredentials = pgTable("mexc_credentials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  apiKey: text("api_key").notNull(),
  secretKey: text("secret_key").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertMexcCredentialsSchema = createInsertSchema(mexcCredentials).omit({
  id: true,
  createdAt: true,
});

export type InsertMexcCredentials = z.infer<typeof insertMexcCredentialsSchema>;
export type MexcCredentials = typeof mexcCredentials.$inferSelect;

// Keep users table for compatibility
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Webhook triggers for auto-posting
export const webhookTriggers = pgTable("webhook_triggers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  triggerType: text("trigger_type").notNull(), // github, price_alert, custom, calendar
  webhookSecret: text("webhook_secret").notNull(),
  postTemplate: text("post_template").notNull(), // Template with {{variables}}
  submolt: text("submolt").default("general"),
  isActive: boolean("is_active").default(true),
  lastTriggered: timestamp("last_triggered"),
  triggerCount: integer("trigger_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertWebhookTriggerSchema = createInsertSchema(webhookTriggers).omit({
  id: true,
  lastTriggered: true,
  triggerCount: true,
  createdAt: true,
});

export type InsertWebhookTrigger = z.infer<typeof insertWebhookTriggerSchema>;
export type WebhookTrigger = typeof webhookTriggers.$inferSelect;

// Post queue for rate limiting (30 min between posts)
export const postQueue = pgTable("post_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  triggerId: varchar("trigger_id").references(() => webhookTriggers.id),
  submolt: text("submolt").notNull(),
  title: text("title").notNull(),
  content: text("content"),
  status: text("status").default("pending"), // pending, posted, failed
  scheduledFor: timestamp("scheduled_for"),
  postedAt: timestamp("posted_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type PostQueueItem = typeof postQueue.$inferSelect;

// Token launches via moltlaunch
export const tokenLaunches = pgTable("token_launches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  symbol: text("symbol").notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  tokenAddress: text("token_address"),
  transactionHash: text("transaction_hash"),
  flaunchUrl: text("flaunch_url"),
  explorerUrl: text("explorer_url"),
  walletAddress: text("wallet_address"),
  moltbookPostUrl: text("moltbook_post_url"),
  status: text("status").default("pending"), // pending, launched, failed
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTokenLaunchSchema = createInsertSchema(tokenLaunches).omit({
  id: true,
  tokenAddress: true,
  transactionHash: true,
  flaunchUrl: true,
  explorerUrl: true,
  walletAddress: true,
  moltbookPostUrl: true,
  status: true,
  errorMessage: true,
  createdAt: true,
});

export type InsertTokenLaunch = z.infer<typeof insertTokenLaunchSchema>;
export type TokenLaunch = typeof tokenLaunches.$inferSelect;
