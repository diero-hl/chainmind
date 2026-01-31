import { eq, and, lte, desc } from "drizzle-orm";
import { db } from "./db";
import {
  moltbookAgent,
  moltbookPosts,
  mexcCredentials,
  users,
  webhookTriggers,
  postQueue,
  tokenLaunches,
  type InsertMoltbookAgent,
  type MoltbookAgent,
  type MoltbookPost,
  type InsertMexcCredentials,
  type MexcCredentials,
  type InsertUser,
  type User,
  type InsertWebhookTrigger,
  type WebhookTrigger,
  type PostQueueItem,
  type InsertTokenLaunch,
  type TokenLaunch,
} from "@shared/schema";

export interface IStorage {
  // Moltbook Agent (per session)
  getAgent(sessionId?: string): Promise<MoltbookAgent | null>;
  getAgentByApiKey(apiKey: string): Promise<MoltbookAgent | null>;
  createAgent(agent: InsertMoltbookAgent): Promise<MoltbookAgent>;
  updateAgent(id: string, updates: Partial<InsertMoltbookAgent>): Promise<MoltbookAgent | null>;
  deleteAgent(id: string): Promise<void>;

  // MEXC Credentials
  getMexcCredentials(): Promise<MexcCredentials | null>;
  saveMexcCredentials(creds: InsertMexcCredentials): Promise<MexcCredentials>;
  deleteMexcCredentials(): Promise<void>;

  // Webhook Triggers
  getWebhookTriggers(): Promise<WebhookTrigger[]>;
  getWebhookTrigger(id: string): Promise<WebhookTrigger | null>;
  getWebhookTriggerBySecret(secret: string): Promise<WebhookTrigger | null>;
  createWebhookTrigger(trigger: InsertWebhookTrigger): Promise<WebhookTrigger>;
  updateWebhookTrigger(id: string, updates: Partial<InsertWebhookTrigger>): Promise<WebhookTrigger | null>;
  deleteWebhookTrigger(id: string): Promise<void>;
  incrementTriggerCount(id: string): Promise<void>;

  // Post Queue (for 30-min rate limit)
  getPostQueue(): Promise<PostQueueItem[]>;
  getPendingPosts(): Promise<PostQueueItem[]>;
  getLastPostedTime(): Promise<Date | null>;
  addToQueue(item: { triggerId?: string; submolt: string; title: string; content?: string; scheduledFor?: Date }): Promise<PostQueueItem>;
  markAsPosted(id: string): Promise<void>;
  markAsFailed(id: string, error: string): Promise<void>;

  // Users (for compatibility)
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Token Launches
  getTokenLaunches(): Promise<TokenLaunch[]>;
  getTokenLaunch(id: string): Promise<TokenLaunch | null>;
  createTokenLaunch(launch: InsertTokenLaunch): Promise<TokenLaunch>;
  updateTokenLaunch(id: string, updates: Partial<TokenLaunch>): Promise<TokenLaunch | null>;
}

export class DatabaseStorage implements IStorage {
  // Moltbook Agent - scoped by sessionId
  async getAgent(sessionId?: string): Promise<MoltbookAgent | null> {
    if (sessionId) {
      const agents = await db.select().from(moltbookAgent).where(eq(moltbookAgent.sessionId, sessionId)).limit(1);
      return agents[0] || null;
    }
    // Fallback for backwards compatibility
    const agents = await db.select().from(moltbookAgent).limit(1);
    return agents[0] || null;
  }

  async getAgentByApiKey(apiKey: string): Promise<MoltbookAgent | null> {
    const agents = await db.select().from(moltbookAgent).where(eq(moltbookAgent.apiKey, apiKey)).limit(1);
    return agents[0] || null;
  }

  async createAgent(agent: InsertMoltbookAgent): Promise<MoltbookAgent> {
    const [created] = await db.insert(moltbookAgent).values(agent).returning();
    return created;
  }

  async updateAgent(id: string, updates: Partial<InsertMoltbookAgent>): Promise<MoltbookAgent | null> {
    const [updated] = await db
      .update(moltbookAgent)
      .set(updates)
      .where(eq(moltbookAgent.id, id))
      .returning();
    return updated || null;
  }

  async deleteAgent(id: string): Promise<void> {
    await db.delete(moltbookAgent).where(eq(moltbookAgent.id, id));
  }

  // MEXC Credentials - we only support one set per app
  async getMexcCredentials(): Promise<MexcCredentials | null> {
    const creds = await db.select().from(mexcCredentials).limit(1);
    return creds[0] || null;
  }

  async saveMexcCredentials(creds: InsertMexcCredentials): Promise<MexcCredentials> {
    // Delete existing credentials first
    await db.delete(mexcCredentials);
    const [created] = await db.insert(mexcCredentials).values(creds).returning();
    return created;
  }

