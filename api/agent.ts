import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sessionId = req.headers['x-session-id'] as string;

  try {
    if (req.method === 'GET') {
      if (!sessionId) return res.json(null);
      
      const result = await sql`SELECT * FROM moltbook_agent WHERE session_id = ${sessionId} LIMIT 1`;
      if (result.length === 0) return res.json(null);
      
      const agent = result[0];
      return res.json({
        id: agent.id,
        sessionId: agent.session_id,
        name: agent.name,
        description: agent.description,
        apiKey: agent.api_key,
        claimUrl: agent.claim_url,
        verificationCode: agent.verification_code,
        status: agent.status,
        karma: agent.karma,
        walletAddress: agent.wallet_address,
        encryptedPrivateKey: agent.encrypted_private_key,
        createdAt: agent.created_at
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Agent API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
