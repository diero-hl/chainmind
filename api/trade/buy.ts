import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';
import { createPublicClient, createWalletClient, http, parseEther, formatUnits, encodeFunctionData } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const sql = neon(process.env.DATABASE_URL!);
const ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY || "lobstr-default-key-change-me-32ch";

const publicClient = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org"),
});

const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const UNIVERSAL_ROUTER = "0x6ff5693b99212da76ad316178a184ab56d299b43"; // Uniswap v4 Universal Router on Base
const POOL_MANAGER = "0x498581ff718922c3f8e6a244956af099b2652b2b"; // Base PoolManager

// Clanker hook addresses on Base
const CLANKER_HOOKS = [
  "0xd60D6B218116cFd801E28F78d011a203D2b068Cc", // feeDynamicHookV2
  "0xb429d62f8f3bFFb98CdB9569533eA23bF0Ba28CC", // feeStaticHookV2
  "0x34a45c6B61876d739400Bd71228CbcbD4F53E8cC", // feeDynamicHook
  "0xDd5EeaFf7BD481AD55Db083062b13a3cdf0A68CC", // feeStaticHook
];

// Command bytes for Universal Router
const V4_SWAP = 0x10;

// Action bytes for v4 router
const SWAP_EXACT_IN_SINGLE = 0x06;
const SETTLE_ALL = 0x0c;
const TAKE_ALL = 0x09;

const CLANKER_DEVBUY = "0x1331f0788F9c08C8F38D52c7a1152250A9dE00be";

const DEVBUY_ABI = [
  {
    inputs: [
      { name: "tokenAddress", type: "address" },
      { name: "recipient", type: "address" },
      { name: "minAmountOut", type: "uint256" }
    ],
    name: "buy",
    outputs: [{ name: "amountOut", type: "uint256" }],
    stateMutability: "payable",
    type: "function"
  }
] as const;

const ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
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

