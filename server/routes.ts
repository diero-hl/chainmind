import type { Express } from "express";
import { createServer, type Server } from "http";
import crypto from "crypto";
import { storage } from "./storage";
import { moltbookApi } from "./moltbook-api";
import { mexcApi } from "./mexc-api";
import { parseSignalsFromFeed, type TradingSignal } from "./signal-parser";
import { generateWallet, getWalletBalance, transferEth } from "./wallet-service";
import { launchToken, getTokenInfo, getClaimableFees, claimFees } from "./clanker-service";
import { buyToken, sellToken, unwrapWeth, getWethBalance } from "./trade-service";
import { processChat } from "./ai-service";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Log startup - agents are now per-session
  console.log("Moltbook Agent initialized - agents are scoped per user session");

  // Initialize MEXC credentials from database if exists
  const existingMexcCreds = await storage.getMexcCredentials();
  if (existingMexcCreds) {
    mexcApi.setCredentials({
      apiKey: existingMexcCreds.apiKey,
      secretKey: existingMexcCreds.secretKey,
    });
  }

  // Helper to get sessionId from header
  const getSessionId = (req: any): string | undefined => {
    return req.headers["x-session-id"] as string | undefined;
  };

  // ============ AI Chat API ============

  app.post("/api/chat", async (req, res) => {
    try {
      const sessionId = getSessionId(req);
      const { message } = req.body;

      if (!message) {
        return res.status(400).json({ error: "Message required" });
      }

      const agent = await storage.getAgent(sessionId);
      let walletBalance = "0";
      if (agent?.walletAddress) {
        const wallet = await getWalletBalance(agent.walletAddress);
        walletBalance = wallet.balance;
      }

      const response = await processChat(message, {
        hasWallet: !!agent?.walletAddress,
        walletBalance,
        isRegistered: !!agent,
        agentName: agent?.name,
      });

      res.json(response);
    } catch (error) {
      console.error("Chat error:", error);
      res.status(500).json({ error: "Chat failed" });
    }
  });

  // ============ Agent API ============

  // Get current agent (scoped by session)
  app.get("/api/agent", async (req, res) => {
    try {
      const sessionId = getSessionId(req);
      const agent = await storage.getAgent(sessionId);
      res.json(agent);
    } catch (error) {
      console.error("Error fetching agent:", error);
      res.status(500).json({ error: "Failed to fetch agent" });
    }
  });

  // Register new agent
  app.post("/api/agent/register", async (req, res) => {
    try {
      const sessionId = getSessionId(req);
      const { name, description } = req.body;

      if (!name) {
        return res.status(400).json({ error: "Name is required" });
      }

      if (!sessionId) {
        return res.status(400).json({ error: "Session ID required" });
      }

      // Check if agent already exists for this session
      const existing = await storage.getAgent(sessionId);
      if (existing) {
        return res.status(400).json({ error: "Agent already registered. Delete first to re-register." });
      }

      // Register with Moltbook
      const result = await moltbookApi.register(name, description || "An AI agent on Moltbook");

      if (!result.success || !result.data) {
        return res.status(400).json({ error: result.error || "Registration failed", hint: result.hint });
      }

      const { api_key, claim_url, verification_code } = result.data.agent;

      // Generate wallet for this agent
      const wallet = generateWallet();
      console.log(`Generated wallet for agent ${name}: ${wallet.address}`);

      // Save to database with sessionId
      const agent = await storage.createAgent({
        sessionId,
        name,
        description: description || "An AI agent on Moltbook",
        apiKey: api_key,
        claimUrl: claim_url,
        verificationCode: verification_code,
        status: "pending",
        walletAddress: wallet.address,
        encryptedPrivateKey: wallet.encryptedPrivateKey,
      });

      // Set API key for future requests
      moltbookApi.setApiKey(api_key);

      res.json({
        agent: { ...agent, encryptedPrivateKey: undefined },
        claimUrl: claim_url,
        verificationCode: verification_code,
        walletAddress: wallet.address,
        message: "Agent registered with wallet! Share the claim URL with your human to verify ownership.",
      });
    } catch (error) {
      console.error("Error registering agent:", error);
      res.status(500).json({ error: "Failed to register agent" });
    }
  });

  // Recover agent with API key - transfers agent to current session
  app.post("/api/agent/recover", async (req, res) => {
    try {
      const sessionId = getSessionId(req);
      const { apiKey } = req.body;

      console.log("Recover attempt - apiKey:", apiKey, "sessionId:", sessionId);

      if (!apiKey) {
        return res.status(400).json({ error: "API key is required" });
      }

      if (!sessionId) {
        return res.status(400).json({ error: "Session ID required" });
      }

      // Find agent by API key
      const agent = await storage.getAgentByApiKey(apiKey);
      console.log("Agent found:", agent ? agent.name : "null");
      if (!agent) {
        return res.status(404).json({ error: "No agent found with that API key" });
      }

      // Update agent's sessionId to current session
      const updatedAgent = await storage.updateAgent(agent.id, { sessionId });

      res.json({
        success: true,
        agent: { ...updatedAgent, encryptedPrivateKey: undefined },
        message: "Agent recovered! Your wallet is now accessible on this device.",
      });
    } catch (error) {
      console.error("Error recovering agent:", error);
      res.status(500).json({ error: "Failed to recover agent" });
    }
  });

  // Check agent status and auto-verify if claimed on Moltbook
  app.get("/api/agent/status", async (req, res) => {
    try {
      const sessionId = getSessionId(req);
      const agent = await storage.getAgent(sessionId);
      if (!agent?.apiKey) {
        return res.status(400).json({ error: "No agent registered" });
      }

      moltbookApi.setApiKey(agent.apiKey);
      
      // Try to get profile to check is_claimed
      const profileResult = await moltbookApi.getProfile();
      
      if (profileResult.success && profileResult.data) {
        const newStatus = profileResult.data.is_claimed ? "active" : "pending";
        
        // Update local status if changed
        if (agent.status !== newStatus) {
          await storage.updateAgent(agent.id, { status: newStatus });
          console.log(`Agent ${agent.name} status updated to ${newStatus}`);
        }
        
        res.json({ 
          status: newStatus,
          is_claimed: profileResult.data.is_claimed,
          karma: profileResult.data.karma
        });
      } else {
        // Fallback to basic status check
        const result = await moltbookApi.getStatus();
        if (result.success && result.data) {
          await storage.updateAgent(agent.id, { status: result.data.status });
          res.json(result.data);
        } else {
          res.status(400).json({ error: result.error || profileResult.error });
        }
      }
    } catch (error) {
      console.error("Error checking status:", error);
      res.status(500).json({ error: "Failed to check status" });
    }
  });

  // Get agent profile from Moltbook
  app.get("/api/agent/profile", async (req, res) => {
    try {
      const agent = await storage.getAgent(getSessionId(req));
      if (!agent?.apiKey) {
        return res.status(400).json({ error: "No agent registered" });
      }

      moltbookApi.setApiKey(agent.apiKey);
      const result = await moltbookApi.getProfile();

      if (result.success) {
        res.json(result.data);
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error) {
      console.error("Error fetching profile:", error);
      res.status(500).json({ error: "Failed to fetch profile" });
    }
  });

  // Delete agent
  app.delete("/api/agent", async (req, res) => {
    try {
      const agent = await storage.getAgent(getSessionId(req));
      if (agent) {
        await storage.deleteAgent(agent.id);
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting agent:", error);
      res.status(500).json({ error: "Failed to delete agent" });
    }
  });

  // Admin endpoint to sync/import agent data (for migrating from dev to production)
  app.post("/api/admin/sync-agent", async (req, res) => {
    try {
      const { adminKey, agentData } = req.body;
      
      // Simple admin key check (use SESSION_SECRET as admin key)
      const expectedKey = process.env.SESSION_SECRET;
      if (!adminKey || adminKey !== expectedKey) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (!agentData) {
        return res.status(400).json({ error: "Agent data required" });
      }

      // Check if agent already exists
      const existing = await storage.getAgentByApiKey(agentData.apiKey);
      if (existing) {
        return res.json({ success: true, message: "Agent already exists", agent: existing });
      }

      // Import the agent directly to database
      const { db } = await import("./db");
      const { moltbookAgent } = await import("@shared/schema");
      
      await db.insert(moltbookAgent).values({
        id: agentData.id,
        name: agentData.name,
        description: agentData.description,
        apiKey: agentData.apiKey,
        claimUrl: agentData.claimUrl,
        verificationCode: agentData.verificationCode,
        status: agentData.status,
        karma: agentData.karma || 0,
        walletAddress: agentData.walletAddress,
        encryptedPrivateKey: agentData.encryptedPrivateKey,
        sessionId: agentData.sessionId,
      });

      res.json({ success: true, message: "Agent imported successfully" });
    } catch (error) {
      console.error("Error syncing agent:", error);
      res.status(500).json({ error: "Failed to sync agent" });
    }
  });

  // ============ Public API (no auth required) ============

  // Get public posts from Moltbook
  app.get("/api/public/posts", async (req, res) => {
    try {
      const sort = (req.query.sort as "hot" | "new" | "top") || "hot";
      const limit = parseInt(req.query.limit as string) || 25;
      
      const response = await fetch(
        `https://www.moltbook.com/api/v1/posts?sort=${sort}&limit=${limit}`
      );
      
      if (response.ok) {
        const data = await response.json();
        res.json(data);
      } else {
        res.json({ posts: [] });
      }
    } catch (error) {
      console.error("Error fetching public posts:", error);
      res.json({ posts: [] });
    }
  });

  // Get public submolts from Moltbook
  app.get("/api/public/submolts", async (req, res) => {
    try {
      const response = await fetch("https://www.moltbook.com/api/v1/submolts");
      
      if (response.ok) {
        const data = await response.json();
        res.json(data);
      } else {
        res.json([]);
      }
    } catch (error) {
      console.error("Error fetching public submolts:", error);
      res.json([]);
    }
  });

  // Get public stats from Moltbook
  app.get("/api/public/stats", async (req, res) => {
    try {
      // Fetch multiple endpoints to get stats
      const [postsRes, submoltsRes] = await Promise.all([
        fetch("https://www.moltbook.com/api/v1/posts?limit=1"),
        fetch("https://www.moltbook.com/api/v1/submolts"),
      ]);
      
      let stats = {
        agents: 0,
        submolts: 0,
        posts: 0,
        comments: 0,
      };
      
      if (submoltsRes.ok) {
        const submolts = await submoltsRes.json();
        stats.submolts = Array.isArray(submolts) ? submolts.length : 0;
      }
      
      // We can estimate based on available data
      // These would be replaced with actual counts from Moltbook API if available
      stats.agents = 50; // Placeholder - Moltbook has ~50 agents
      stats.posts = 200; // Placeholder
      stats.comments = 500; // Placeholder
      
      res.json(stats);
    } catch (error) {
      console.error("Error fetching public stats:", error);
      res.json({ agents: 0, submolts: 0, posts: 0, comments: 0 });
    }
  });

  // Get top agents from Moltbook
  app.get("/api/public/agents", async (req, res) => {
    try {
      const response = await fetch("https://www.moltbook.com/api/v1/agents?sort=karma&limit=10");
      
      if (response.ok) {
        const data = await response.json();
        res.json(data);
      } else {
        res.json([]);
      }
    } catch (error) {
      console.error("Error fetching public agents:", error);
      res.json([]);
    }
  });

  // ============ Feed & Posts API ============

  // Get feed
  app.get("/api/feed", async (req, res) => {
    try {
      const agent = await storage.getAgent(getSessionId(req));
      if (!agent?.apiKey) {
        return res.status(400).json({ error: "No agent registered" });
      }

      moltbookApi.setApiKey(agent.apiKey);
      const sort = (req.query.sort as "hot" | "new" | "top") || "hot";
      const limit = parseInt(req.query.limit as string) || 25;

      const result = await moltbookApi.getFeed(sort, limit);

      if (result.success) {
        res.json(result.data);
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error) {
      console.error("Error fetching feed:", error);
      res.status(500).json({ error: "Failed to fetch feed" });
    }
  });

  // Get posts
  app.get("/api/posts", async (req, res) => {
    try {
      const agent = await storage.getAgent(getSessionId(req));
      if (!agent?.apiKey) {
        return res.status(400).json({ error: "No agent registered" });
      }

      moltbookApi.setApiKey(agent.apiKey);
      const sort = (req.query.sort as "hot" | "new" | "top" | "rising") || "hot";
      const limit = parseInt(req.query.limit as string) || 25;
      const submolt = req.query.submolt as string | undefined;

      const result = await moltbookApi.getPosts(sort, limit, submolt);

      if (result.success) {
        res.json(result.data);
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error) {
      console.error("Error fetching posts:", error);
      res.status(500).json({ error: "Failed to fetch posts" });
    }
  });

  // Create post
  app.post("/api/posts", async (req, res) => {
    try {
      const agent = await storage.getAgent(getSessionId(req));
      if (!agent?.apiKey) {
        return res.status(400).json({ error: "No agent registered" });
      }

      moltbookApi.setApiKey(agent.apiKey);
      const { submolt, title, content, url } = req.body;

      if (!submolt || !title) {
        return res.status(400).json({ error: "Submolt and title are required" });
      }

      const result = await moltbookApi.createPost(submolt, title, content, url);

      if (result.success) {
        res.json(result.data);
      } else {
        res.status(400).json({ error: result.error, hint: result.hint });
      }
    } catch (error) {
      console.error("Error creating post:", error);
      res.status(500).json({ error: "Failed to create post" });
    }
  });

  // Get single post
  app.get("/api/posts/:id", async (req, res) => {
    try {
      const agent = await storage.getAgent(getSessionId(req));
      if (!agent?.apiKey) {
        return res.status(400).json({ error: "No agent registered" });
      }

      moltbookApi.setApiKey(agent.apiKey);
      const result = await moltbookApi.getPost(req.params.id);

      if (result.success) {
        res.json(result.data);
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error) {
      console.error("Error fetching post:", error);
      res.status(500).json({ error: "Failed to fetch post" });
    }
  });

  // Upvote post
  app.post("/api/posts/:id/upvote", async (req, res) => {
    try {
      const agent = await storage.getAgent(getSessionId(req));
      if (!agent?.apiKey) {
        return res.status(400).json({ error: "No agent registered" });
      }

      moltbookApi.setApiKey(agent.apiKey);
      const result = await moltbookApi.upvotePost(req.params.id);

      if (result.success) {
        res.json(result.data);
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error) {
      console.error("Error upvoting:", error);
      res.status(500).json({ error: "Failed to upvote" });
    }
  });

  // Downvote post
  app.post("/api/posts/:id/downvote", async (req, res) => {
    try {
      const agent = await storage.getAgent(getSessionId(req));
      if (!agent?.apiKey) {
        return res.status(400).json({ error: "No agent registered" });
      }

      moltbookApi.setApiKey(agent.apiKey);
      const result = await moltbookApi.downvotePost(req.params.id);

      if (result.success) {
        res.json(result.data);
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error) {
      console.error("Error downvoting:", error);
      res.status(500).json({ error: "Failed to downvote" });
    }
  });

  // Get comments
  app.get("/api/posts/:id/comments", async (req, res) => {
    try {
      const agent = await storage.getAgent(getSessionId(req));
      if (!agent?.apiKey) {
        return res.status(400).json({ error: "No agent registered" });
      }

      moltbookApi.setApiKey(agent.apiKey);
      const sort = (req.query.sort as "top" | "new") || "top";
      const result = await moltbookApi.getComments(req.params.id, sort);

      if (result.success) {
        res.json(result.data);
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error) {
      console.error("Error fetching comments:", error);
      res.status(500).json({ error: "Failed to fetch comments" });
    }
  });

  // Add comment
  app.post("/api/posts/:id/comments", async (req, res) => {
    try {
      const agent = await storage.getAgent(getSessionId(req));
      if (!agent?.apiKey) {
        return res.status(400).json({ error: "No agent registered" });
      }

      moltbookApi.setApiKey(agent.apiKey);
      const { content, parentId } = req.body;

      if (!content) {
        return res.status(400).json({ error: "Content is required" });
      }

      const result = await moltbookApi.addComment(req.params.id, content, parentId);

      if (result.success) {
        res.json(result.data);
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error) {
      console.error("Error adding comment:", error);
      res.status(500).json({ error: "Failed to add comment" });
    }
  });

  // ============ Submolts API ============

  app.get("/api/submolts", async (req, res) => {
    try {
      const agent = await storage.getAgent(getSessionId(req));
      if (!agent?.apiKey) {
        return res.status(400).json({ error: "No agent registered" });
      }

      moltbookApi.setApiKey(agent.apiKey);
      const result = await moltbookApi.getSubmolts();

      if (result.success) {
        res.json(result.data);
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error) {
      console.error("Error fetching submolts:", error);
      res.status(500).json({ error: "Failed to fetch submolts" });
    }
  });

  // ============ Search API ============

  app.get("/api/search", async (req, res) => {
    try {
      const agent = await storage.getAgent(getSessionId(req));
      if (!agent?.apiKey) {
        return res.status(400).json({ error: "No agent registered" });
      }

      moltbookApi.setApiKey(agent.apiKey);
      const query = req.query.q as string;
      const limit = parseInt(req.query.limit as string) || 25;

      if (!query) {
        return res.status(400).json({ error: "Query is required" });
      }

      const result = await moltbookApi.search(query, limit);

      if (result.success) {
        res.json(result.data);
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error) {
      console.error("Error searching:", error);
      res.status(500).json({ error: "Failed to search" });
    }
  });

  // ============ Follow/Unfollow API ============

  app.post("/api/agents/:name/follow", async (req, res) => {
    try {
      const agent = await storage.getAgent(getSessionId(req));
      if (!agent?.apiKey) {
        return res.status(400).json({ error: "No agent registered" });
      }

      moltbookApi.setApiKey(agent.apiKey);
      const result = await moltbookApi.follow(req.params.name);

      if (result.success) {
        res.json(result.data);
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error) {
      console.error("Error following agent:", error);
      res.status(500).json({ error: "Failed to follow agent" });
    }
  });

  app.delete("/api/agents/:name/follow", async (req, res) => {
    try {
      const agent = await storage.getAgent(getSessionId(req));
      if (!agent?.apiKey) {
        return res.status(400).json({ error: "No agent registered" });
      }

      moltbookApi.setApiKey(agent.apiKey);
      const result = await moltbookApi.unfollow(req.params.name);

      if (result.success) {
        res.json(result.data);
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error) {
      console.error("Error unfollowing agent:", error);
      res.status(500).json({ error: "Failed to unfollow agent" });
    }
  });

  // ============ Webhook Triggers API ============

  // Get all triggers
  app.get("/api/webhooks", async (req, res) => {
    try {
      const triggers = await storage.getWebhookTriggers();
      res.json(triggers);
    } catch (error) {
      console.error("Error fetching webhooks:", error);
      res.status(500).json({ error: "Failed to fetch webhooks" });
    }
  });

  // Create trigger
  app.post("/api/webhooks", async (req, res) => {
    try {
      const { name, triggerType, postTemplate, submolt } = req.body;

      if (!name || !triggerType || !postTemplate) {
        return res.status(400).json({ error: "name, triggerType, and postTemplate are required" });
      }

      // Generate unique webhook secret
      const webhookSecret = crypto.randomUUID();

      const trigger = await storage.createWebhookTrigger({
        name,
        triggerType,
        webhookSecret,
        postTemplate,
        submolt: submolt || "general",
        isActive: true,
      });

      res.json(trigger);
    } catch (error) {
      console.error("Error creating webhook:", error);
      res.status(500).json({ error: "Failed to create webhook" });
    }
  });

  // Update trigger
  app.patch("/api/webhooks/:id", async (req, res) => {
    try {
      const { name, postTemplate, submolt, isActive } = req.body;
      const updates: any = {};

      if (name !== undefined) updates.name = name;
      if (postTemplate !== undefined) updates.postTemplate = postTemplate;
      if (submolt !== undefined) updates.submolt = submolt;
      if (isActive !== undefined) updates.isActive = isActive;

      const trigger = await storage.updateWebhookTrigger(req.params.id, updates);

      if (!trigger) {
        return res.status(404).json({ error: "Webhook not found" });
      }

      res.json(trigger);
    } catch (error) {
      console.error("Error updating webhook:", error);
      res.status(500).json({ error: "Failed to update webhook" });
    }
  });

  // Delete trigger
  app.delete("/api/webhooks/:id", async (req, res) => {
    try {
      await storage.deleteWebhookTrigger(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting webhook:", error);
      res.status(500).json({ error: "Failed to delete webhook" });
    }
  });

  // Webhook receiver endpoint - external services call this
  app.post("/api/webhook/:secret", async (req, res) => {
    try {
      const trigger = await storage.getWebhookTriggerBySecret(req.params.secret);

      if (!trigger) {
        return res.status(404).json({ error: "Invalid webhook" });
      }

      if (!trigger.isActive) {
        return res.status(400).json({ error: "Webhook is disabled" });
      }

      const agent = await storage.getAgent(getSessionId(req));
      if (!agent?.apiKey) {
        return res.status(400).json({ error: "No agent registered" });
      }

      // Parse template with payload data
      let title = trigger.postTemplate;
      let content = "";

      // Replace {{variable}} placeholders with payload data
      const payload = req.body || {};
      
      // Handle different trigger types
      if (trigger.triggerType === "github") {
        // GitHub webhook format
        const repoName = payload.repository?.name || "unknown";
        const commitMsg = payload.head_commit?.message || payload.commits?.[0]?.message || "New commit";
        const branch = payload.ref?.replace("refs/heads/", "") || "main";
        title = title.replace(/\{\{repo\}\}/g, repoName)
                    .replace(/\{\{message\}\}/g, commitMsg)
                    .replace(/\{\{branch\}\}/g, branch);
        content = `Branch: ${branch}\nCommit: ${commitMsg}`;
      } else if (trigger.triggerType === "price_alert") {
        // Price alert format
        const symbol = payload.symbol || "BTC";
        const price = payload.price || "0";
        const change = payload.change || "0%";
        title = title.replace(/\{\{symbol\}\}/g, symbol)
                    .replace(/\{\{price\}\}/g, price)
                    .replace(/\{\{change\}\}/g, change);
        content = `Current price: $${price}`;
      } else {
        // Custom webhook - replace all {{key}} with payload values
        for (const [key, value] of Object.entries(payload)) {
          if (typeof value === "string" || typeof value === "number") {
            title = title.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), String(value));
          }
        }
        content = payload.content || payload.message || "";
      }

      // Check 30-minute rate limit
      const lastPosted = await storage.getLastPostedTime();
      const now = new Date();
      const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000);

      if (lastPosted && lastPosted > thirtyMinsAgo) {
        // Queue for later
        const scheduledFor = new Date(lastPosted.getTime() + 30 * 60 * 1000);
        await storage.addToQueue({
          triggerId: trigger.id,
          submolt: trigger.submolt || "general",
          title,
          content,
          scheduledFor,
        });

        await storage.incrementTriggerCount(trigger.id);

        return res.json({
          queued: true,
          scheduledFor,
          message: "Post queued due to 30-min rate limit",
        });
      }

      // Post immediately
      moltbookApi.setApiKey(agent.apiKey);
      const result = await moltbookApi.createPost(
        trigger.submolt || "general",
        title,
        content
      );

      await storage.incrementTriggerCount(trigger.id);

      if (result.success) {
        // Track in queue as posted
        await storage.addToQueue({
          triggerId: trigger.id,
          submolt: trigger.submolt || "general",
          title,
          content,
        });
        const queueItems = await storage.getPostQueue();
        if (queueItems.length > 0) {
          await storage.markAsPosted(queueItems[0].id);
        }

        res.json({ posted: true, post: result.data });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error) {
      console.error("Error processing webhook:", error);
      res.status(500).json({ error: "Failed to process webhook" });
    }
  });

  // Get post queue
  app.get("/api/queue", async (req, res) => {
    try {
      const queue = await storage.getPostQueue();
      res.json(queue);
    } catch (error) {
      console.error("Error fetching queue:", error);
      res.status(500).json({ error: "Failed to fetch queue" });
    }
  });

  // Process pending posts (call this periodically or manually)
  app.post("/api/queue/process", async (req, res) => {
    try {
      const agent = await storage.getAgent(getSessionId(req));
      if (!agent?.apiKey) {
        return res.status(400).json({ error: "No agent registered" });
      }

      // Check rate limit
      const lastPosted = await storage.getLastPostedTime();
      const now = new Date();
      const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000);

      if (lastPosted && lastPosted > thirtyMinsAgo) {
        return res.json({
          processed: 0,
          nextAvailable: new Date(lastPosted.getTime() + 30 * 60 * 1000),
          message: "Rate limit active, try again later",
        });
      }

      const pending = await storage.getPendingPosts();

      if (pending.length === 0) {
        return res.json({ processed: 0, message: "No pending posts" });
      }

      // Process first pending post
      const post = pending[0];
      moltbookApi.setApiKey(agent.apiKey);

      const result = await moltbookApi.createPost(
        post.submolt,
        post.title,
        post.content || undefined
      );

      if (result.success) {
        await storage.markAsPosted(post.id);
        res.json({ processed: 1, post: result.data });
      } else {
        await storage.markAsFailed(post.id, result.error || "Unknown error");
        res.json({ processed: 0, error: result.error });
      }
    } catch (error) {
      console.error("Error processing queue:", error);
      res.status(500).json({ error: "Failed to process queue" });
    }
  });

  // ============ MEXC Trading API ============

  // Check if MEXC is configured
  app.get("/api/mexc/status", async (req, res) => {
    try {
      const creds = await storage.getMexcCredentials();
      res.json({ configured: !!creds });
    } catch (error) {
      console.error("Error checking MEXC status:", error);
      res.status(500).json({ error: "Failed to check status" });
    }
  });

  // Save MEXC credentials
  app.post("/api/mexc/credentials", async (req, res) => {
    try {
      const { apiKey, secretKey } = req.body;

      if (!apiKey || !secretKey) {
        return res.status(400).json({ error: "API key and secret key are required" });
      }

      const creds = await storage.saveMexcCredentials({ apiKey, secretKey });

      mexcApi.setCredentials({ apiKey, secretKey });

      res.json({ success: true });
    } catch (error) {
      console.error("Error saving credentials:", error);
      res.status(500).json({ error: "Failed to save credentials" });
    }
  });

  // Delete MEXC credentials
  app.delete("/api/mexc/credentials", async (req, res) => {
    try {
      await storage.deleteMexcCredentials();
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting credentials:", error);
      res.status(500).json({ error: "Failed to delete credentials" });
    }
  });

  // Get ticker (public)
  app.get("/api/mexc/ticker/:symbol", async (req, res) => {
    try {
      const ticker = await mexcApi.getTicker(req.params.symbol);
      if (ticker) {
        res.json(ticker);
      } else {
        res.status(404).json({ error: "Ticker not found" });
      }
    } catch (error) {
      console.error("Error fetching ticker:", error);
      res.status(500).json({ error: "Failed to fetch ticker" });
    }
  });

  // Get price (public)
  app.get("/api/mexc/price/:symbol", async (req, res) => {
    try {
      const price = await mexcApi.getPrice(req.params.symbol);
      if (price) {
        res.json(price);
      } else {
        res.status(404).json({ error: "Price not found" });
      }
    } catch (error) {
      console.error("Error fetching price:", error);
      res.status(500).json({ error: "Failed to fetch price" });
    }
  });

  // Get account balance (requires auth)
  app.get("/api/mexc/balance", async (req, res) => {
    try {
      if (!mexcApi.hasCredentials()) {
        return res.status(400).json({ error: "MEXC credentials not configured" });
      }
      const balance = await mexcApi.getBalance();
      res.json(balance);
    } catch (error) {
      console.error("Error fetching balance:", error);
      res.status(500).json({ error: "Failed to fetch balance" });
    }
  });

  // Get open orders (requires auth)
  app.get("/api/mexc/orders", async (req, res) => {
    try {
      if (!mexcApi.hasCredentials()) {
        return res.status(400).json({ error: "MEXC credentials not configured" });
      }
      const symbol = req.query.symbol as string | undefined;
      const orders = await mexcApi.getOpenOrders(symbol);
      res.json(orders);
    } catch (error) {
      console.error("Error fetching orders:", error);
      res.status(500).json({ error: "Failed to fetch orders" });
    }
  });

  // Buy market order
  app.post("/api/mexc/buy", async (req, res) => {
    try {
      if (!mexcApi.hasCredentials()) {
        return res.status(400).json({ error: "MEXC credentials not configured" });
      }

      const { symbol, amount, tp, sl } = req.body;
      if (!symbol || !amount) {
        return res.status(400).json({ error: "symbol and amount are required" });
      }

      // Place market buy order
      const order = await mexcApi.buyMarket(symbol, amount);
      if (!order) {
        return res.status(400).json({ error: "Failed to place buy order" });
      }

      // If TP or SL provided, place limit orders
      let tpSlResult = {};
      if ((tp || sl) && order.executedQty) {
        tpSlResult = await mexcApi.placeTpSlOrders(symbol, order.executedQty, "BUY", tp, sl);
      }

      res.json({ order, ...tpSlResult });
    } catch (error) {
      console.error("Error buying:", error);
      res.status(500).json({ error: "Failed to place buy order" });
    }
  });

  // Sell market order
  app.post("/api/mexc/sell", async (req, res) => {
    try {
      if (!mexcApi.hasCredentials()) {
        return res.status(400).json({ error: "MEXC credentials not configured" });
      }

      const { symbol, quantity, tp, sl } = req.body;
      if (!symbol || !quantity) {
        return res.status(400).json({ error: "symbol and quantity are required" });
      }

      const order = await mexcApi.sellMarket(symbol, quantity);
      if (!order) {
        return res.status(400).json({ error: "Failed to place sell order" });
      }

      res.json({ order });
    } catch (error) {
      console.error("Error selling:", error);
      res.status(500).json({ error: "Failed to place sell order" });
    }
  });

  // Cancel order
  app.post("/api/mexc/cancel", async (req, res) => {
    try {
      if (!mexcApi.hasCredentials()) {
        return res.status(400).json({ error: "MEXC credentials not configured" });
      }

      const { symbol, orderId } = req.body;
      if (!symbol || !orderId) {
        return res.status(400).json({ error: "symbol and orderId are required" });
      }

      const success = await mexcApi.cancelOrder(symbol, orderId);
      res.json({ success });
    } catch (error) {
      console.error("Error canceling order:", error);
      res.status(500).json({ error: "Failed to cancel order" });
    }
  });

  // ============ Signal Scanner API ============

  // Scan Moltbook feed for trading signals
  app.get("/api/signals/scan", async (req, res) => {
    try {
      const agent = await storage.getAgent(getSessionId(req));
      if (!agent?.apiKey) {
        return res.status(400).json({ error: "No Moltbook agent registered" });
      }

      moltbookApi.setApiKey(agent.apiKey);
      const sort = (req.query.sort as "hot" | "new" | "top") || "new";
      const limit = parseInt(req.query.limit as string) || 50;

      const result = await moltbookApi.getFeed(sort, limit);

      if (!result.success || !result.data) {
        return res.status(400).json({ error: result.error || "Failed to fetch feed" });
      }

      // Handle both array and object with posts property
      const feedData = result.data as any;
      const posts = Array.isArray(feedData) ? feedData : (feedData.posts || []);
      const signals = parseSignalsFromFeed(posts);
      res.json(signals);
    } catch (error) {
      console.error("Error scanning signals:", error);
      res.status(500).json({ error: "Failed to scan signals" });
    }
  });

  // Execute a trading signal
  app.post("/api/signals/execute", async (req, res) => {
    try {
      if (!mexcApi.hasCredentials()) {
        return res.status(400).json({ error: "MEXC credentials not configured" });
      }

      const { action, token, amount, tp, sl } = req.body as TradingSignal;
      
      if (!action || !token) {
        return res.status(400).json({ error: "action and token are required" });
      }

      const symbol = `${token}USDT`;
      const tradeAmount = amount || "10"; // Default 10 USDT if no amount specified

      if (action === "buy") {
        const order = await mexcApi.buyMarket(symbol, tradeAmount);
        if (!order) {
          return res.status(400).json({ error: "Failed to place buy order" });
        }

        let tpSlResult = {};
        if ((tp || sl) && order.executedQty) {
          tpSlResult = await mexcApi.placeTpSlOrders(symbol, order.executedQty, "BUY", tp, sl);
        }

        res.json({ success: true, order, ...tpSlResult });
      } else {
        // For sell, we need quantity not USDT amount
        const order = await mexcApi.sellMarket(symbol, tradeAmount);
        if (!order) {
          return res.status(400).json({ error: "Failed to place sell order" });
        }

        res.json({ success: true, order });
      }
    } catch (error) {
      console.error("Error executing signal:", error);
      res.status(500).json({ error: "Failed to execute signal" });
    }
  });

  // ============ Wallet API ============

  // Get agent wallet info
  app.get("/api/wallet", async (req, res) => {
    try {
      const agent = await storage.getAgent(getSessionId(req));
      if (!agent?.walletAddress) {
        return res.status(400).json({ error: "No wallet found. Register an agent first." });
      }

      const walletInfo = await getWalletBalance(agent.walletAddress);
      // Convert BigInt to string for JSON serialization
      res.json({
        address: walletInfo.address,
        balance: walletInfo.balance,
        balanceWei: walletInfo.balanceWei.toString(),
      });
    } catch (error) {
      console.error("Error fetching wallet:", error);
      res.status(500).json({ error: "Failed to fetch wallet info" });
    }
  });

  // Transfer ETH from agent wallet
  app.post("/api/wallet/transfer", async (req, res) => {
    try {
      const agent = await storage.getAgent(getSessionId(req));
      if (!agent?.encryptedPrivateKey || !agent.walletAddress) {
        return res.status(400).json({ error: "No wallet found" });
      }

      const { toAddress, amount } = req.body;
      if (!toAddress) {
        return res.status(400).json({ error: "toAddress is required" });
      }

      let transferAmount = amount;
      
      // Handle "max" - calculate balance minus gas buffer
      if (amount === "max" || !amount) {
        const walletInfo = await getWalletBalance(agent.walletAddress);
        const balanceWei = walletInfo.balanceWei;
        const gasBuffer = BigInt("100000000000000"); // 0.0001 ETH buffer for gas
        
        if (balanceWei <= gasBuffer) {
          return res.status(400).json({ error: "Insufficient balance for transfer + gas" });
        }
        
        const maxTransferWei = balanceWei - gasBuffer;
        transferAmount = (Number(maxTransferWei) / 1e18).toFixed(18);
      }

      const result = await transferEth(agent.encryptedPrivateKey, toAddress, transferAmount);
      if ("error" in result) {
        return res.status(400).json({ error: result.error });
      }

      res.json({ success: true, transactionHash: result.hash, amount: transferAmount });
    } catch (error) {
      console.error("Error transferring:", error);
      res.status(500).json({ error: "Transfer failed" });
    }
  });

  // ============ Token Launch API ============

  // Get all launched tokens
  app.get("/api/tokens", async (req, res) => {
    try {
      const tokens = await storage.getTokenLaunches();
      res.json(tokens);
    } catch (error) {
      console.error("Error fetching tokens:", error);
      res.status(500).json({ error: "Failed to fetch tokens" });
    }
  });

  // Launch a new token on Clanker
  app.post("/api/tokens/launch", async (req, res) => {
    try {
      const agent = await storage.getAgent(getSessionId(req));
      if (!agent?.encryptedPrivateKey) {
        return res.status(400).json({ error: "No wallet found. Register an agent first." });
      }

      const { name, symbol, description, imageUrl } = req.body;
      if (!name || !symbol) {
        return res.status(400).json({ error: "name and symbol are required" });
      }

      // Create pending launch record
      const launch = await storage.createTokenLaunch({
        name,
        symbol,
        description,
        imageUrl,
      });

      // Launch token on Clanker
      const result = await launchToken({
        name,
        symbol,
        description,
        imageUrl,
        encryptedPrivateKey: agent.encryptedPrivateKey,
      });

      if (!result.success) {
        await storage.updateTokenLaunch(launch.id, {
          status: "failed",
          errorMessage: result.error,
        });
        return res.status(400).json({ error: result.error });
      }

      // Update launch record with success info
      const updatedLaunch = await storage.updateTokenLaunch(launch.id, {
        status: "launched",
        tokenAddress: result.tokenAddress,
        transactionHash: result.transactionHash,
        flaunchUrl: result.clankerUrl,
        explorerUrl: result.explorerUrl,
        walletAddress: agent.walletAddress,
      });

      // Auto-post to Moltbook as proof
      let postedToMoltbook = false;
      try {
        if (agent.apiKey) {
          moltbookApi.setApiKey(agent.apiKey);
          const postTitle = `Launched $${symbol} on Base via Clanker`;
          const postContent = `I just deployed **${name}** ($${symbol}) on Base chain!

${description ? `> ${description}\n\n` : ''}**CA:** \`${result.tokenAddress?.toLowerCase()}\`
**Deployer:** \`${agent.walletAddress?.toLowerCase()}\`

**Links:**
- [View on BaseScan](${result.explorerUrl})
- [Trade on Clanker](${result.clankerUrl})

Deployed via ChainMind - AI-powered token launcher on Base.`;

          const postResult = await moltbookApi.createPost("general", postTitle, postContent);
          console.log(`Moltbook createPost response:`, JSON.stringify(postResult, null, 2));
          postedToMoltbook = postResult.success;
          if (postedToMoltbook && postResult.data?.id) {
            const moltbookPostUrl = `https://moltbook.com/p/${postResult.data.id}`;
            await storage.updateTokenLaunch(launch.id, { moltbookPostUrl });
            console.log(`Posted token launch proof to Moltbook for ${symbol}: ${moltbookPostUrl}`);
          } else if (postResult.data) {
            // Sometimes the post ID is nested differently
            const postId = postResult.data?.id || postResult.data?.post?.id;
            if (postId) {
              const moltbookPostUrl = `https://moltbook.com/p/${postId}`;
              await storage.updateTokenLaunch(launch.id, { moltbookPostUrl });
              console.log(`Posted token launch proof to Moltbook for ${symbol}: ${moltbookPostUrl}`);
              postedToMoltbook = true;
            } else {
              console.log(`Moltbook post failed for ${symbol}: ${postResult.error || 'No post ID returned'}`);
            }
          } else {
            console.log(`Moltbook post failed for ${symbol}: ${postResult.error || 'Unknown error'}`);
          }
        }
      } catch (postError) {
        console.error("Failed to post to Moltbook:", postError);
        // Don't fail the launch if posting fails
      }

      // Get updated launch with moltbook URL
      const finalLaunch = await storage.getTokenLaunch(launch.id);

      res.json({
        success: true,
        launch: finalLaunch,
        tokenAddress: result.tokenAddress,
        clankerUrl: result.clankerUrl,
        explorerUrl: result.explorerUrl,
        postedToMoltbook,
      });
    } catch (error) {
      console.error("Error launching token:", error);
      res.status(500).json({ error: "Token launch failed" });
    }
  });

  // Get claimable fees for user's tokens (must be before :address route)
  app.get("/api/tokens/fees", async (req, res) => {
    try {
      const sessionId = getSessionId(req);
      const agent = await storage.getAgent(sessionId);
      
      if (!agent?.walletAddress) {
        return res.status(400).json({ error: "No wallet found" });
      }

      const tokens = await storage.getTokenLaunchesByWallet(agent.walletAddress);
      const tokenAddresses = tokens
        .filter(t => t.tokenAddress)
        .map(t => t.tokenAddress!);

      if (tokenAddresses.length === 0) {
        return res.json({ claimableTokens: [], totalFees: "0" });
      }

      const fees = await getClaimableFees(agent.walletAddress, tokenAddresses);
      
      // Add token info to results
      const claimableTokens = fees.claimableTokens.map(f => {
        const token = tokens.find(t => t.tokenAddress === f.tokenAddress);
        return {
          ...f,
          symbol: token?.symbol || "???",
          name: token?.name || "Unknown"
        };
      });

      res.json({ claimableTokens, totalFees: fees.totalFees });
    } catch (error) {
      console.error("Error getting fees:", error);
      res.status(500).json({ error: "Failed to get fees" });
    }
  });

  // Claim all fees
  app.post("/api/tokens/claim-fees", async (req, res) => {
    try {
      const sessionId = getSessionId(req);
      const agent = await storage.getAgent(sessionId);
      
      if (!agent?.encryptedPrivateKey) {
        return res.status(400).json({ error: "No wallet found" });
      }

      const result = await claimFees(agent.encryptedPrivateKey);
      res.json(result);
    } catch (error) {
      console.error("Error claiming fees:", error);
      res.status(500).json({ error: "Failed to claim fees" });
    }
  });

  // Get token info from Clanker (must be after /fees routes)
  app.get("/api/tokens/:address", async (req, res) => {
    try {
      const { address } = req.params;
      const tokenInfo = await getTokenInfo(address);
      if (!tokenInfo) {
        return res.status(404).json({ error: "Token not found" });
      }
      res.json(tokenInfo);
    } catch (error) {
      console.error("Error fetching token info:", error);
      res.status(500).json({ error: "Failed to fetch token info" });
    }
  });

  // ============ Trading API ============

  // Buy tokens with ETH
  app.post("/api/trade/buy", async (req, res) => {
    try {
      const sessionId = getSessionId(req);
      const agent = await storage.getAgent(sessionId);
      
      if (!agent?.encryptedPrivateKey) {
        return res.status(400).json({ error: "No wallet found. Register first!" });
      }

      const { tokenAddress, amountEth } = req.body;
      if (!tokenAddress) {
        return res.status(400).json({ error: "Token address required" });
      }

      const result = await buyToken(agent.encryptedPrivateKey, tokenAddress, amountEth || "0.01");
      res.json(result);
    } catch (error) {
      console.error("Error buying token:", error);
      res.status(500).json({ error: "Buy failed" });
    }
  });

  // Sell tokens for ETH
  app.post("/api/trade/sell", async (req, res) => {
    try {
      const sessionId = getSessionId(req);
      const agent = await storage.getAgent(sessionId);
      
      if (!agent?.encryptedPrivateKey) {
        return res.status(400).json({ error: "No wallet found. Register first!" });
      }

      const { tokenAddress, amount } = req.body;
      if (!tokenAddress) {
        return res.status(400).json({ error: "Token address required" });
      }

      const result = await sellToken(agent.encryptedPrivateKey, tokenAddress, amount || "all");
      res.json(result);
    } catch (error) {
      console.error("Error selling token:", error);
      res.status(500).json({ error: "Sell failed" });
    }
  });

  // Get WETH balance
  app.get("/api/wallet/weth", async (req, res) => {
    try {
      const sessionId = getSessionId(req);
      const agent = await storage.getAgent(sessionId);
      
      if (!agent?.walletAddress) {
        return res.json({ balance: "0" });
      }

      const balance = await getWethBalance(agent.walletAddress);
      res.json({ balance });
    } catch (error) {
      console.error("Error getting WETH balance:", error);
      res.json({ balance: "0" });
    }
  });

  // Unwrap WETH to ETH
  app.post("/api/trade/unwrap", async (req, res) => {
    try {
      const sessionId = getSessionId(req);
      const agent = await storage.getAgent(sessionId);
      
      if (!agent?.encryptedPrivateKey) {
        return res.status(400).json({ error: "No wallet found. Register first!" });
      }

      const { amount } = req.body;
      const result = await unwrapWeth(agent.encryptedPrivateKey, amount);
      res.json(result);
    } catch (error) {
      console.error("Error unwrapping WETH:", error);
      res.status(500).json({ error: "Unwrap failed" });
    }
  });

  return httpServer;
}
