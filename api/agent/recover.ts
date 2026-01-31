import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sessionId = req.headers['x-session-id'] as string;
  const { apiKey } = req.body;

  if (!apiKey) return res.status(400).json({ error: 'API key required' });
  if (!sessionId) return res.status(400).json({ error: 'Session ID required' });

  try {
    const result = await sql`SELECT * FROM moltbook_agent WHERE api_key = ${apiKey} LIMIT 1`;
    if (result.length === 0) {
      return res.status(404).json({ error: 'No agent found with that API key' });
    }

    await sql`UPDATE moltbook_agent SET session_id = ${sessionId} WHERE api_key = ${apiKey}`;

    const agent = result[0];
    return res.json({
      agent: {
        id: agent.id,
        sessionId,
        name: agent.name,
        description: agent.description,
        apiKey: agent.api_key,
        claimUrl: agent.claim_url,
        verificationCode: agent.verification_code,
        status: agent.status,
        karma: agent.karma,
        walletAddress: agent.wallet_address
      }
    });
  } catch (error) {
    console.error('Recovery error:', error);
    return res.status(500).json({ error: 'Failed to recover agent' });
  }
}
