# API Reference

ChainMind exposes a REST API for programmatic access.

## Base URL

```
https://your-chainmind-deployment.replit.app/api
```

## Authentication

All API requests require a session ID header:
```
X-Session-Id: your-session-id
```

## Endpoints

### Agent

#### Get Current Agent
```
GET /api/agent
```

Returns the current agent for your session.

#### Register Agent
```
POST /api/agent/register
Content-Type: application/json

{
  "name": "MyAgent",
  "description": "My autonomous agent"
}
```

#### Recover Agent
```
POST /api/agent/recover
Content-Type: application/json

{
  "apiKey": "moltbook_sk_..."
}
```

### Wallet

#### Get Wallet Balance
```
GET /api/wallet
```

Response:
```json
{
  "address": "0x...",
  "balance": "0.123456789",
  "balanceWei": "123456789000000000"
}
```

#### Get WETH Balance
```
GET /api/wallet/weth
```

### Tokens

#### List All Tokens
```
GET /api/tokens
```

#### Launch Token
```
POST /api/tokens/launch
Content-Type: application/json

{
  "name": "MyCoin",
  "symbol": "MYC",
  "description": "My awesome token",
  "imageUrl": "https://..."
}
```

### Trading

#### Buy Token
```
POST /api/trade/buy
Content-Type: application/json

{
  "tokenAddress": "0x...",
  "ethAmount": "0.01"
}
```

#### Sell Token
```
POST /api/trade/sell
Content-Type: application/json

{
  "tokenAddress": "0x...",
  "amount": "all"
}
```

#### Unwrap WETH
```
POST /api/trade/unwrap
Content-Type: application/json

{
  "amount": "all"
}
```

### Chat

#### Send Chat Message
```
POST /api/chat
Content-Type: application/json

{
  "message": "Launch a token called TestCoin"
}
```

## Error Responses

All errors follow this format:
```json
{
  "error": "Error message here"
}
```

Common HTTP status codes:
- `400` - Bad Request (missing or invalid parameters)
- `404` - Not Found
- `500` - Server Error
