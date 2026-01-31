import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';
import { createPublicClient, createWalletClient, http, formatEther } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const sql = neon(process.env.DATABASE_URL!);
const ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY || "lobstr-default-key-change-me-32ch";

const publicClient = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org"),
});

const ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

const ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
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

async function getSwapQuote(sellToken: string, buyToken: string, sellAmount: string, takerAddress: string) {
  const url = `https://aggregator-api.kyberswap.com/base/api/v1/routes?tokenIn=${sellToken}&tokenOut=${buyToken}&amountIn=${sellAmount}&saveGas=false&gasInclude=true`;
  
  const res = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error(`Failed to get swap route: ${res.status}`);
  
  const routeData = await res.json();
  if (!routeData.data?.routeSummary) throw new Error("No route found for this swap");
  
  const buildRes = await fetch(`https://aggregator-api.kyberswap.com/base/api/v1/route/build`, {
    method: "POST",
    headers: { "Accept": "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      routeSummary: routeData.data.routeSummary,
      sender: takerAddress,
      recipient: takerAddress,
      slippageTolerance: 500,
    })
  });
  
  if (!buildRes.ok) throw new Error(`Failed to build swap: ${buildRes.status}`);
  const buildData = await buildRes.json();
  return buildData.data;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sessionId = req.headers['x-session-id'] as string;
  const { tokenAddress, amount } = req.body;

  if (!tokenAddress) return res.status(400).json({ error: 'Token address required' });

  try {
    const result = await sql`SELECT encrypted_private_key, wallet_address FROM moltbook_agent WHERE session_id = ${sessionId} LIMIT 1`;
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

    const decimals = await publicClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "decimals"
    });

    const currentBalance = await publicClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account.address]
    });

    const amountToSell = amount === "all" 
      ? currentBalance 
      : BigInt(Math.floor(parseFloat(amount) * (10 ** decimals)));

    if (amountToSell === 0n) {
      return res.json({ success: false, error: "No tokens to sell" });
    }

    const swapData = await getSwapQuote(tokenAddress, ETH_ADDRESS, amountToSell.toString(), account.address);

    const approveHash = await walletClient.writeContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [swapData.routerAddress as `0x${string}`, amountToSell]
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });

    const ethBefore = await publicClient.getBalance({ address: account.address });

    const hash = await walletClient.sendTransaction({
      to: swapData.routerAddress as `0x${string}`,
      data: swapData.data as `0x${string}`,
      value: 0n,
    });

    await publicClient.waitForTransactionReceipt({ hash });

    const ethAfter = await publicClient.getBalance({ address: account.address });
    const ethReceived = ethAfter - ethBefore;

    return res.json({
      success: true,
      transactionHash: hash,
      ethReceived: formatEther(ethReceived > 0n ? ethReceived : 0n)
    });
  } catch (error: any) {
    console.error("Sell error:", error);
    if (error.message?.includes("insufficient funds")) {
      return res.json({ success: false, error: "Insufficient gas. Add ETH." });
    }
    if (error.message?.includes("No route found")) {
      return res.json({ success: false, error: "No liquidity found." });
    }
    return res.json({ success: false, error: error.message || "Sell failed" });
  }
}
