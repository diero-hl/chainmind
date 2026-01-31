import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';
import { createPublicClient, createWalletClient, http, formatEther, parseEther } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const sql = neon(process.env.DATABASE_URL!);
const ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY || "lobstr-default-key-change-me-32ch";

const publicClient = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org"),
});

function decryptPrivateKey(encryptedPrivateKey: string): string {
  const parts = encryptedPrivateKey.split(":");
  
  // New gcm format from Edge runtime
  if (parts[0] === 'gcm') {
    const ivHex = parts[1];
    const encHex = parts[2];
    const keyData = Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32));
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encHex, 'hex');
    const authTag = encrypted.slice(-16);
    const ciphertext = encrypted.slice(0, -16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyData, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
  }
  
  // Old CBC format
  const key = crypto.scryptSync(ENCRYPTION_KEY, "salt", 32);
  const [ivHex, encrypted] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sessionId = req.headers['x-session-id'] as string;

  // POST = Transfer ETH
  if (req.method === 'POST') {
    const { toAddress, amountEth } = req.body;

    if (!toAddress) return res.status(400).json({ error: 'Recipient address required' });
    if (!amountEth) return res.status(400).json({ error: 'Amount required' });

    try {
      const result = await sql`SELECT encrypted_private_key FROM moltbook_agent WHERE session_id = ${sessionId} LIMIT 1`;
      if (!result[0]?.encrypted_private_key) {
        return res.status(400).json({ error: 'No wallet found. Register first!' });
      }

      const privateKey = decryptPrivateKey(result[0].encrypted_private_key);
      const account = privateKeyToAccount(privateKey as `0x${string}`);
      
      const walletClient = createWalletClient({
        account,
        chain: base,
        transport: http("https://mainnet.base.org"),
      });

      // Calculate amount to send
      let valueToSend: bigint;
      
      if (amountEth === "max") {
        // Get current balance
        const balance = await publicClient.getBalance({ address: account.address });
        // Estimate gas for a simple transfer (21000 gas) with buffer
        const gasPrice = await publicClient.getGasPrice();
        const estimatedGas = BigInt(21000) * gasPrice * BigInt(2); // 2x buffer for safety
        
        if (balance <= estimatedGas) {
          return res.status(400).json({ error: 'Insufficient funds for gas' });
        }
        
        valueToSend = balance - estimatedGas;
      } else {
        valueToSend = parseEther(amountEth);
      }

      const hash = await walletClient.sendTransaction({
        to: toAddress as `0x${string}`,
        value: valueToSend,
      });

      await publicClient.waitForTransactionReceipt({ hash });

      return res.json({ success: true, hash });
    } catch (error: any) {
      console.error("Transfer error:", error);
      if (error.message?.includes("insufficient funds")) {
        return res.json({ success: false, error: "Insufficient funds" });
      }
      return res.json({ success: false, error: error.message || "Transfer failed" });
    }
  }

  // GET = Get wallet balance
  try {
    const result = await sql`SELECT wallet_address FROM moltbook_agent WHERE session_id = ${sessionId} LIMIT 1`;
    
    if (!result[0]?.wallet_address) {
      return res.status(404).json({ error: 'No wallet found' });
    }

    const balance = await publicClient.getBalance({ address: result[0].wallet_address as `0x${string}` });

    return res.json({
      address: result[0].wallet_address,
      balance: formatEther(balance),
      balanceWei: balance.toString()
    });
  } catch (error) {
    console.error('Wallet API error:', error);
    return res.status(500).json({ error: 'Failed to fetch wallet' });
  }
}
