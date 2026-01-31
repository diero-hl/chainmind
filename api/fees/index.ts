import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';
import { createPublicClient, createWalletClient, http, formatEther, formatUnits } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const sql = neon(process.env.DATABASE_URL!);
const ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY || "lobstr-default-key-change-me-32ch";

const publicClient = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org"),
});

const WETH = "0x4200000000000000000000000000000000000006";
const CLANKER_FACTORY = "0x2A787b2362021cC3eEa3C24C4748a6cD5B687382";

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

const FACTORY_ABI = [
  {
    inputs: [{ name: "token", type: "address" }],
    name: "deployments",
    outputs: [
      { name: "deployer", type: "address" },
      { name: "pool", type: "address" },
      { name: "positionId", type: "uint256" },
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "protocolRecipient", type: "address" },
      { name: "protocolFee", type: "uint24" },
      { name: "active", type: "bool" }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { name: "token", type: "address" },
      { name: "recipient", type: "address" },
      { name: "amount0Max", type: "uint128" },
      { name: "amount1Max", type: "uint128" }
    ],
    name: "collect",
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" }
    ],
    stateMutability: "nonpayable",
    type: "function"
  }
] as const;

const POOL_ABI = [
  {
    inputs: [{ name: "positionId", type: "uint256" }],
    name: "positions",
    outputs: [
      { name: "nonce", type: "uint96" },
      { name: "operator", type: "address" },
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
      { name: "liquidity", type: "uint128" },
      { name: "feeGrowthInside0LastX128", type: "uint256" },
      { name: "feeGrowthInside1LastX128", type: "uint256" },
      { name: "tokensOwed0", type: "uint128" },
      { name: "tokensOwed1", type: "uint128" }
    ],
    stateMutability: "view",
    type: "function"
  }
] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST = Claim fees
  if (req.method === 'POST') {
    const sessionId = req.headers['x-session-id'] as string;
    const { tokenAddress } = req.body;

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

      const MAX_UINT128 = BigInt("340282366920938463463374607431768211455");

      const hash = await walletClient.writeContract({
        address: CLANKER_FACTORY as `0x${string}`,
        abi: FACTORY_ABI,
        functionName: "collect",
        args: [tokenAddress as `0x${string}`, account.address, MAX_UINT128, MAX_UINT128]
      });

      await publicClient.waitForTransactionReceipt({ hash });

      return res.json({ success: true, transactionHash: hash });
    } catch (error: any) {
      console.error("Claim fees error:", error);
      return res.json({ success: false, error: error.message || "Claim failed" });
    }
  }

  // GET = Check fees
  const { tokenAddress } = req.query;

  if (!tokenAddress || typeof tokenAddress !== 'string') {
    return res.status(400).json({ error: 'Token address required' });
  }

  try {
    const deployment = await publicClient.readContract({
      address: CLANKER_FACTORY as `0x${string}`,
      abi: FACTORY_ABI,
      functionName: "deployments",
      args: [tokenAddress as `0x${string}`]
    });

    if (!deployment[7]) {
      return res.json({ claimableEth: "0", claimableTokens: "0" });
    }

    const poolAddress = deployment[1];
    const positionId = deployment[2];
    const token0 = deployment[3];

    const position = await publicClient.readContract({
      address: poolAddress as `0x${string}`,
      abi: POOL_ABI,
      functionName: "positions",
      args: [positionId]
    });

    const tokensOwed0 = position[9];
    const tokensOwed1 = position[10];

    const isToken0Weth = token0.toLowerCase() === WETH.toLowerCase();

    return res.json({
      claimableEth: formatEther(isToken0Weth ? tokensOwed0 : tokensOwed1),
      claimableTokens: formatUnits(isToken0Weth ? tokensOwed1 : tokensOwed0, 18)
    });
  } catch (error: any) {
    console.error("Get fees error:", error);
    return res.json({ claimableEth: "0", claimableTokens: "0" });
  }
}
