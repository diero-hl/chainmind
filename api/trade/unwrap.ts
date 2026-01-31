import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const sql = neon(process.env.DATABASE_URL!);
const ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY || "lobstr-default-key-change-me-32ch";

const publicClient = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org"),
});

const WETH = "0x4200000000000000000000000000000000000006";

const WETH_ABI = [
  {
    inputs: [{ name: "wad", type: "uint256" }],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  }
] as const;

function decryptPrivateKey(encryptedPrivateKey: string): string {
  const parts = encryptedPrivateKey.split(":");
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sessionId = req.headers['x-session-id'] as string;
  const { amount } = req.body;

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

    const wethBalance = await publicClient.readContract({
      address: WETH as `0x${string}`,
      abi: WETH_ABI,
      functionName: "balanceOf",
      args: [account.address]
    });

    if (wethBalance === 0n) {
      return res.json({ success: false, error: "No WETH to unwrap" });
    }

    const amountToUnwrap = amount === "all" || !amount
      ? wethBalance
      : parseEther(amount);

    if (amountToUnwrap > wethBalance) {
      return res.json({ success: false, error: `Not enough WETH. You have ${formatEther(wethBalance)} WETH` });
    }

    const hash = await walletClient.writeContract({
      address: WETH as `0x${string}`,
      abi: WETH_ABI,
      functionName: "withdraw",
      args: [amountToUnwrap]
    });

    await publicClient.waitForTransactionReceipt({ hash });

    return res.json({
      success: true,
      transactionHash: hash,
      ethReceived: formatEther(amountToUnwrap)
    });
  } catch (error: any) {
    console.error("Unwrap error:", error);
    if (error.message?.includes("insufficient funds")) {
      return res.json({ success: false, error: "Insufficient gas. Add ETH." });
    }
    return res.json({ success: false, error: "Unwrap failed. Try again." });
  }
}
