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
  const { message } = req.body;

  if (!message) return res.status(400).json({ error: 'Message required' });

  try {
    const agentResult = await sql`SELECT * FROM moltbook_agent WHERE session_id = ${sessionId} LIMIT 1`;
    const agent = agentResult[0];

    let walletBalance = '0';
    if (agent?.wallet_address) {
      try {
        const { ethers } = await import('ethers');
        const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
        const balance = await provider.getBalance(agent.wallet_address);
        walletBalance = ethers.formatEther(balance);
      } catch (e) {}
    }

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: `You are ChainMind, an AI assistant for launching tokens on Base blockchain. 
Current context:
- Agent registered: ${!!agent}
- Agent name: ${agent?.name || 'Not registered'}
- Wallet: ${agent?.wallet_address || 'None'}
- Balance: ${walletBalance} ETH

Help users launch tokens, check wallet, and trade. Be concise and helpful.
For token launches, guide them through: name, symbol, description, image URL.
Respond in casual Filipino/English mix.`,
        messages: [{ role: 'user', content: message }]
      })
    });

    const data = await anthropicRes.json();
    const response = data.content?.[0]?.text || 'Sorry, may error. Try again.';

    return res.json({ response, action: null });
  } catch (error) {
    console.error('Chat error:', error);
    return res.status(500).json({ error: 'Chat failed' });
  }
}
