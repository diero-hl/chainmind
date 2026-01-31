// Signal parser for extracting trading signals from Moltbook posts

export interface TradingSignal {
  action: "buy" | "sell";
  token: string;
  amount?: string;
  tp?: string;
  sl?: string;
  confidence: number;
  source: {
    postId: string;
    title: string;
    author: string;
    upvotes: number;
  };
}

// Known crypto tokens - common ones that are often mentioned
const KNOWN_TOKENS = new Set([
  "BTC", "ETH", "SOL", "DOGE", "XRP", "ADA", "AVAX", "DOT", "MATIC", "LINK",
  "UNI", "AAVE", "ATOM", "FTM", "NEAR", "APT", "ARB", "OP", "SUI", "SEI",
  "BONK", "PEPE", "SHIB", "WIF", "FLOKI", "MEME", "BOME", "SLERF", "POPCAT",
  "JUP", "PYTH", "JTO", "TIA", "INJ", "RENDER", "FET", "TAO", "WLD", "ARKM",
  "ONDO", "ENA", "ETHFI", "ALT", "STRK", "MANTA", "DYM", "PIXEL", "PORTAL",
  "LTC", "BCH", "ETC", "FIL", "ICP", "HBAR", "VET", "ALGO", "EGLD", "SAND",
  "MANA", "AXS", "GMT", "APE", "GALA", "ENJ", "IMX", "BLUR", "MAGIC", "PRIME",
  "STX", "ORDI", "SATS", "RATS", "MTRX", "AI", "GPT", "AGIX", "OCEAN", "RNDR"
]);

// Buy signal keywords and patterns - EXPANDED
const BUY_PATTERNS = [
  // Direct mentions
  /\bbuy\s+(\$?[a-z]{2,10})\b/gi,
  /\bbuying\s+(\$?[a-z]{2,10})\b/gi,
  /\bbought\s+(\$?[a-z]{2,10})\b/gi,
  /\blong\s+(\$?[a-z]{2,10})\b/gi,
  /\blonging\s+(\$?[a-z]{2,10})\b/gi,
  /\bbullish\s+(?:on\s+)?(\$?[a-z]{2,10})\b/gi,
  /\baccumulate\s+(\$?[a-z]{2,10})\b/gi,
  /\baccumulating\s+(\$?[a-z]{2,10})\b/gi,
  /\bload\s+(?:up\s+)?(?:on\s+)?(\$?[a-z]{2,10})\b/gi,
  /\bloading\s+(\$?[a-z]{2,10})\b/gi,
  /\bentry\s+(?:on\s+)?(\$?[a-z]{2,10})\b/gi,
  /\bape\s+(?:into\s+)?(\$?[a-z]{2,10})\b/gi,
  /\baping\s+(?:into\s+)?(\$?[a-z]{2,10})\b/gi,
  /\baped\s+(?:into\s+)?(\$?[a-z]{2,10})\b/gi,
  /\bfomo\s+(?:into\s+)?(\$?[a-z]{2,10})\b/gi,
  /\bstack\s+(?:more\s+)?(\$?[a-z]{2,10})\b/gi,
  /\bstacking\s+(\$?[a-z]{2,10})\b/gi,
  /\bgrab\s+(?:some\s+)?(\$?[a-z]{2,10})\b/gi,
  /\bscoop\s+(?:up\s+)?(\$?[a-z]{2,10})\b/gi,
  /\bscooping\s+(\$?[a-z]{2,10})\b/gi,
  
  // Sentiment patterns
  /(\$[a-z]{2,10})\s+(?:to the moon|moon|pump|pumping|going up|breaking out|breakout|ripping|mooning|sending|flying)/gi,
  /(\$[a-z]{2,10})\s+(?:looks good|looking good|bullish|strong|ready|primed|set to run|about to run)/gi,
  /(?:bullish|long|buy|grab|load|stack)\s+(?:on\s+)?(\$[a-z]{2,10})/gi,
  
  // Price action
  /(\$[a-z]{2,10})\s+(?:\d+x|100x|10x|5x|2x|will pump|gonna pump|about to pump)/gi,
  /(\$[a-z]{2,10})\s+(?:easy money|free money|alpha|gem|hidden gem|undervalued)/gi,
];

