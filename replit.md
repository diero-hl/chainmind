# ChainMind - AI-Powered Token Launcher on Base

## Overview

ChainMind is an AI-powered chat interface for launching tokens on Base blockchain using Clanker and natural language. Features include:
- Natural language token deployment via Claude AI
- Auto-proof posting to Moltbook after token launch
- Unique agent wallet per browser session
- Token trading via multiple DEX aggregators (Kyberswap, Odos, ParaSwap, 1inch)
- ETH wallet management with withdraw functionality

**Production URL**: https://www.chainmind.app

## User Preferences

Preferred communication style: Casual Filipino/English mix (Taglish)

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **State Management**: TanStack React Query for server state
- **Styling**: Tailwind CSS (dark mode only)
- **Component Library**: shadcn/ui (Radix UI primitives)
- **Build Tool**: Vite
- **Layout**: Single-page mobile-first chat interface

### Backend Architecture
- **Runtime**: Vercel Serverless Functions (12 function limit on Hobby plan)
- **Language**: TypeScript
- **API Pattern**: RESTful JSON API with `/api` prefix
- **Blockchain**: Base (Chain ID: 8453)

### Data Storage
- **Database**: PostgreSQL (Neon serverless)
- **Tables**: 
  - `moltbook_agent` - AI agent credentials, wallet, and Moltbook API key
  - `token_launches` - Deployed tokens history

### Integrations
- **Clanker SDK**: Token deployment on Uniswap v4
- **Anthropic Claude**: AI chat responses
- **Moltbook API**: Social proof posting
- **DEX Aggregators**: Kyberswap, Odos, ParaSwap, 1inch for trading

## Key Features

### Agent Registration
- Register with unique name and description
- Auto-generates encrypted wallet (Base network)
- Claim verification via Moltbook URL

### Token Launching
- Natural language: "Launch a token called DogeX with symbol DOGEX"
- Deploys via Clanker SDK to Uniswap v4
- Optional devBuy for initial liquidity (0.001 ETH if wallet has >= 0.002 ETH)
- Auto-posts proof to Moltbook clanker submolt

### Token Trading (Buy/Sell)
- Multi-aggregator support: Kyberswap > Odos > ParaSwap > 1inch
- Commands: "buy 0.001 eth of 0x..." or "sell 50% of TOKEN"
- Balance and gas estimation

### Wallet Management
- View balance: "balance" or "wallet"
- Withdraw: "withdraw max to 0x..." or "withdraw 0.01 to 0x..."
- Supports max withdrawal with automatic gas calculation

## API Endpoints

### Agent
- `GET /api/agent` - Get current agent info
- `POST /api/agent/register` - Register new agent with name/description
- `GET /api/agent/status` - Sync agent verification status with Moltbook

### Wallet
- `GET /api/wallet` - Get wallet address and balance
- `POST /api/wallet` - Transfer ETH (supports "max" amount)

### Tokens
- `GET /api/tokens` - Get user's launched tokens
- `POST /api/tokens` - Deploy new token via Clanker

### Trading
- `POST /api/trade/buy` - Buy tokens with ETH
- `POST /api/trade/sell` - Sell tokens for ETH

### Chat
- `POST /api/chat` - Send message to Claude AI

## Environment Variables

### Required Secrets
- `DATABASE_URL` - Neon PostgreSQL connection string
- `ANTHROPIC_API_KEY` - Claude API key
- `WALLET_ENCRYPTION_KEY` - 32-char key for wallet encryption
- `VERCEL_TOKEN` - For deployments

### Optional
- `ONEINCH_API_KEY` - 1inch API key for better swap rates

## Development

### Local Development
```bash
npm run dev
```

### Database
```bash
npm run db:push
```

### Deploy to Vercel
```bash
npx vercel --prod
```

## Technical Notes

### Encryption
- Wallet private keys encrypted with AES-256-CBC + scrypt derivation
- Uses `WALLET_ENCRYPTION_KEY` environment variable
- Supports legacy GCM format for backwards compatibility

### DEX Aggregator Priority
1. Kyberswap (best Uniswap v4 support)
2. Odos
3. ParaSwap
4. 1inch

### Clanker Token Deployment
- Uses Clanker SDK v4
- Tokens deployed to Uniswap v4 pools
- DevBuy creates initial liquidity if wallet has sufficient ETH
- Pool paired with WETH

### Limitations
- Vercel Hobby plan: 12 serverless functions max
- New Clanker v4 tokens may not be immediately tradeable via aggregators
- Direct v4 swaps require pool key info

## Recent Changes (January 2026)

- Implemented Kyberswap as primary DEX aggregator
- Fixed "withdraw max" to properly calculate balance minus gas
- Added multi-aggregator fallback chain for token trading
- Integrated Clanker SDK for token deployment
- Added devBuy option for initial liquidity
- Moltbook proof posting on successful launches
- Wallet encryption standardized to scrypt + CBC