  async deleteMexcCredentials(): Promise<void> {
    await db.delete(mexcCredentials);
  }

  // Webhook Triggers
  async getWebhookTriggers(): Promise<WebhookTrigger[]> {
    return await db.select().from(webhookTriggers);
  }

  async getWebhookTrigger(id: string): Promise<WebhookTrigger | null> {
    const [trigger] = await db.select().from(webhookTriggers).where(eq(webhookTriggers.id, id));
    return trigger || null;
  }

  async getWebhookTriggerBySecret(secret: string): Promise<WebhookTrigger | null> {
    const [trigger] = await db.select().from(webhookTriggers).where(eq(webhookTriggers.webhookSecret, secret));
    return trigger || null;
  }

  async createWebhookTrigger(trigger: InsertWebhookTrigger): Promise<WebhookTrigger> {
    const [created] = await db.insert(webhookTriggers).values(trigger).returning();
    return created;
  }

  async updateWebhookTrigger(id: string, updates: Partial<InsertWebhookTrigger>): Promise<WebhookTrigger | null> {
    const [updated] = await db
      .update(webhookTriggers)
      .set(updates)
      .where(eq(webhookTriggers.id, id))
      .returning();
    return updated || null;
  }

  async deleteWebhookTrigger(id: string): Promise<void> {
    await db.delete(webhookTriggers).where(eq(webhookTriggers.id, id));
  }

  async incrementTriggerCount(id: string): Promise<void> {
    const trigger = await this.getWebhookTrigger(id);
    if (trigger) {
      await db
        .update(webhookTriggers)
        .set({
          triggerCount: (trigger.triggerCount || 0) + 1,
          lastTriggered: new Date(),
        })
        .where(eq(webhookTriggers.id, id));
    }
  }

  // Post Queue
  async getPostQueue(): Promise<PostQueueItem[]> {
    return await db.select().from(postQueue).orderBy(desc(postQueue.createdAt));
  }

  async getPendingPosts(): Promise<PostQueueItem[]> {
    const now = new Date();
    return await db
      .select()
      .from(postQueue)
      .where(
        and(
          eq(postQueue.status, "pending"),
          lte(postQueue.scheduledFor, now)
        )
      )
      .orderBy(postQueue.scheduledFor);
  }

  async getLastPostedTime(): Promise<Date | null> {
    const [last] = await db
      .select()
      .from(postQueue)
      .where(eq(postQueue.status, "posted"))
      .orderBy(desc(postQueue.postedAt))
      .limit(1);
    return last?.postedAt || null;
  }

  async addToQueue(item: { triggerId?: string; submolt: string; title: string; content?: string; scheduledFor?: Date }): Promise<PostQueueItem> {
    const [created] = await db
      .insert(postQueue)
      .values({
        triggerId: item.triggerId,
        submolt: item.submolt,
        title: item.title,
        content: item.content,
        scheduledFor: item.scheduledFor || new Date(),
      })
      .returning();
    return created;
  }

  async markAsPosted(id: string): Promise<void> {
    await db
      .update(postQueue)
      .set({ status: "posted", postedAt: new Date() })
      .where(eq(postQueue.id, id));
  }

  async markAsFailed(id: string, error: string): Promise<void> {
    await db
      .update(postQueue)
      .set({ status: "failed", errorMessage: error })
      .where(eq(postQueue.id, id));
  }

  // Users
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [created] = await db.insert(users).values(user).returning();
    return created;
  }

  // Token Launches
  async getTokenLaunches(): Promise<TokenLaunch[]> {
    return await db.select().from(tokenLaunches).orderBy(desc(tokenLaunches.createdAt));
  }

  async getTokenLaunch(id: string): Promise<TokenLaunch | null> {
    const [launch] = await db.select().from(tokenLaunches).where(eq(tokenLaunches.id, id));
    return launch || null;
  }

  async createTokenLaunch(launch: InsertTokenLaunch): Promise<TokenLaunch> {
    const [created] = await db.insert(tokenLaunches).values(launch).returning();
    return created;
  }

  async updateTokenLaunch(id: string, updates: Partial<TokenLaunch>): Promise<TokenLaunch | null> {
    const [updated] = await db
      .update(tokenLaunches)
      .set(updates)
      .where(eq(tokenLaunches.id, id))
      .returning();
    return updated || null;
  }

  async getTokenLaunchesByWallet(walletAddress: string): Promise<TokenLaunch[]> {
    return await db
      .select()
      .from(tokenLaunches)
      .where(eq(tokenLaunches.walletAddress, walletAddress))
      .orderBy(desc(tokenLaunches.createdAt));
  }
}

export const storage = new DatabaseStorage();
