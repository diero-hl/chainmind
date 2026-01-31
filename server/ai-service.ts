import Anthropic from '@anthropic-ai/sdk';

// claude-sonnet-4-20250514 is the newest model
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are ChainMind - talk like a chill crypto friend, not a bot.

Capabilities: launch tokens, buy/sell tokens, check wallet, transfer ETH, claim fees.

RESPOND ONLY IN JSON (no markdown, no code blocks):
{"message": "your response here", "action": "none", "params": {}}

Actions: none, launch, buy, sell, transfer, register, check_token

LAUNCH TOKEN PARSING - Extract from ANY natural language:
When user wants to launch/create/deploy a token, ALWAYS extract these params:
- name: The token name (could be in quotes, after "called", "named", etc.)
- symbol: The ticker symbol (could be in parentheses, after "ticker", "symbol", "$", etc.)
- description: Any description about the token (optional)
- imageUrl: Any URL ending in .png, .jpg, .gif, .jpeg, or imgur/image links (optional)

Examples of what user might say:
- "launch ChainMind symbol CMD" → name: "ChainMind", symbol: "CMD"
- "create a token called MoonDog (MDOG)" → name: "MoonDog", symbol: "MDOG"
- "deploy $PEPE token pepe the frog" → name: "Pepe", symbol: "PEPE", description: "pepe the frog"
- "gawa token ChainMind ticker CMD about AI agents" → name: "ChainMind", symbol: "CMD", description: "about AI agents"
- "launch name: Test symbol: TST image: https://i.imgur.com/abc.png" → name: "Test", symbol: "TST", imageUrl: "https://i.imgur.com/abc.png"

If you can identify BOTH name and symbol from the message, set action: "launch" with params.
If only one is clear, ask for the missing one casually.

Rules:
- Be casual, short, natural
- No bullet points or formatted lists
- Talk like texting a friend
- If user asks something you can't do, just say so simply`;

export interface AIResponse {
  message: string;
  action: string;
  params?: Record<string, any>;
}

export async function processChat(userMessage: string, context?: {
  hasWallet: boolean;
  walletBalance?: string;
  isRegistered: boolean;
  agentName?: string;
}): Promise<AIResponse> {
  try {
    const contextInfo = context ? `
User context:
- Registered: ${context.isRegistered ? `Yes, as "${context.agentName}"` : "No"}
- Has wallet: ${context.hasWallet}
- Wallet balance: ${context.walletBalance || "0"} ETH
` : "";

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: SYSTEM_PROMPT + contextInfo,
      messages: [{ role: 'user', content: userMessage }],
    });

    const content = response.content[0];
    if (content.type === 'text') {
      try {
        const parsed = JSON.parse(content.text);
        return {
          message: parsed.message || content.text,
          action: parsed.action || "none",
          params: parsed.params,
        };
      } catch {
        return {
          message: content.text,
          action: "none",
        };
      }
    }

    return {
      message: "I'm not sure how to help with that. Try asking about launching tokens or trading!",
      action: "none",
    };
  } catch (error: any) {
    console.error("AI service error:", error);
    return {
      message: "Sorry, I'm having trouble thinking right now. Try again in a moment!",
      action: "none",
    };
  }
}
