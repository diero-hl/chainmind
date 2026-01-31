import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const sql = neon(process.env.DATABASE_URL!);
const ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY || "lobstr-default-key-change-me-32ch";

function encryptPrivateKey(privateKey: string): string {
  const key = crypto.scryptSync(ENCRYPTION_KEY, "salt", 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(privateKey, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sessionId = req.headers['x-session-id'] as string;
  const { name, apiKey, claimUrl, verificationCode } = req.body;

  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!apiKey) return res.status(400).json({ error: 'API key is required - register on Moltbook first' });
  if (!sessionId) return res.status(400).json({ error: 'Session ID required' });

  try {
    // Check if agent exists for this session
    const existing = await sql`SELECT id FROM moltbook_agent WHERE session_id = ${sessionId} LIMIT 1`;
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Agent already registered. Delete first to re-register.' });
    }

    // Check if API key already used
    const apiKeyExists = await sql`SELECT id FROM moltbook_agent WHERE api_key = ${apiKey} LIMIT 1`;
    if (apiKeyExists.length > 0) {
      return res.status(400).json({ error: 'This API key is already linked to another wallet.' });
    }

    // Generate wallet
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const encryptedPrivateKey = encryptPrivateKey(privateKey);

    // Store in database - skip verification since we just registered
    const id = crypto.randomUUID();
    await sql`INSERT INTO moltbook_agent (id, session_id, name, description, api_key, claim_url, verification_code, status, karma, wallet_address, encrypted_private_key, created_at)
      VALUES (${id}, ${sessionId}, ${name}, ${req.body.description || ''}, ${apiKey}, ${claimUrl || ''}, ${verificationCode || ''}, 'pending', 0, ${account.address}, ${encryptedPrivateKey}, NOW())`;

    return res.json({
      agent: {
        id,
        name,
        description: req.body.description || '',
        apiKey,
        status: 'pending',
        karma: 0,
        walletAddress: account.address
      },
      claimUrl,
      verificationCode,
      walletAddress: account.address
    });
  } catch (error: any) {
    console.error("Register error:", error);
    return res.status(500).json({ error: error.message || 'Registration failed' });
  }
}
