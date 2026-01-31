import { createPublicClient, createWalletClient, http, parseEther, formatEther, formatUnits, encodeFunctionData } from "viem";
import { base } from "viem/chains";
import { getAccountFromEncryptedKey } from "./wallet-service";

const publicClient = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org"),
});

const WETH = "0x4200000000000000000000000000000000000006";
const ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"; // Native ETH placeholder

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

// Use Kyberswap aggregator API for Base
async function getSwapQuote(sellToken: string, buyToken: string, sellAmount: string, takerAddress: string) {
  const url = `https://aggregator-api.kyberswap.com/base/api/v1/routes?tokenIn=${sellToken}&tokenOut=${buyToken}&amountIn=${sellAmount}&saveGas=false&gasInclude=true`;
  
  console.log("Getting swap quote from Kyberswap:", url);
  
  const res = await fetch(url, {
    headers: { "Accept": "application/json" }
  });
  
  if (!res.ok) {
    const text = await res.text();
    console.error("Kyberswap route error:", text);
    throw new Error(`Failed to get swap route: ${res.status}`);
  }
  
  const routeData = await res.json();
  console.log("Route data:", JSON.stringify(routeData, null, 2));
  
  if (!routeData.data?.routeSummary) {
    throw new Error("No route found for this swap");
  }
  
  // Now build the swap transaction
  const buildUrl = `https://aggregator-api.kyberswap.com/base/api/v1/route/build`;
  const buildRes = await fetch(buildUrl, {
    method: "POST",
    headers: { 
      "Accept": "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      routeSummary: routeData.data.routeSummary,
      sender: takerAddress,
      recipient: takerAddress,
      slippageTolerance: 500, // 5%
    })
  });
  
  if (!buildRes.ok) {
    const text = await buildRes.text();
    console.error("Kyberswap build error:", text);
    throw new Error(`Failed to build swap: ${buildRes.status}`);
  }
  
  const buildData = await buildRes.json();
  console.log("Build data:", JSON.stringify(buildData, null, 2));
  
  return buildData.data;
}

export async function buyToken(encryptedPrivateKey: string, tokenAddress: string, amountEth: string) {
  try {
    const account = getAccountFromEncryptedKey(encryptedPrivateKey);
    
    const walletClient = createWalletClient({
      account,
      chain: base,
      transport: http("https://mainnet.base.org"),
    });

    const amountIn = parseEther(amountEth);
    
    console.log(`Buying token ${tokenAddress} with ${amountEth} ETH`);

    // Get swap quote from Kyberswap
    const swapData = await getSwapQuote(
      ETH_ADDRESS, // Native ETH
      tokenAddress,
      amountIn.toString(),
      account.address
    );

    // Execute the swap
    const hash = await walletClient.sendTransaction({
      to: swapData.routerAddress as `0x${string}`,
      data: swapData.data as `0x${string}`,
      value: amountIn,
    });

    console.log("Swap tx hash:", hash);

    // Wait for transaction
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    // Get token balance after
    const decimals = await publicClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "decimals"
    });

    const balance = await publicClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account.address]
    });

    return {
      success: true,
      transactionHash: hash,
      tokensReceived: formatUnits(balance, decimals)
    };
  } catch (error: any) {
    console.error("Buy error:", error);
    const msg = error.message || "";
    if (msg.includes("insufficient funds") || msg.includes("exceeds the balance")) {
      return { success: false, error: "Insufficient funds. Add more ETH to your wallet." };
    }
    if (msg.includes("No route found")) {
      return { success: false, error: "No liquidity found for this token yet. Try again later." };
    }
    return { success: false, error: `Buy failed: ${error.message || "Check token address"}` };
  }
}

