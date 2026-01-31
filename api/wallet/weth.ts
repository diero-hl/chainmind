import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { createPublicClient, http, formatEther } from 'viem';
import { base } from 'viem/chains';

const sql = neon(process.env.DATABASE_URL!);

const publicClient = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org"),
});

const WETH = "0x4200000000000000000000000000000000000006";

const WETH_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  }
] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sessionId = req.headers['x-session-id'] as string;

  try {
    const result = await sql`SELECT wallet_address FROM moltbook_agent WHERE session_id = ${sessionId} LIMIT 1`;
    
    if (!result[0]?.wallet_address) {
      return res.json({ balance: "0" });
    }

    const balance = await publicClient.readContract({
      address: WETH as `0x${string}`,
      abi: WETH_ABI,
      functionName: "balanceOf",
      args: [result[0].wallet_address as `0x${string}`]
    });

    return res.json({ balance: formatEther(balance) });
  } catch (error) {
    console.error("WETH balance error:", error);
    return res.json({ balance: "0" });
  }
}
