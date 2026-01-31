import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";

// Get session ID for API calls
function getSessionId(): string {
  const key = "chainmind_session_id";
  let sessionId = localStorage.getItem(key);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem(key, sessionId);
  }
  return sessionId;
}
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Send, Rocket, Wallet, ExternalLink, User, ChevronDown, ChevronUp, Coins, Menu, X, MessageSquare } from "lucide-react";
import mascotImage from "@/assets/images/lobstr-mascot.png";

interface WalletInfo {
  address: string;
  balance: string;
}

interface MoltbookAgent {
  id: string;
  name: string;
  description: string;
  apiKey: string;
  claimUrl?: string;
  verificationCode?: string;
  status: string;
  walletAddress?: string;
}

interface TokenLaunch {
  id: string;
  name: string;
  symbol: string;
  tokenAddress?: string;
  flaunchUrl?: string;
  explorerUrl?: string;
  walletAddress?: string;
  moltbookPostUrl?: string;
  status: string;
  createdAt?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  claimData?: {
    claimUrl: string;
    verificationCode: string;
  };
  tokenData?: {
    name: string;
    symbol: string;
    address: string;
    explorerUrl: string;
    clankerUrl: string;
  };
}

export default function Home() {
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [registerStep, setRegisterStep] = useState(1);
  const [registerName, setRegisterName] = useState("");
  const [registerApiKey, setRegisterApiKey] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "yo! i'm chainmind, your token launcher on base. just tell me what you wanna launch - like 'launch ChainMind symbol CMD' or whatever. let's get it",
    },
  ]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingLaunch, setPendingLaunch] = useState<{ 
    name: string; 
    symbol: string; 
    description?: string;
    imageUrl?: string;
  } | null>(null);
  const [showTokens, setShowTokens] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: agent } = useQuery<MoltbookAgent | null>({
    queryKey: ["/api/agent"],
  });

  const { data: wallet } = useQuery<WalletInfo>({
    queryKey: ["/api/wallet"],
    enabled: !!agent,
  });

  const { data: tokens } = useQuery<TokenLaunch[]>({
    queryKey: ["/api/tokens"],
  });

  const registerMutation = useMutation({
    mutationFn: async (data: { name: string; apiKey: string }) => {
      const res = await apiRequest("POST", "/api/agent/register", {
        name: data.name,
        apiKey: data.apiKey
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wallet"] });
    },
  });

  const launchMutation = useMutation({
    mutationFn: async (data: { name: string; symbol: string; description?: string; imageUrl?: string }) => {
      const res = await apiRequest("POST", "/api/tokens", data);
      return res.json();
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const addMessage = (role: "user" | "assistant", content: string, extras?: { tokenData?: ChatMessage["tokenData"]; claimData?: ChatMessage["claimData"] }) => {
    setMessages((prev) => [...prev, { id: Date.now().toString(), role, content, ...extras }]);
  };

  const processMessage = async (userMessage: string) => {
    const msg = userMessage.toLowerCase().trim();
    addMessage("user", userMessage);
    setIsProcessing(true);

    // Confirm pending launch
    if (pendingLaunch) {
      if (msg === "yes" || msg === "confirm" || msg === "go" || msg === "launch it" || msg === "do it") {
        if (!agent) {
          addMessage("assistant", "You need to register first! Say something like \"Register as CoolAgent\" to get started.");
          setPendingLaunch(null);
          setIsProcessing(false);
          return;
        }

        addMessage("assistant", `Deploying ${pendingLaunch.name} ($${pendingLaunch.symbol}) on Base...`);
        
        try {
          const result = await launchMutation.mutateAsync({
            name: pendingLaunch.name,
            symbol: pendingLaunch.symbol,
            description: pendingLaunch.description,
            imageUrl: pendingLaunch.imageUrl,
          });
          addMessage("assistant", 
            `🎉 Success! Your token is live!\n\n${pendingLaunch.name} ($${pendingLaunch.symbol})${result.postedToMoltbook ? "\n\n✅ Posted proof to Moltbook!" : ""}`,
            {
              tokenData: {
                name: pendingLaunch.name,
                symbol: pendingLaunch.symbol,
                address: result.tokenAddress,
                explorerUrl: result.explorerUrl,
                clankerUrl: result.clankerUrl,
              }
            }
          );
          queryClient.invalidateQueries({ queryKey: ["/api/tokens"] });
          toast({ title: "Token Launched!", description: `${pendingLaunch.name} deployed on Base` });
        } catch (error: any) {
          addMessage("assistant", `Launch failed: ${error.message || "Unknown error"}. Try again?`);
        }
        
        setPendingLaunch(null);
        setIsProcessing(false);
        return;
      }

      if (msg === "no" || msg === "cancel") {
        setPendingLaunch(null);
        addMessage("assistant", "Cancelled. Let me know when you're ready!");
        setIsProcessing(false);
        return;
      }
    }

    // Status check - calls API to auto-verify with Moltbook
    if (msg === "status" || msg === "check status" || msg === "verify" || msg.includes("am i verified")) {
      if (!agent) {
        addMessage("assistant", "You haven't registered yet. Say \"Register as YourName - description\" to get started!");
        setIsProcessing(false);
        return;
      }
      
      addMessage("assistant", "Checking your status with Moltbook...");
      
      try {
        const response = await fetch("/api/agent/status", {
          headers: { "X-Session-Id": getSessionId() },
        });
        const statusData = await response.json();
        
        // Refresh agent data
        queryClient.invalidateQueries({ queryKey: ["/api/agent"] });
        
        if (statusData.status === "active" || statusData.is_claimed) {
          addMessage("assistant", `nice! "${agent.name}" is verified and ready\n\nwallet: ${agent.walletAddress}\n\njust tell me what token to launch`);
        } else {
          addMessage("assistant", `Your agent "${agent.name}" is still PENDING.\n\nYou need to claim it on Moltbook first:`,
            agent.claimUrl ? { claimData: { claimUrl: agent.claimUrl, verificationCode: agent.verificationCode || "" } } : undefined
          );
        }
      } catch (error) {
        addMessage("assistant", `Could not check status. Your current status: ${agent.status}`);
      }
      
      setIsProcessing(false);
      return;
    }

    // Register with API key: "register MyName key moltbook_sk_xxx"
    const apiKeyMatch = userMessage.match(/register\s+(?:as\s+)?["']?([a-zA-Z0-9_-]+)["']?\s+(?:key|apikey|api-key)\s+(moltbook_sk_[a-zA-Z0-9]+)/i);
    if (apiKeyMatch) {
      const name = apiKeyMatch[1].trim();
      const apiKey = apiKeyMatch[2].trim();
      addMessage("assistant", `Linking ${name} with your Moltbook API key...`);
      try {
        const result = await registerMutation.mutateAsync({ name, apiKey });
        addMessage("assistant", `Done! Agent "${result.agent?.name}" linked!\n\nYour wallet: ${result.walletAddress}\n\nYou're ready to launch tokens! Just say:\n"Launch MyToken symbol MTK"`);
      } catch (error: any) {
        addMessage("assistant", `Failed: ${error.message}`);
      }
      setIsProcessing(false);
      return;
    }

    // Register intent without API key - show instructions
    if (msg.includes("register") || msg.includes("sign up") || msg.includes("create account")) {
      if (agent) {
        addMessage("assistant", `You're already registered as ${agent.name}! Want to launch a token?`);
        setIsProcessing(false);
        return;
      }

      addMessage("assistant", `To register, you need a Moltbook API key:\n\n1. Go to moltbook.com/register\n2. Create your agent there\n3. Copy your API key (starts with moltbook_sk_)\n4. Come back here and say:\n\n"Register YourAgentName key moltbook_sk_xxx"\n\nReplace YourAgentName with your agent name and xxx with your key!`);
      setIsProcessing(false);
      return;
    }

    // Wallet query
    if (msg.includes("wallet") || msg.includes("balance") || msg.includes("address")) {
      if (!agent) {
        addMessage("assistant", "You need to register first! Say \"Register as YourName\" to create your wallet.");
      } else if (wallet) {
        addMessage("assistant", `Your Wallet\n\nAddress: ${wallet.address}\nBalance: ${parseFloat(wallet.balance).toFixed(6)} ETH\nNetwork: Base Mainnet\n\nSend ETH here to fund operations. Clanker handles gas for token launches!`);
      } else {
        addMessage("assistant", "Loading wallet info...");
      }
      setIsProcessing(false);
      return;
    }

    // Withdraw/Transfer command - supports "max/all" or specific amount
    const withdrawMatch = userMessage.match(/(?:withdraw|transfer)\s+(max|all|[0-9.]+)\s*(?:eth)?\s+(?:to\s+)?(0x[a-fA-F0-9]{40})/i);
    if (withdrawMatch || msg.includes("withdraw") || msg.includes("transfer all")) {
      if (!agent) {
        addMessage("assistant", "You need to register first to have a wallet!");
        setIsProcessing(false);
        return;
      }
      
      if (withdrawMatch) {
        const rawAmount = withdrawMatch[1].toLowerCase();
        const amount = rawAmount === "all" ? "max" : rawAmount;
        const toAddress = withdrawMatch[2];
        
        addMessage("assistant", `Sending ${amount === "max" ? "all funds" : amount + " ETH"} to ${toAddress.toLowerCase()}...`);
        
        try {
          const res = await fetch("/api/wallet", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Session-Id": getSessionId() },
            body: JSON.stringify({ toAddress, amountEth: amount }),
          });
          const result = await res.json();
          
          if (result.error) {
            addMessage("assistant", `Transfer failed: ${result.error}`);
          } else if (result.success) {
            addMessage("assistant", `Sent ${amount === "max" ? "all" : amount} ETH to ${toAddress.toLowerCase()}\n\nTx: ${result.hash}`);
            queryClient.invalidateQueries({ queryKey: ["/api/wallet"] });
          } else {
            addMessage("assistant", `Transfer failed`);
          }
        } catch (error: any) {
          addMessage("assistant", `Transfer failed: ${error.message}`);
        }
      } else {
        addMessage("assistant", `To withdraw, use:\n\nWithdraw max to 0xYourAddress\nWithdraw 0.01 to 0xYourAddress\n\nBalance: ${wallet ? parseFloat(wallet.balance).toFixed(6) : "0"} ETH`);
      }
      setIsProcessing(false);
      return;
    }

    // Tokens query
    if (msg.includes("my tokens") || msg.includes("launched") || msg === "tokens" || msg.includes("list tokens")) {
      if (tokens && tokens.length > 0) {
        const list = tokens.map(t => `• ${t.name} ($${t.symbol}) - ${t.status}`).join("\n");
        addMessage("assistant", `Your tokens (${tokens.length}):\n\n${list}\n\nWant to launch another?`);
      } else {
        addMessage("assistant", "no tokens yet - tell me what you wanna launch");
      }
      setIsProcessing(false);
      return;
    }

    // Claim fees
    if (msg.includes("claim") && (msg.includes("fee") || msg.includes("reward"))) {
      if (!agent) {
        addMessage("assistant", "Register first to claim fees! Say \"Register as YourName\"");
        setIsProcessing(false);
        return;
      }
      if (!tokens || tokens.length === 0) {
        addMessage("assistant", "No tokens to claim fees from yet. Launch a token first!");
        setIsProcessing(false);
        return;
      }
      
      addMessage("assistant", "Checking your claimable fees...");
      try {
        // Check fees for all tokens
        const feeResults = await Promise.all(
          tokens!.filter(t => t.tokenAddress).map(async (t) => {
            const res = await fetch(`/api/fees?tokenAddress=${t.tokenAddress}`, {
              headers: { "X-Session-Id": getSessionId() },
            });
            const data = await res.json();
            return { symbol: t.symbol, address: t.tokenAddress, fees: data.claimableEth || "0" };
          })
        );
        const claimableTokens = feeResults.filter(t => parseFloat(t.fees) > 0);
        const totalFees = claimableTokens.reduce((sum, t) => sum + parseFloat(t.fees), 0).toFixed(6);
        
        if (totalFees === "0.000000" || claimableTokens.length === 0) {
          addMessage("assistant", "No fees to claim yet. Fees accumulate from trading activity on your tokens.");
        } else {
          addMessage("assistant", `Claimable fees:\n\n${claimableTokens.map((t: any) => `• ${t.symbol}: ${t.fees} ETH`).join("\n")}\n\nTotal: ${totalFees} ETH\n\nSay "Claim all fees" to collect!`);
        }
      } catch (error: any) {
        addMessage("assistant", `Error checking fees: ${error.message}`);
      }
      setIsProcessing(false);
      return;
    }

    // Help
    if (msg === "help" || msg === "?" || msg.includes("how does") || msg.includes("how do") || msg.includes("what can")) {
      addMessage("assistant", 
        `i can launch tokens, buy/sell, check your wallet, transfer funds, and claim trading fees. just ask naturally like "launch a coin called Moon" or "how much eth do i have" - no need for exact commands`
      );
      setIsProcessing(false);
      return;
    }

    // Launch intent - parse name and symbol from various formats
    // Format: "Launch [token name] ChainMind symbol CMD" or "Launch ChainMind (CMD)" etc
    if (msg.includes("launch") || msg.includes("create") || msg.includes("deploy") || msg.includes("mint")) {
      if (!agent) {
        addMessage("assistant", "You need to register first! Say \"Register as YourName\" to get started.");
        setIsProcessing(false);
        return;
      }

      let name = "";
      let symbol = "";
      let imageUrl = "";
      let description = "";
      
      // Extract image URL if present (from "image:" keyword or standalone URL)
      const imageKeyMatch = userMessage.match(/(?:image|img|logo|picture)[:\s]+["']?(https?:\/\/[^\s"']+)/i);
      if (imageKeyMatch) {
        imageUrl = imageKeyMatch[1];
      } else {
        const urlMatch = userMessage.match(/(https?:\/\/[^\s]+\.(png|jpg|jpeg|gif|webp))/i);
        if (urlMatch) {
          imageUrl = urlMatch[1];
        }
      }
      
      // Try pattern: "name: XXX" keyword
      const nameKeyMatch = userMessage.match(/name[:\s]+["']?([a-zA-Z0-9\s]+?)["']?\s+(?:symbol|ticker|smybol|\$|description|desc|image|img|$)/i);
      if (nameKeyMatch) {
        name = nameKeyMatch[1].trim();
      }
      
      // Try pattern: "symbol: XXX" or "ticker: XXX" keyword
      const symbolKeyMatch = userMessage.match(/(?:symbol|smybol|ticker)[:\s]+["']?([A-Z0-9]+)["']?/i);
      if (symbolKeyMatch) {
        symbol = symbolKeyMatch[1].toUpperCase();
      }
      
      // Try pattern: "description: XXX"
      const descMatch = userMessage.match(/(?:description|desc|about)[:\s]+["']?([^"']+?)["']?(?:\s+(?:image|symbol|ticker)|$)/i);
      if (descMatch) {
        description = descMatch[1].trim();
      }
      
      // Fallback: "... symbol XXX" or "... ticker XXX"
      if (!symbol) {
        const symbolMatch = userMessage.match(/(?:symbol|smybol|ticker)\s+["']?([A-Z0-9]+)["']?/i);
        if (symbolMatch) {
          symbol = symbolMatch[1].toUpperCase();
          if (!name) {
            const nameMatch = userMessage.match(/(?:launch|create|deploy|make|mint)\s+(?:my\s+)?(?:a\s+)?(?:token\s+)?(?:name\s+)?(?:called\s+)?(?:named?\s+)?["']?(.+?)["']?\s+(?:symbol|smybol|ticker)/i);
            if (nameMatch) {
              name = nameMatch[1].trim();
            }
          }
        }
      }
      
      // Try pattern: "Launch Name (SYMBOL)" or "Launch Name $SYMBOL"
      if (!symbol) {
        const parenMatch = userMessage.match(/(?:launch|create|deploy|make)\s+["']?(.+?)["']?\s*[\($]([A-Z0-9]+)[\)]?/i);
        if (parenMatch) {
          name = parenMatch[1].trim();
          symbol = parenMatch[2].toUpperCase();
        }
      }
      
      // Try pattern: "Launch Name with symbol SYMBOL"
      if (!symbol) {
        const withMatch = userMessage.match(/(?:launch|create|deploy|make)\s+(?:a\s+)?(?:token\s+)?(?:called\s+)?["']?(.+?)["']?\s+with\s+symbol\s+["']?([A-Z0-9]+)["']?/i);
        if (withMatch) {
          name = withMatch[1].trim();
          symbol = withMatch[2].toUpperCase();
        }
      }

      if (name && symbol) {
        // Clean up name - remove words like "token", "called", "named", URLs
        name = name.replace(/\b(token|called|named|name|my)\b/gi, "").replace(/https?:\/\/[^\s]+/g, "").trim();
        
        setPendingLaunch({ name, symbol, description: description || undefined, imageUrl: imageUrl || undefined });
        const logoText = imageUrl ? `\nlogo: included` : "";
        const descText = description ? `\nabout: ${description}` : "";
        addMessage("assistant", `ready to launch:\n\n${name} ($${symbol})${descText}${logoText}\nnetwork: base\ngas: ~$0.01-0.10 ETH\n\nsay "yes" to deploy or "no" to cancel`);
        setIsProcessing(false);
        return;
      } else {
        addMessage("assistant", "need both name and symbol - like \"launch MyCoin symbol MC\" or \"launch MyCoin (MC)\"");
        setIsProcessing(false);
        return;
      }
    }

    // Check token info - parse "check 0x..." or "info 0x..."
    const checkMatch = userMessage.match(/(?:check|info|mc|market\s*cap)\s+(?:the\s+)?(?:token\s+)?(0x[a-fA-F0-9]{40})/i);
    if (checkMatch) {
      const tokenAddress = checkMatch[1].toLowerCase();
      addMessage("assistant", `Looking up ${tokenAddress.slice(0, 8)}...`);
      
      try {
        // Try Clanker first
        const clankerRes = await fetch(`https://www.clanker.world/api/tokens/${tokenAddress}`);
        if (clankerRes.ok) {
          const token = await clankerRes.json();
          if (token && token.name) {
            const mcap = token.marketCap ? `$${Number(token.marketCap).toLocaleString()}` : "~$30k";
            addMessage("assistant", `${token.name} ($${token.symbol})\n\nMarket Cap: ${mcap}\nCreated: ${new Date(token.createdAt).toLocaleDateString()}\n\nhttps://clanker.world/clanker/${tokenAddress}`);
            setIsProcessing(false);
            return;
          }
        }
        
        // Fallback to DexScreener
        const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
        const data = await dexRes.json();
        
        if (data.pairs && data.pairs.length > 0) {
          const pair = data.pairs[0];
          const mcap = pair.marketCap ? `$${Number(pair.marketCap).toLocaleString()}` : "Unknown";
          const price = pair.priceUsd ? `$${Number(pair.priceUsd).toFixed(8)}` : "Unknown";
          const change24h = pair.priceChange?.h24 ? `${pair.priceChange.h24 > 0 ? '+' : ''}${pair.priceChange.h24.toFixed(2)}%` : "";
          addMessage("assistant", `${pair.baseToken.name} ($${pair.baseToken.symbol})\n\nPrice: ${price} ${change24h}\nMarket Cap: ${mcap}\nLiquidity: $${Number(pair.liquidity?.usd || 0).toLocaleString()}\n\nhttps://dexscreener.com/base/${tokenAddress}`);
        } else {
          addMessage("assistant", `No trading data yet.\n\nhttps://basescan.org/token/${tokenAddress}`);
        }
      } catch {
        addMessage("assistant", `Couldn't fetch data.\nhttps://dexscreener.com/base/${tokenAddress}`);
      }
      setIsProcessing(false);
      return;
    }

    // Buy token - parse "buy 0.0001 ETH of 0x..." or "buy 0x..."
    const buyMatch = userMessage.match(/buy\s+(?:([\d.]+)\s*(?:eth|ETH)\s+(?:of|worth)?\s*)?(0x[a-fA-F0-9]{40})/i);
    if (buyMatch || msg.includes("buy")) {
      if (!agent) {
        addMessage("assistant", "Register first to buy tokens! Say \"Register as YourName\"");
        setIsProcessing(false);
        return;
      }
      
      if (buyMatch) {
        const amount = buyMatch[1] || "0.01";
        const tokenAddress = buyMatch[2].toLowerCase();
        addMessage("assistant", `Buying ${amount} ETH worth of ${tokenAddress}...`);
        
        try {
          const res = await fetch("/api/trade/buy", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Session-Id": getSessionId() },
            body: JSON.stringify({ tokenAddress, amountEth: amount }),
          });
          const result = await res.json();
          
          if (result.error) {
            addMessage("assistant", `Buy failed: ${result.error}`);
          } else {
            addMessage("assistant", `Bought ${result.tokensReceived} tokens!\n\nTx: ${result.transactionHash}`);
          }
        } catch (error: any) {
          addMessage("assistant", `Error: ${error.message}`);
        }
      } else {
        addMessage("assistant", "To buy tokens, paste the contract address:\n\nExample: Buy 0.01 ETH of 0xTokenAddress\n\nOr just: Buy 0xTokenAddress (uses 0.01 ETH)");
      }
      setIsProcessing(false);
      return;
    }

    // Sell token - parse "sell 100 0x..." or "sell all 0x..."
    const sellMatch = userMessage.match(/sell\s+(?:(all|\d+\.?\d*)\s+)?(0x[a-fA-F0-9]{40})/i);
    if (sellMatch || msg.includes("sell")) {
      if (!agent) {
        addMessage("assistant", "Register first to sell tokens! Say \"Register as YourName\"");
        setIsProcessing(false);
        return;
      }
      
      if (sellMatch) {
        const amount = sellMatch[1] || "all";
        const tokenAddress = sellMatch[2].toLowerCase();
        addMessage("assistant", `Selling ${amount} of ${tokenAddress}...`);
        
        try {
          const res = await fetch("/api/trade/sell", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Session-Id": getSessionId() },
            body: JSON.stringify({ tokenAddress, amount }),
          });
          const result = await res.json();
          
          if (result.error) {
            addMessage("assistant", `Sell failed: ${result.error}`);
          } else {
            addMessage("assistant", `Sold for ${result.ethReceived} ETH!\n\nTx: ${result.transactionHash}`);
            queryClient.invalidateQueries({ queryKey: ["/api/wallet"] });
          }
        } catch (error: any) {
          addMessage("assistant", `Error: ${error.message}`);
        }
      } else {
        addMessage("assistant", "To sell tokens, paste the contract address:\n\nExample: Sell all 0xTokenAddress\n\nOr: Sell 1000 0xTokenAddress");
      }
      setIsProcessing(false);
      return;
    }

    // Unwrap WETH to ETH
    if (msg.includes("unwrap") || (msg.includes("weth") && (msg.includes("eth") || msg.includes("convert")))) {
      if (!agent) {
        addMessage("assistant", "Register first! Say \"Register as YourName\"");
        setIsProcessing(false);
        return;
      }
      
      addMessage("assistant", "Unwrapping your WETH to ETH...");
      
      try {
        const res = await fetch("/api/trade/unwrap", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Session-Id": getSessionId() },
          body: JSON.stringify({ amount: "all" }),
        });
        const result = await res.json();
        
        if (result.error) {
          addMessage("assistant", `Unwrap failed: ${result.error}`);
        } else {
          addMessage("assistant", `Done! Unwrapped ${result.ethReceived} WETH to ETH`);
          queryClient.invalidateQueries({ queryKey: ["/api/wallet"] });
        }
      } catch (error: any) {
        addMessage("assistant", `Error: ${error.message}`);
      }
      setIsProcessing(false);
      return;
    }

    // Recovery command with API key
    const recoverMatch = userMessage.match(/recover\s+(?:with\s+)?(?:api\s*key\s+)?([a-zA-Z0-9_-]{20,})/i);
    if (recoverMatch) {
      const apiKey = recoverMatch[1];
      addMessage("assistant", "Recovering your agent...");
      
      try {
        const res = await fetch("/api/agent/recover", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Session-Id": getSessionId() },
          body: JSON.stringify({ apiKey }),
        });
        const result = await res.json();
        
        if (result.error) {
          addMessage("assistant", `Recovery failed: ${result.error}`);
        } else {
          queryClient.invalidateQueries({ queryKey: ["/api/agent"] });
          queryClient.invalidateQueries({ queryKey: ["/api/wallet"] });
          addMessage("assistant", `Welcome back, ${result.agent.name}!\n\nYour wallet has been recovered. Check "wallet" to see your balance.`);
        }
      } catch (error: any) {
        addMessage("assistant", `Recovery failed: ${error.message}`);
      }
      setIsProcessing(false);
      return;
    }
    
    // Recovery help
    if (msg.includes("recover") || msg.includes("import") || msg.includes("login")) {
      addMessage("assistant", "To recover your wallet on a new device:\n\nSay: Recover YOUR_API_KEY\n\nYour API key was shown after registration. If you lost it, check your Moltbook agent settings.");
      setIsProcessing(false);
      return;
    }

    // AI Fallback - use Claude for natural conversation
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Session-Id": getSessionId() },
        body: JSON.stringify({ message: userMessage }),
      });
      const aiResponse = await res.json();
      
      if (aiResponse.error) {
        addMessage("assistant", "hmm something went wrong. try again - like 'launch ChainMind symbol CMD'");
      } else {
        addMessage("assistant", aiResponse.message);
        
        // Handle AI-detected actions
        if (aiResponse.action === "launch" && aiResponse.params) {
          const { name, symbol, description, imageUrl } = aiResponse.params;
          if (name && symbol) {
            setPendingLaunch({ name, symbol, description, imageUrl });
          }
        }
      }
    } catch {
      addMessage("assistant", "something went wrong. try again - like 'launch ChainMind symbol CMD'");
    }
    setIsProcessing(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;
    processMessage(input);
    setInput("");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-background sticky top-0 z-50">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src={mascotImage} alt="ChainMind" className="w-8 h-8 rounded-full" />
            <span className="font-bold text-primary text-lg">ChainMind</span>
            <Badge variant="secondary" className="text-xs">beta</Badge>
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setMenuOpen(!menuOpen)}
            data-testid="button-menu"
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </Button>
        </div>
        
        {menuOpen && (
          <div className="border-t bg-background">
            <div className="max-w-2xl mx-auto px-4 py-3 space-y-2">
              <a href="/" className="flex items-center gap-3 p-2 rounded-lg hover-elevate" onClick={() => setMenuOpen(false)}>
                <Coins className="w-4 h-4" />
                <span>All Tokens</span>
              </a>
              <a href="/chat" className="flex items-center gap-3 p-2 rounded-lg hover-elevate" onClick={() => setMenuOpen(false)}>
                <MessageSquare className="w-4 h-4" />
                <span>Launch Token</span>
              </a>
              {agent ? (
                <div className="flex items-center gap-3 p-2 text-muted-foreground">
                  <User className="w-4 h-4" />
                  <span>{agent.name}</span>
                </div>
              ) : (
                <button 
                  className="flex items-center gap-3 p-2 rounded-lg hover-elevate w-full text-left text-primary"
                  onClick={() => { setShowRegisterModal(true); setMenuOpen(false); }}
                  data-testid="button-register"
                >
                  <User className="w-4 h-4" />
                  <span>Create AI Agent</span>
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full flex flex-col">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              data-testid={`message-${msg.id}`}
            >
              {msg.role === "assistant" && (
                <img src={mascotImage} alt="ChainMind" className="w-8 h-8 flex-shrink-0 rounded-full" />
              )}
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                }`}
              >
                <div className="text-sm whitespace-pre-wrap break-words">{msg.content}</div>
                {msg.claimData && (
                  <div className="mt-3 p-3 bg-background/50 rounded-lg space-y-2">
                    <div className="text-xs text-muted-foreground">
                      Code: {msg.claimData.verificationCode}
                    </div>
                    <a href={msg.claimData.claimUrl} target="_blank" rel="noopener noreferrer">
                      <Button variant="default" size="sm" className="w-full">
                        <ExternalLink className="w-3 h-3 mr-2" />
                        Claim on Moltbook
                      </Button>
                    </a>
                  </div>
                )}
                {msg.tokenData && (
                  <div className="mt-3 p-3 bg-background/50 rounded-lg space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground break-all">
                        {msg.tokenData.address.toLowerCase()}
                      </span>
                      <span className="px-1.5 py-0.5 text-[10px] font-medium bg-primary/20 text-primary rounded">
                        Clanker
                      </span>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <a href={msg.tokenData.explorerUrl} target="_blank" rel="noopener noreferrer">
                        <Button variant="outline" size="sm">
                          <ExternalLink className="w-3 h-3 mr-1" />
                          BaseScan
                        </Button>
                      </a>
                      <a href={msg.tokenData.clankerUrl} target="_blank" rel="noopener noreferrer">
                        <Button variant="outline" size="sm">
                          <ExternalLink className="w-3 h-3 mr-1" />
                          Trade
                        </Button>
                      </a>
                    </div>
                  </div>
                )}
              </div>
              {msg.role === "user" && (
                <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          ))}
          {isProcessing && (
            <div className="flex gap-3">
              <img src={mascotImage} alt="ChainMind" className="w-8 h-8 rounded-full" />
              <div className="bg-muted rounded-2xl px-4 py-3">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="border-t bg-background p-4">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={pendingLaunch ? "Type 'yes' to confirm..." : "Tell me what token to launch..."}
              disabled={isProcessing}
              className="flex-1"
              data-testid="input-message"
            />
            <Button type="submit" disabled={isProcessing || !input.trim()} data-testid="button-send">
              <Send className="w-4 h-4" />
            </Button>
          </form>
          <div className="text-center text-xs text-muted-foreground mt-3">
            built with <a href="https://x.com/diero_hl" target="_blank" rel="noopener noreferrer" className="hover:text-foreground">@diero_hl</a>
          </div>
        </div>
      </main>

      {showRegisterModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowRegisterModal(false)}>
          <div className="bg-background border rounded-xl max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Create AI Agent</h2>
              <Button variant="ghost" size="icon" onClick={() => setShowRegisterModal(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="space-y-4">
              <Input
                placeholder="Agent name (e.g., MoonBot)"
                value={registerName}
                onChange={(e) => setRegisterName(e.target.value)}
                data-testid="input-register-name"
              />
              <Input
                placeholder="Description (optional)"
                value={registerApiKey}
                onChange={(e) => setRegisterApiKey(e.target.value)}
                data-testid="input-description"
              />
              <Button 
                className="w-full"
                disabled={!registerName.trim() || registerStep === 2}
                onClick={async () => {
                  if (!registerName.trim()) {
                    toast({ title: "Enter a name", variant: "destructive" });
                    return;
                  }
                  setRegisterStep(2);
                  try {
                    const moltRes = await fetch("https://www.moltbook.com/api/v1/agents/register", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ 
                        name: registerName, 
                        description: registerApiKey || `ChainMind agent: ${registerName}` 
                      })
                    });
                    const moltData = await moltRes.json();
                    if (!moltData.success || !moltData.agent) {
                      throw new Error(moltData.error || moltData.hint || "Moltbook registration failed");
                    }
                    const res = await fetch("/api/agent/register", {
                      method: "POST",
                      headers: { "Content-Type": "application/json", "X-Session-Id": getSessionId() },
                      body: JSON.stringify({ 
                        name: registerName,
                        description: registerApiKey || `ChainMind agent: ${registerName}`,
                        apiKey: moltData.agent.api_key,
                        claimUrl: moltData.agent.claim_url,
                        verificationCode: moltData.agent.verification_code
                      })
                    });
                    const result = await res.json();
                    if (result.error) throw new Error(result.error);
                    queryClient.invalidateQueries({ queryKey: ["/api/agent"] });
                    queryClient.invalidateQueries({ queryKey: ["/api/wallet"] });
                    setShowRegisterModal(false);
                    setRegisterStep(1);
                    setRegisterName("");
                    setRegisterApiKey("");
                    // Show success in chat with claim link
                    setMessages(prev => [...prev, {
                      id: Date.now().toString(),
                      role: "assistant",
                      content: `Agent "${registerName}" created!\n\nWallet: ${result.walletAddress}\n\nAPI Key (save this!):\n${moltData.agent.api_key}\n\nClick below to claim your agent on Moltbook:`,
                      claimData: { claimUrl: moltData.agent.claim_url, verificationCode: moltData.agent.verification_code }
                    }]);
                  } catch (error: any) {
                    toast({ title: "Failed", description: error.message, variant: "destructive" });
                    setRegisterStep(1);
                  }
                }}
                data-testid="button-create-agent"
              >
                {registerStep === 2 ? (
                  <><span className="animate-pulse mr-2">Creating on Moltbook...</span> (takes ~30s)</>
                ) : (
                  <>Create Agent</>
                )}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                This may take 30+ seconds. Please wait.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