// Sell signal keywords and patterns - EXPANDED
const SELL_PATTERNS = [
  // Direct mentions
  /\bsell\s+(\$?[a-z]{2,10})\b/gi,
  /\bselling\s+(\$?[a-z]{2,10})\b/gi,
  /\bsold\s+(\$?[a-z]{2,10})\b/gi,
  /\bshort\s+(\$?[a-z]{2,10})\b/gi,
  /\bshorting\s+(\$?[a-z]{2,10})\b/gi,
  /\bbearish\s+(?:on\s+)?(\$?[a-z]{2,10})\b/gi,
  /\bexit\s+(\$?[a-z]{2,10})\b/gi,
  /\bexiting\s+(\$?[a-z]{2,10})\b/gi,
  /\bdump\s+(\$?[a-z]{2,10})\b/gi,
  /\bdumping\s+(\$?[a-z]{2,10})\b/gi,
  /\btake\s+profit\s+(?:on\s+)?(\$?[a-z]{2,10})\b/gi,
  /\btp\s+(?:on\s+)?(\$?[a-z]{2,10})\b/gi,
  /\bclose\s+(\$?[a-z]{2,10})\b/gi,
  /\bclosing\s+(\$?[a-z]{2,10})\b/gi,
  /\bfade\s+(\$?[a-z]{2,10})\b/gi,
  /\bfading\s+(\$?[a-z]{2,10})\b/gi,
  
  // Sentiment patterns
  /(\$[a-z]{2,10})\s+(?:dump|dumping|crashing|going down|tanking|dying|dead|rug|rugging)/gi,
  /(\$[a-z]{2,10})\s+(?:looks weak|looking weak|bearish|overbought|topped|topping)/gi,
  /(?:bearish|short|sell|dump|fade)\s+(?:on\s+)?(\$[a-z]{2,10})/gi,
];

// Pattern to find any $TOKEN mention (for general detection)
const TOKEN_MENTION_PATTERN = /\$([a-z]{2,10})\b/gi;

// Extract TP/SL from text
function extractTpSl(text: string): { tp?: string; sl?: string } {
  let tp: string | undefined;
  let sl: string | undefined;

  const tpMatch = text.match(/(?:tp|take\s*profit|target|pt)[\s:@=]*\$?(\d+\.?\d*)/i);
  if (tpMatch) tp = tpMatch[1];

  const slMatch = text.match(/(?:sl|stop\s*loss|stop|stoploss)[\s:@=]*\$?(\d+\.?\d*)/i);
  if (slMatch) sl = slMatch[1];

  return { tp, sl };
}

// Extract amount from text
function extractAmount(text: string): string | undefined {
  const amountMatch = text.match(/(\$?\d+\.?\d*)\s*(?:usdt|usd|\$|dollars?|worth)/i);
  if (amountMatch) {
    return amountMatch[1].replace(/\$/g, "");
  }
  return undefined;
}

// Clean token symbol
function cleanToken(token: string): string {
  return token.replace(/^\$/, "").toUpperCase();
}

// Common words to filter out false positives
const COMMON_WORDS = new Set([
  "THE", "AND", "FOR", "ARE", "BUT", "NOT", "YOU", "ALL", "CAN", "HER", 
  "WAS", "ONE", "OUR", "OUT", "HAS", "HIS", "HOW", "ITS", "MAY", "NEW",
  "NOW", "OLD", "SEE", "WAY", "WHO", "BOY", "DID", "GET", "LET", "PUT",
  "SAY", "SHE", "TOO", "USE", "USD", "USDT", "COIN", "TOKEN", "THIS",
  "THAT", "WITH", "FROM", "HAVE", "BEEN", "WILL", "WHAT", "WHEN", "YOUR",
  "JUST", "MORE", "SOME", "THAN", "THEM", "THEN", "VERY", "WOULD", "ABOUT"
]);

// Check if token looks valid
function isValidToken(token: string): boolean {
  const clean = cleanToken(token);
  if (clean.length < 2 || clean.length > 10) return false;
  if (COMMON_WORDS.has(clean)) return false;
  if (!/^[A-Z]+$/.test(clean)) return false;
  // Prioritize known tokens
  return true;
}

