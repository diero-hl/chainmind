import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { createWalletClient, createPublicClient, http, type WalletClient, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import crypto from 'crypto';

const sql = neon(process.env.DATABASE_URL!);

const ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY || "lobstr-default-key-change-me-32ch";

function decryptPrivateKey(encrypted: string): string {
  const key = crypto.scryptSync(ENCRYPTION_KEY, "salt", 32);
  
  const [ivHex, encryptedHex] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const encryptedBuffer = Buffer.from(encryptedHex, 'hex');
  
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return decipher.update(encryptedBuffer, undefined, 'utf8') + decipher.final('utf8');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET - List tokens
  if (req.method === 'GET') {
    try {
      const result = await sql`SELECT * FROM token_launches WHERE status = 'launched' ORDER BY created_at DESC`;
      
      const tokens = result.map((t: any) => ({
        id: t.id,
        name: t.name,
        symbol: t.symbol,
        description: t.description,
        imageUrl: t.image_url,
        tokenAddress: t.token_address,
        transactionHash: t.transaction_hash,
        clankerUrl: t.flaunch_url,
        explorerUrl: t.explorer_url,
        walletAddress: t.wallet_address,
        moltbookPostUrl: t.moltbook_post_url,
        status: t.status,
        createdAt: t.created_at
      }));
      
      return res.json(tokens);
    } catch (error) {
      console.error('Tokens list error:', error);
      return res.json([]);
    }
  }

  // POST - Launch token via Clanker SDK
  if (req.method === 'POST') {
    const sessionId = req.headers['x-session-id'] as string;
    if (!sessionId) return res.status(400).json({ error: 'Session ID required' });

    const { name, symbol, description, imageUrl } = req.body;
    if (!name || !symbol) return res.status(400).json({ error: 'Name and symbol required' });

    try {
      // Get agent
      const agentResult = await sql`SELECT * FROM moltbook_agent WHERE session_id = ${sessionId} LIMIT 1`;
      if (!agentResult[0]) return res.status(401).json({ error: 'Agent not registered' });
      
      const agent = agentResult[0];
      const privateKey = decryptPrivateKey(agent.encrypted_private_key) as `0x${string}`;
      const account = privateKeyToAccount(privateKey);

      // Setup viem clients
      const publicClient: PublicClient = createPublicClient({
        chain: base,
        transport: http('https://mainnet.base.org')
      });

      // Check wallet balance first
      const balance = await publicClient.getBalance({ address: account.address });
      const balanceEth = Number(balance) / 1e18;
      
      if (balanceEth < 0.001) {
        return res.status(400).json({ 
          error: `Wallet needs ETH for gas. Current balance: ${balanceEth.toFixed(6)} ETH. Send at least 0.01 ETH to ${account.address}` 
        });
      }

      const walletClient: WalletClient = createWalletClient({
        account,
        chain: base,
        transport: http('https://mainnet.base.org')
      });

      // Import Clanker SDK dynamically
      const { Clanker } = await import('clanker-sdk/v4');

      // Initialize SDK
      const clanker = new Clanker({
        publicClient: publicClient as any,
        wallet: walletClient as any,
      });

      // Deploy token with initial liquidity
      const deployConfig: any = {
        name,
        symbol,
        tokenAdmin: account.address,
        metadata: {
          description: description || `${name} token launched via ChainMind`,
        },
        context: {
          interface: 'ChainMind',
        },
      };

      // Add devBuy if wallet has enough ETH (0.001 ETH minimum for initial buy)
      if (balanceEth >= 0.002) {
        deployConfig.devBuy = {
          ethAmount: 0.001, // Initial buy creates liquidity
        };
      }

      const { txHash, waitForTransaction, error: deployError } = await clanker.deploy(deployConfig);

      if (deployError) {
        console.error('Clanker deploy error:', deployError);
        return res.status(500).json({ error: `Deploy failed: ${deployError.message || deployError}` });
      }

      // Wait for transaction confirmation
      const { address: tokenAddress, error: waitError } = await waitForTransaction();
      
      if (waitError || !tokenAddress) {
        console.error('Transaction wait error:', waitError);
        return res.status(500).json({ error: 'Transaction failed to confirm' });
      }

      // Save to database (use flaunch_url for clanker link)
      await sql`INSERT INTO token_launches (name, symbol, description, image_url, token_address, transaction_hash, wallet_address, flaunch_url, explorer_url, status, created_at)
                VALUES (${name}, ${symbol}, ${description || ''}, ${imageUrl || ''}, ${tokenAddress}, ${txHash || ''}, ${account.address}, 
                        ${'https://clanker.world/clanker/' + tokenAddress}, ${'https://basescan.org/token/' + tokenAddress}, 'launched', NOW())`;

      // Post to Moltbook if agent has API key
      let moltbookPostUrl = null;
      if (agent.api_key) {
        try {
          const moltbookRes = await fetch('https://www.moltbook.com/api/v1/posts', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': agent.api_key
            },
            body: JSON.stringify({
              content: `Just launched ${name} ($${symbol}) on Base!\n\nContract: ${tokenAddress}\n\nhttps://basescan.org/token/${tokenAddress}`,
              submolt: 'clanker'
            })
          });
          
          if (moltbookRes.ok) {
            const postData = await moltbookRes.json();
            moltbookPostUrl = postData.post?.url || `https://moltbook.com/p/${postData.post?.id}`;
          }
        } catch (e) {
          console.error('Moltbook post error:', e);
        }
      }

      return res.json({
        success: true,
        tokenAddress,
        transactionHash: txHash,
        explorerUrl: `https://basescan.org/token/${tokenAddress}`,
        clankerUrl: `https://clanker.world/clanker/${tokenAddress}`,
        postedToMoltbook: !!moltbookPostUrl,
        moltbookPostUrl
      });
    } catch (error: any) {
      console.error('Token launch error:', error);
      return res.status(500).json({ error: error.message || 'Launch failed' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
