import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const sessionId = req.headers['x-session-id'] as string;
  if (!sessionId) return res.status(400).json({ error: 'Session ID required' });

  try {
    const result = await sql`SELECT api_key, status, name FROM moltbook_agent WHERE session_id = ${sessionId} LIMIT 1`;
    if (!result[0]) {
      return res.status(404).json({ error: 'No agent found' });
    }

    const agent = result[0];

    // Check status with Moltbook
    try {
      const moltRes = await fetch("https://www.moltbook.com/api/v1/agents/me", {
        headers: { "X-API-Key": agent.api_key }
      });
      const moltData = await moltRes.json();
      
      if (moltData.agent) {
        // Update local status if different
        if (moltData.agent.status !== agent.status || moltData.agent.is_claimed) {
          const newStatus = moltData.agent.is_claimed ? 'active' : moltData.agent.status;
          await sql`UPDATE moltbook_agent SET status = ${newStatus}, karma = ${moltData.agent.karma || 0} WHERE session_id = ${sessionId}`;
        }
        
        return res.json({
          status: moltData.agent.status,
          is_claimed: moltData.agent.is_claimed,
          karma: moltData.agent.karma,
          name: moltData.agent.name
        });
      }
    } catch (e) {
      console.error("Moltbook status check failed:", e);
    }

    // Return local status if Moltbook check fails
    return res.json({
      status: agent.status,
      is_claimed: agent.status === 'active',
      name: agent.name
    });
  } catch (error: any) {
    console.error("Status check error:", error);
    return res.status(500).json({ error: error.message || 'Status check failed' });
  }
}