export async function sellToken(encryptedPrivateKey: string, tokenAddress: string, amount: string) {
  try {
    const account = getAccountFromEncryptedKey(encryptedPrivateKey);
    
    const walletClient = createWalletClient({
      account,
      chain: base,
      transport: http("https://mainnet.base.org"),
    });

    // Get token decimals
    const decimals = await publicClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "decimals"
    });

    // Get current balance
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
      return { success: false, error: "No tokens to sell" };
    }

    console.log(`Selling ${amountToSell} tokens of ${tokenAddress}`);

    // Get swap quote from Kyberswap
    const swapData = await getSwapQuote(
      tokenAddress,
      ETH_ADDRESS, // Sell for native ETH
      amountToSell.toString(),
      account.address
    );

    // Approve router to spend tokens
    const approveHash = await walletClient.writeContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [swapData.routerAddress as `0x${string}`, amountToSell]
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });

    // Get ETH balance before
    const ethBefore = await publicClient.getBalance({ address: account.address });

    // Execute the swap
    const hash = await walletClient.sendTransaction({
      to: swapData.routerAddress as `0x${string}`,
      data: swapData.data as `0x${string}`,
      value: 0n,
    });

    console.log("Sell tx hash:", hash);

    await publicClient.waitForTransactionReceipt({ hash });

    // Get ETH balance after
    const ethAfter = await publicClient.getBalance({ address: account.address });
    const ethReceived = ethAfter - ethBefore;

    return {
      success: true,
      transactionHash: hash,
      ethReceived: formatEther(ethReceived > 0n ? ethReceived : 0n)
    };
  } catch (error: any) {
    console.error("Sell error:", error);
    const msg = error.message || "";
    if (msg.includes("insufficient funds") || msg.includes("exceeds the balance")) {
      return { success: false, error: "Insufficient funds for gas. Add ETH to your wallet." };
    }
    if (msg.includes("No tokens to sell")) {
      return { success: false, error: "No tokens to sell." };
    }
    if (msg.includes("No route found")) {
      return { success: false, error: "No liquidity found for this token yet." };
    }
    return { success: false, error: `Sell failed: ${error.message || "Check token address"}` };
  }
}

export async function unwrapWeth(encryptedPrivateKey: string, amount?: string) {
  try {
    const account = getAccountFromEncryptedKey(encryptedPrivateKey);
    
    const walletClient = createWalletClient({
      account,
      chain: base,
      transport: http("https://mainnet.base.org"),
    });

    // Get WETH balance
    const wethBalance = await publicClient.readContract({
      address: WETH as `0x${string}`,
      abi: WETH_ABI,
      functionName: "balanceOf",
      args: [account.address]
    });

    if (wethBalance === 0n) {
      return { success: false, error: "No WETH to unwrap" };
    }

    const amountToUnwrap = amount === "all" || !amount
      ? wethBalance
      : parseEther(amount);

    if (amountToUnwrap > wethBalance) {
      return { success: false, error: `Not enough WETH. You have ${formatEther(wethBalance)} WETH` };
    }

    // Unwrap WETH to ETH
    const hash = await walletClient.writeContract({
      address: WETH as `0x${string}`,
      abi: WETH_ABI,
      functionName: "withdraw",
      args: [amountToUnwrap]
    });

    await publicClient.waitForTransactionReceipt({ hash });

    return {
      success: true,
      transactionHash: hash,
      ethReceived: formatEther(amountToUnwrap)
    };
  } catch (error: any) {
    console.error("Unwrap error:", error);
    if (error.message?.includes("insufficient funds")) {
      return { success: false, error: "Insufficient gas. Add ETH to your wallet." };
    }
    return { success: false, error: "Unwrap failed. Try again." };
  }
}

export async function getWethBalance(walletAddress: string) {
  try {
    const balance = await publicClient.readContract({
      address: WETH as `0x${string}`,
      abi: WETH_ABI,
      functionName: "balanceOf",
      args: [walletAddress as `0x${string}`]
    });
    return formatEther(balance);
  } catch {
    return "0";
  }
}