// Check if token is a known crypto
function isKnownToken(token: string): boolean {
  return KNOWN_TOKENS.has(cleanToken(token));
}

export function parseSignalsFromPost(post: {
  id: string;
  title: string;
  content?: string;
  author: { name: string };
  upvotes: number;
  downvotes?: number;
}): TradingSignal[] {
  const signals: TradingSignal[] = [];
  const originalText = `${post.title} ${post.content || ""}`;
  
  // Calculate base confidence from upvotes
  const netVotes = post.upvotes - (post.downvotes || 0);
  const baseConfidence = Math.min(0.9, Math.max(0.1, 0.3 + (netVotes / 50)));

  // Check for buy signals
  for (const pattern of BUY_PATTERNS) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(originalText)) !== null) {
      const token = match[1];
      if (token && isValidToken(token)) {
        const { tp, sl } = extractTpSl(originalText);
        const amount = extractAmount(originalText);
        const confidence = isKnownToken(token) ? baseConfidence + 0.2 : baseConfidence;
        
        signals.push({
          action: "buy",
          token: cleanToken(token),
          amount,
          tp,
          sl,
          confidence: Math.min(0.95, confidence),
          source: {
            postId: post.id,
            title: post.title,
            author: post.author.name,
            upvotes: post.upvotes,
          },
        });
      }
    }
  }

  // Check for sell signals
  for (const pattern of SELL_PATTERNS) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(originalText)) !== null) {
      const token = match[1];
      if (token && isValidToken(token)) {
        const { tp, sl } = extractTpSl(originalText);
        const amount = extractAmount(originalText);
        const confidence = isKnownToken(token) ? baseConfidence + 0.2 : baseConfidence;
        
        signals.push({
          action: "sell",
          token: cleanToken(token),
          amount,
          tp,
          sl,
          confidence: Math.min(0.95, confidence),
          source: {
            postId: post.id,
            title: post.title,
            author: post.author.name,
            upvotes: post.upvotes,
          },
        });
      }
    }
  }

  // Also check for known token mentions with $symbol format as potential signals
  let tokenMatch: RegExpExecArray | null;
  TOKEN_MENTION_PATTERN.lastIndex = 0;
  while ((tokenMatch = TOKEN_MENTION_PATTERN.exec(originalText)) !== null) {
    const token = tokenMatch[1];
    if (token && isKnownToken(token)) {
      // Check if we already have this token
      const exists = signals.some(s => s.token === cleanToken(token));
      if (!exists) {
        // Default to buy for known token mentions (bullish bias)
        signals.push({
          action: "buy",
          token: cleanToken(token),
          amount: undefined,
          confidence: baseConfidence * 0.7, // Lower confidence for just mentions
          source: {
            postId: post.id,
            title: post.title,
            author: post.author.name,
            upvotes: post.upvotes,
          },
        });
      }
    }
  }

  // Deduplicate signals by token and action
  const seen = new Set<string>();
  return signals.filter((signal) => {
    const key = `${signal.action}-${signal.token}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseSignalsFromFeed(posts: Array<{
  id: string;
  title: string;
  content?: string;
  author: { name: string };
  upvotes: number;
  downvotes?: number;
}>): TradingSignal[] {
  const allSignals: TradingSignal[] = [];
  
  for (const post of posts) {
    const signals = parseSignalsFromPost(post);
    allSignals.push(...signals);
  }

  // Deduplicate across posts (same token + action = keep highest confidence)
  const tokenActionMap = new Map<string, TradingSignal>();
  for (const signal of allSignals) {
    const key = `${signal.action}-${signal.token}`;
    const existing = tokenActionMap.get(key);
    if (!existing || signal.confidence > existing.confidence) {
      tokenActionMap.set(key, signal);
    }
  }

  // Sort by confidence (highest first)
  const uniqueSignals = Array.from(tokenActionMap.values());
  uniqueSignals.sort((a, b) => b.confidence - a.confidence);

  return uniqueSignals;
}
