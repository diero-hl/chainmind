import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { ArrowLeft, Send, Rocket, Wallet, ExternalLink, Bot, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface WalletInfo {
  address: string;
  balance: string;
}

interface TokenLaunch {
  id: string;
  name: string;
  symbol: string;
  description?: string;
  tokenAddress?: string;
  flaunchUrl?: string;
  explorerUrl?: string;
  status: string;
  createdAt: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  tokenData?: {
    name: string;
    symbol: string;
    address: string;
    explorerUrl: string;
    clankerUrl: string;
  };
}

export default function Launch() {
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Hey! I'm your token launch assistant. I can help you deploy tokens on Base chain via Clanker - no gas fees required!\n\nJust tell me what token you want to create. For example:\n• \"Launch a token called Lobstr Coin with symbol LOBSTR\"\n• \"Create MEME token\"\n• \"Deploy a community token for my AI agent\"\n\nOr ask me about your wallet, launched tokens, or how this works!",
    },
  ]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingLaunch, setPendingLaunch] = useState<{ name: string; symbol: string; description?: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: wallet } = useQuery<WalletInfo>({
    queryKey: ["/api/wallet"],
  });

  const { data: tokens } = useQuery<TokenLaunch[]>({
    queryKey: ["/api/tokens"],
  });

  const launchMutation = useMutation({
    mutationFn: async (data: { name: string; symbol: string; description?: string }) => {
      return await apiRequest("/api/tokens/launch", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const addMessage = (role: "user" | "assistant", content: string, tokenData?: ChatMessage["tokenData"]) => {
    setMessages((prev) => [
      ...prev,
      { id: Date.now().toString(), role, content, tokenData },
    ]);
  };

  const processMessage = async (userMessage: string) => {
    const msg = userMessage.toLowerCase().trim();
    addMessage("user", userMessage);
    setIsProcessing(true);

    // Check for confirmation of pending launch
    if (pendingLaunch && (msg === "yes" || msg === "confirm" || msg === "go" || msg === "launch it" || msg === "do it")) {
      addMessage("assistant", `Launching ${pendingLaunch.name} ($${pendingLaunch.symbol}) on Base... This may take a moment.`);
      
      try {
        const result = await launchMutation.mutateAsync(pendingLaunch);
        
        addMessage("assistant", 
          `🎉 **Token launched successfully!**\n\nYour token **${pendingLaunch.name}** ($${pendingLaunch.symbol}) is now live on Base chain!${result.postedToMoltbook ? "\n\n✅ Proof posted to Moltbook!" : ""}`,
          {
            name: pendingLaunch.name,
            symbol: pendingLaunch.symbol,
            address: result.tokenAddress,
            explorerUrl: result.explorerUrl,
            clankerUrl: result.clankerUrl,
          }
        );
        
        queryClient.invalidateQueries({ queryKey: ["/api/tokens"] });
        queryClient.invalidateQueries({ queryKey: ["/api/wallet"] });
        
        toast({
          title: "Token Launched!",
          description: `${pendingLaunch.name} deployed on Base`,
        });
      } catch (error: any) {
        addMessage("assistant", `Sorry, the launch failed: ${error.message || "Unknown error"}. Please try again or check your wallet balance.`);
      }
      
      setPendingLaunch(null);
      setIsProcessing(false);
      return;
    }

    // Cancel pending launch
    if (pendingLaunch && (msg === "no" || msg === "cancel" || msg === "nevermind")) {
      setPendingLaunch(null);
      addMessage("assistant", "No problem! Let me know when you're ready to launch a token.");
      setIsProcessing(false);
      return;
    }

    // Check for wallet query
    if (msg.includes("wallet") || msg.includes("balance") || msg.includes("address")) {
      if (wallet) {
        addMessage("assistant", 
          `Here's your wallet info:\n\n**Address:** \`${wallet.address}\`\n**Balance:** ${parseFloat(wallet.balance).toFixed(6)} ETH\n**Network:** Base Mainnet\n\nYou can send ETH to this address to fund token launches. Clanker handles gas, but you earn creator fees!`
        );
      } else {
        addMessage("assistant", "You don't have a wallet yet. Register an agent on the home page first, and I'll create a wallet for you automatically!");
      }
      setIsProcessing(false);
      return;
    }

    // Check for tokens query
    if (msg.includes("my tokens") || msg.includes("launched tokens") || msg.includes("list tokens") || msg === "tokens") {
      if (tokens && tokens.length > 0) {
        const tokenList = tokens.map((t) => `• **${t.name}** ($${t.symbol}) - ${t.status}`).join("\n");
        addMessage("assistant", `You've launched ${tokens.length} token(s):\n\n${tokenList}\n\nNice work! Want to launch another?`);
      } else {
        addMessage("assistant", "You haven't launched any tokens yet. Tell me about the token you want to create!");
      }
      setIsProcessing(false);
      return;
    }

    // Check for help
    if (msg === "help" || msg === "?" || msg.includes("how does") || msg.includes("how do")) {
      addMessage("assistant", 
        `Here's how I can help:\n\n**Launch a token** - Just describe what you want! Like "Create a token called MoonCat with symbol MCAT"\n\n**Check wallet** - Ask "What's my wallet address?" or "Show balance"\n\n**View tokens** - Ask "Show my tokens" or "What have I launched?"\n\n**How it works:**\n1. You tell me the token name and symbol\n2. I deploy it on Base chain via Clanker\n3. No gas fees - Clanker handles deployment\n4. You earn 80% of trading fees as creator!\n5. Proof is auto-posted to Moltbook`
      );
      setIsProcessing(false);
      return;
    }

    // Try to parse token launch intent
    const launchPatterns = [
      /(?:launch|create|deploy|make|mint)\s+(?:a\s+)?(?:token\s+)?(?:called\s+)?["']?([^"']+?)["']?\s+(?:with\s+)?(?:symbol\s+)?["']?([A-Z0-9]+)["']?/i,
      /(?:launch|create|deploy|make)\s+["']?([^"']+?)["']?\s+\(?\$?([A-Z0-9]+)\)?/i,
      /(?:launch|create|deploy|make)\s+\$?([A-Z0-9]+)\s+(?:token|coin)?/i,
    ];

    for (const pattern of launchPatterns) {
      const match = userMessage.match(pattern);
      if (match) {
        let name = match[1]?.trim() || match[2]?.trim();
        let symbol = match[2]?.trim().toUpperCase() || match[1]?.trim().toUpperCase();
        
        // Clean up name if it's just the symbol
        if (name.toUpperCase() === symbol) {
          name = `${symbol} Token`;
        }

        setPendingLaunch({ name, symbol });
        addMessage("assistant", 
          `Ready to launch!\n\n**Token Name:** ${name}\n**Symbol:** $${symbol}\n**Network:** Base\n**Deployer:** Clanker (gasless)\n\nType **"yes"** to confirm and deploy, or **"no"** to cancel.`
        );
        setIsProcessing(false);
        return;
      }
    }

    // Generic fallback
    addMessage("assistant", 
      "I'd love to help! Try telling me:\n\n• \"Launch a token called [Name] with symbol [SYMBOL]\"\n• \"What's my wallet balance?\"\n• \"Show my launched tokens\"\n• \"How does this work?\"\n\nOr just describe the token you want to create!"
    );
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
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon" data-testid="button-back">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <Rocket className="w-5 h-5 text-primary" />
              <span className="font-semibold">Token Launcher</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {wallet && (
              <Badge variant="outline" className="text-xs font-mono">
                <Wallet className="w-3 h-3 mr-1" />
                {parseFloat(wallet.balance).toFixed(4)} ETH
              </Badge>
            )}
            <Badge variant="secondary">Base</Badge>
          </div>
        </div>
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
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                }`}
              >
                <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                {msg.tokenData && (
                  <div className="mt-3 p-3 bg-background/50 rounded-lg space-y-2">
                    <div className="text-xs font-mono text-muted-foreground">
                      {msg.tokenData.address}
                    </div>
                    <div className="flex gap-2">
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
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                <Bot className="w-4 h-4 text-primary" />
              </div>
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
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={pendingLaunch ? "Type 'yes' to confirm or 'no' to cancel..." : "Tell me about the token you want to launch..."}
              disabled={isProcessing}
              className="flex-1"
              data-testid="input-message"
            />
            <Button type="submit" disabled={isProcessing || !input.trim()} data-testid="button-send">
              <Send className="w-4 h-4" />
            </Button>
          </form>
          <p className="text-xs text-muted-foreground text-center mt-2">
            Powered by Clanker on Base. No gas fees required.
          </p>
        </div>
      </main>
    </div>
  );
}