async function getSwapQuote(buyToken: string, sellAmount: string, takerAddress: string) {
  // Try Kyberswap first (best v4 support)
  try {
    const kyberRouteRes = await fetch(
      `https://aggregator-api.kyberswap.com/base/api/v1/routes?tokenIn=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE&tokenOut=${buyToken}&amountIn=${sellAmount}&saveGas=true`,
      { headers: { "X-Client-Id": "chainmind" } }
    );

    if (kyberRouteRes.ok) {
      const routeData = await kyberRouteRes.json();
      if (routeData.data?.routeSummary) {
        const kyberBuildRes = await fetch(
          "https://aggregator-api.kyberswap.com/base/api/v1/route/build",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Client-Id": "chainmind" },
            body: JSON.stringify({
              routeSummary: routeData.data.routeSummary,
              sender: takerAddress,
              recipient: takerAddress,
              slippageTolerance: 300, // 3%
            })
          }
        );

        if (kyberBuildRes.ok) {
          const buildData = await kyberBuildRes.json();
          if (buildData.data?.data) {
            return {
              to: routeData.data.routerAddress,
              data: buildData.data.data,
              value: sellAmount,
              type: 'kyberswap'
            };
          }
        }
      }
    }
  } catch (e) {
    console.log("Kyberswap failed:", e);
  }

  // Try Odos (supports many tokens including some v4)
  try {
    const odosQuote = await fetch("https://api.odos.xyz/sor/quote/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chainId: 8453,
        inputTokens: [{ tokenAddress: "0x0000000000000000000000000000000000000000", amount: sellAmount }],
        outputTokens: [{ tokenAddress: buyToken, proportion: 1 }],
        userAddr: takerAddress,
        slippageLimitPercent: 3,
        disableRFQs: true,
      })
    });

    if (odosQuote.ok) {
      const quoteData = await odosQuote.json();
      if (quoteData.pathId) {
        const odosAssemble = await fetch("https://api.odos.xyz/sor/assemble", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userAddr: takerAddress,
            pathId: quoteData.pathId,
          })
        });

        if (odosAssemble.ok) {
          const assembleData = await odosAssemble.json();
          if (assembleData.transaction) {
            return {
              to: assembleData.transaction.to,
              data: assembleData.transaction.data,
              value: assembleData.transaction.value,
              type: 'odos'
            };
          }
        }
      }
    }
  } catch (e) {
    console.log("Odos failed:", e);
  }

  // Try ParaSwap
  try {
    const priceRes = await fetch(
      `https://apiv5.paraswap.io/prices?srcToken=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE&destToken=${buyToken}&amount=${sellAmount}&network=8453&side=SELL`
    );
    
    if (priceRes.ok) {
      const priceData = await priceRes.json();
      if (priceData.priceRoute) {
        const txRes = await fetch(`https://apiv5.paraswap.io/transactions/8453`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            srcToken: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
            destToken: buyToken,
            srcAmount: sellAmount,
            slippage: 300, // 3%
            priceRoute: priceData.priceRoute,
            userAddress: takerAddress,
          })
        });

        if (txRes.ok) {
          const txData = await txRes.json();
          return {
            to: txData.to,
            data: txData.data,
            value: txData.value,
            type: 'paraswap'
          };
        }
      }
    }
  } catch (e) {
    console.log("ParaSwap failed:", e);
  }

  // Try 1inch
  try {
    const oneInchRes = await fetch(
      `https://api.1inch.dev/swap/v6.0/8453/swap?src=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE&dst=${buyToken}&amount=${sellAmount}&from=${takerAddress}&slippage=3&disableEstimate=true`,
      { headers: { "Authorization": `Bearer ${process.env.ONEINCH_API_KEY || ""}` } }
    );

    if (oneInchRes.ok) {
      const data = await oneInchRes.json();
      if (data.tx) {
        return {
          to: data.tx.to,
          data: data.tx.data,
          value: data.tx.value,
          type: '1inch'
        };
      }
    }
  } catch (e) {
    console.log("1inch failed:", e);
  }

  // Return null to signal fallback to Clanker devbuy
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sessionId = req.headers['x-session-id'] as string;
  const { tokenAddress, amountEth } = req.body;

  if (!tokenAddress) return res.status(400).json({ error: 'Token address required' });

  try {
    const result = await sql`SELECT encrypted_private_key, wallet_address FROM moltbook_agent WHERE session_id = ${sessionId} LIMIT 1`;
    if (!result[0]?.encrypted_private_key) {
      return res.status(400).json({ error: 'No wallet found. Register first!' });
    }

    const privateKey = decryptPrivateKey(result[0].encrypted_private_key);
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    
    // Check balance first
    const balance = await publicClient.getBalance({ address: account.address });
    const amountIn = parseEther(amountEth || "0.001");
    
    if (balance < amountIn + parseEther("0.0005")) { // Extra for gas
      return res.status(400).json({ 
        error: `Insufficient ETH. You have ${formatUnits(balance, 18)} ETH but need ${amountEth || "0.001"} ETH + gas` 
      });
    }

    const walletClient = createWalletClient({
      account,
      chain: base,
      transport: http("https://mainnet.base.org"),
    });

    const swapData = await getSwapQuote(tokenAddress, amountIn.toString(), account.address);

    let hash: `0x${string}`;
    let swapType = 'aggregator';

    if (swapData) {
      // Use aggregator swap
      hash = await walletClient.sendTransaction({
        to: swapData.to as `0x${string}`,
        data: swapData.data as `0x${string}`,
        value: BigInt(swapData.value || amountIn.toString()),
      });
      swapType = swapData.type;
    } else {
      // No aggregator route found - try Clanker devbuy for Uniswap v4 tokens
      console.log("Trying Clanker devbuy for", tokenAddress);
      
      try {
        const buyData = encodeFunctionData({
          abi: DEVBUY_ABI,
          functionName: 'buy',
          args: [tokenAddress as `0x${string}`, account.address, BigInt(0)]
        });

        hash = await walletClient.sendTransaction({
          to: CLANKER_DEVBUY as `0x${string}`,
          data: buyData,
          value: amountIn,
        });
        swapType = 'clanker';
      } catch (devbuyError: any) {
        console.error("Clanker devbuy failed:", devbuyError);
        return res.status(400).json({ 
          error: "Token not tradeable via our API yet. Clanker v4 tokens use Uniswap v4 which most aggregators don't support yet. Try trading on clanker.world directly or wait for aggregator support.",
          clankerUrl: `https://clanker.world/clanker/${tokenAddress}`
        });
      }
    }

    await publicClient.waitForTransactionReceipt({ hash });

    // Get token info
    let symbol = "TOKEN";
    let decimals = 18;
    try {
      symbol = await publicClient.readContract({
        address: tokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "symbol"
      });
      decimals = await publicClient.readContract({
        address: tokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "decimals"
      });
    } catch (e) {}

    const tokenBalance = await publicClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account.address]
    });

    return res.json({
      success: true,
      transactionHash: hash,
      tokensReceived: formatUnits(tokenBalance, decimals),
      symbol,
      via: swapType
    });
  } catch (error: any) {
    console.error("Buy error:", error);
    if (error.message?.includes("insufficient funds")) {
      return res.status(400).json({ error: "Insufficient ETH for gas + swap" });
    }
    if (error.message?.includes("No swap route") || error.message?.includes("No route")) {
      return res.status(400).json({ error: "No liquidity found. Token might be too new or only on Uniswap v4." });
    }
    return res.status(500).json({ error: error.message || "Buy failed" });
  }
}
