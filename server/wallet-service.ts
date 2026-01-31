import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, http, formatEther, parseEther } from "viem";
import { base } from "viem/chains";
import crypto from "crypto";

const ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY || "lobstr-default-key-change-me-32ch";

const publicClient = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org"),
});

export interface WalletInfo {
  address: string;
  balance: string;
  balanceWei: bigint;
}

export function generateWallet(): { address: string; privateKey: string; encryptedPrivateKey: string } {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const encryptedPrivateKey = encryptPrivateKey(privateKey);
  
  return {
    address: account.address,
    privateKey,
    encryptedPrivateKey,
  };
}

export function encryptPrivateKey(privateKey: string): string {
  const key = crypto.scryptSync(ENCRYPTION_KEY, "salt", 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(privateKey, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

export function decryptPrivateKey(encryptedPrivateKey: string): string {
  const key = crypto.scryptSync(ENCRYPTION_KEY, "salt", 32);
  const [ivHex, encrypted] = encryptedPrivateKey.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export async function getWalletBalance(address: string): Promise<WalletInfo> {
  try {
    const balance = await publicClient.getBalance({ address: address as `0x${string}` });
    return {
      address,
      balance: formatEther(balance),
      balanceWei: balance,
    };
  } catch (error) {
    console.error("Error getting wallet balance:", error);
    return {
      address,
      balance: "0",
      balanceWei: BigInt(0),
    };
  }
}

export async function transferEth(
  encryptedPrivateKey: string,
  toAddress: string,
  amountEth: string
): Promise<{ hash: string } | { error: string }> {
  try {
    const privateKey = decryptPrivateKey(encryptedPrivateKey);
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    
    const walletClient = createWalletClient({
      account,
      chain: base,
      transport: http("https://mainnet.base.org"),
    });

    const hash = await walletClient.sendTransaction({
      to: toAddress as `0x${string}`,
      value: parseEther(amountEth),
    });

    return { hash };
  } catch (error: any) {
    console.error("Error transferring ETH:", error);
    return { error: error.message || "Transfer failed" };
  }
}

export function getAccountFromEncryptedKey(encryptedPrivateKey: string) {
  const privateKey = decryptPrivateKey(encryptedPrivateKey);
  return privateKeyToAccount(privateKey as `0x${string}`);
}

export function getWalletClient(encryptedPrivateKey: string) {
  const account = getAccountFromEncryptedKey(encryptedPrivateKey);
  return createWalletClient({
    account,
    chain: base,
    transport: http("https://mainnet.base.org"),
  });
}

export { publicClient };
