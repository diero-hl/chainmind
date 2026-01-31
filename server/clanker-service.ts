import { Clanker } from "clanker-sdk/v4";
import { createPublicClient, createWalletClient, http } from "viem";
import { base } from "viem/chains";
import { getAccountFromEncryptedKey } from "./wallet-service";

const publicClient = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org"),
});

export interface TokenLaunchParams {
  name: string;
  symbol: string;
  description?: string;
  imageUrl?: string;
  encryptedPrivateKey: string;
}

export interface TokenLaunchResult {
  success: boolean;
  tokenAddress?: string;
  transactionHash?: string;
  clankerUrl?: string;
  explorerUrl?: string;
  error?: string;
}

export async function launchToken(params: TokenLaunchParams): Promise<TokenLaunchResult> {
  try {
    const account = getAccountFromEncryptedKey(params.encryptedPrivateKey);
    
    const walletClient = createWalletClient({
      account,
      chain: base,
      transport: http("https://mainnet.base.org"),
    });

    const clanker = new Clanker({
      publicClient: publicClient as any,
      wallet: walletClient as any,
    });

    const tokenConfig: any = {
      name: params.name,
      symbol: params.symbol,
      tokenAdmin: account.address,
    };

    if (params.imageUrl) {
      tokenConfig.image = params.imageUrl;
    }

    if (params.description) {
      tokenConfig.metadata = {
        description: params.description,
        socialMediaUrls: [],
        auditUrls: [],
      };
    }

    tokenConfig.context = {
      interface: "ChainMind",
      platform: "chainmind",
    };

    // Standard positions from Clanker SDK (single LP position, ~$27k to ~$1.5B range)
    tokenConfig.pool = {
      positions: [
        {
          tickLower: -230400,
          tickUpper: -120000,
          positionBps: 10000
        }
      ]
    };

    const { txHash, waitForTransaction, error } = await clanker.deploy(tokenConfig);

    if (error) {
      return {
        success: false,
        error: error.message || "Deployment failed",
      };
    }

    const { address } = await waitForTransaction();

    return {
      success: true,
      tokenAddress: address,
      transactionHash: txHash,
      clankerUrl: `https://clanker.world/clanker/${address}`,
      explorerUrl: `https://basescan.org/token/${address}`,
    };
  } catch (error: any) {
    console.error("Error launching token:", error);
    return {
      success: false,
      error: error.message || "Token launch failed",
    };
  }
}

export async function getTokenInfo(tokenAddress: string) {
  try {
    const response = await fetch(`https://www.clanker.world/api/tokens/${tokenAddress}`);
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching token info:", error);
    return null;
  }
}

// Fee locker contract for Clanker v4
const FEE_LOCKER_ADDRESS = "0x1d5A0F0BD3eA07F78FC14577f053de7A3FEc35B2";
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006"; // Base WETH

const FEE_LOCKER_ABI = [
  {
    inputs: [
      { name: "feeOwner", type: "address" },
      { name: "token", type: "address" }
    ],
    name: "feesToClaim",
    outputs: [{ name: "balance", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { name: "feeOwner", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    name: "claim",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
] as const;

export async function getClaimableFees(walletAddress: string, tokenAddresses: string[]) {
  try {
    const results = [];
    
    for (const tokenAddress of tokenAddresses) {
      // Check WETH fees for this token
      const fees = await publicClient.readContract({
        address: FEE_LOCKER_ADDRESS as `0x${string}`,
        abi: FEE_LOCKER_ABI,
        functionName: "feesToClaim",
        args: [walletAddress as `0x${string}`, WETH_ADDRESS as `0x${string}`]
      });
      
      if (fees > 0n) {
        results.push({
          tokenAddress,
          fees: fees.toString(),
          feesEth: (Number(fees) / 1e18).toFixed(6)
        });
      }
    }
    
    const totalFees = results.reduce((sum, r) => sum + BigInt(r.fees), 0n);
    
    return {
      claimableTokens: results,
      totalFees: (Number(totalFees) / 1e18).toFixed(6)
    };
  } catch (error) {
    console.error("Error getting claimable fees:", error);
    return { claimableTokens: [], totalFees: "0" };
  }
}

export async function claimFees(encryptedPrivateKey: string) {
  try {
    const account = getAccountFromEncryptedKey(encryptedPrivateKey);
    
    const walletClient = createWalletClient({
      account,
      chain: base,
      transport: http("https://mainnet.base.org"),
    });

    // Check claimable WETH
    const fees = await publicClient.readContract({
      address: FEE_LOCKER_ADDRESS as `0x${string}`,
      abi: FEE_LOCKER_ABI,
      functionName: "feesToClaim",
      args: [account.address as `0x${string}`, WETH_ADDRESS as `0x${string}`]
    });

    if (fees === 0n) {
      return { success: false, error: "No fees to claim" };
    }

    // Claim all WETH fees
    const hash = await walletClient.writeContract({
      address: FEE_LOCKER_ADDRESS as `0x${string}`,
      abi: FEE_LOCKER_ABI,
      functionName: "claim",
      args: [account.address as `0x${string}`, WETH_ADDRESS as `0x${string}`, fees]
    });

    return {
      success: true,
      transactionHash: hash,
      amountClaimed: (Number(fees) / 1e18).toFixed(6)
    };
  } catch (error: any) {
    console.error("Error claiming fees:", error);
    return { success: false, error: error.message || "Failed to claim fees" };
  }
}
