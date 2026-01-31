import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Menu, X, MessageSquare, Coins } from "lucide-react";
import mascotImage from "@/assets/images/lobstr-mascot.png";

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

export default function Tokens() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { data: tokens, isLoading } = useQuery<TokenLaunch[]>({
    queryKey: ["/api/tokens"],
  });

  const launchedTokens = tokens?.filter(t => t.status === "launched") || [];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={mascotImage} alt="ChainMind" className="w-8 h-8 rounded-full" />
            <span className="font-bold text-xl">ChainMind</span>
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
            <div className="max-w-4xl mx-auto px-4 py-3 space-y-2">
              <a href="/" className="flex items-center gap-3 p-2 rounded-lg hover-elevate" onClick={() => setMenuOpen(false)}>
                <Coins className="w-4 h-4" />
                <span>All Tokens</span>
              </a>
              <a href="/chat" className="flex items-center gap-3 p-2 rounded-lg hover-elevate" onClick={() => setMenuOpen(false)}>
                <MessageSquare className="w-4 h-4" />
                <span>Launch Token</span>
              </a>
            </div>
          </div>
        )}
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-2">Launched Tokens</h1>
          <p className="text-muted-foreground">All tokens deployed via ChainMind on Base (Clanker)</p>
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading tokens...</div>
        ) : launchedTokens.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            No tokens launched yet. Be the first!
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {launchedTokens.map((token) => (
              <div
                key={token.id}
                className="p-4 bg-muted rounded-lg space-y-3"
                data-testid={`public-token-${token.id}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-lg">{token.name} (${token.symbol})</span>
                  <Badge variant="secondary" className="text-[10px]">Clanker</Badge>
                </div>
                
                {token.tokenAddress && (
                  <div className="text-xs font-mono text-muted-foreground break-all bg-background/50 p-2 rounded">
                    {token.tokenAddress.toLowerCase()}
                  </div>
                )}
                
                {token.walletAddress && (
                  <div className="text-xs text-muted-foreground">
                    Deployer: {token.walletAddress.toLowerCase().slice(0, 10)}...{token.walletAddress.toLowerCase().slice(-8)}
                  </div>
                )}

                {token.createdAt && (
                  <div className="text-xs text-muted-foreground">
                    {new Date(token.createdAt).toLocaleDateString()}
                  </div>
                )}
                
                <div className="flex gap-2 flex-wrap pt-2">
                  {token.explorerUrl && (
                    <a href={token.explorerUrl} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="sm">
                        <ExternalLink className="w-3 h-3 mr-1" />
                        BaseScan
                      </Button>
                    </a>
                  )}
                  {token.flaunchUrl && (
                    <a href={token.flaunchUrl} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="sm">
                        <ExternalLink className="w-3 h-3 mr-1" />
                        Trade
                      </Button>
                    </a>
                  )}
                  {token.moltbookPostUrl && (
                    <a href={token.moltbookPostUrl} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="sm">
                        <ExternalLink className="w-3 h-3 mr-1" />
                        Moltbook
                      </Button>
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
