# Trading Guide

ChainMind includes built-in token trading powered by Kyberswap DEX aggregation.

## Buying Tokens

To buy a token, use the buy command:

```
Buy 0.01 ETH of 0x65d35a53c25836448a872934aeb3a7c2db97623d
```

Or simply:
```
Buy 0xTokenAddress
```
(Uses 0.01 ETH by default)

## Selling Tokens

To sell all your tokens:
```
Sell all 0xTokenAddress
```

To sell a specific amount:
```
Sell 1000 0xTokenAddress
```

## How Trading Works

ChainMind uses Kyberswap's DEX aggregator which:
- Finds the best prices across multiple DEXes
- Supports Uniswap V3, V4, and other protocols
- Handles slippage automatically (5% tolerance)
- Returns native ETH when selling

## WETH to ETH Conversion

If you receive WETH from any transaction, convert it to ETH:
```
Unwrap weth
```
or
```
Convert weth to eth
```

## Trading Tips

1. **Check Liquidity**: New tokens may have limited liquidity
2. **Start Small**: Test with small amounts first
3. **Gas Fees**: Ensure you have enough ETH for gas
4. **Slippage**: 5% slippage is applied by default

## Supported Networks

Trading is currently available on:
- **Base**: Ethereum Layer 2

## Transaction Confirmation

After each trade, you'll receive:
- Transaction hash
- Amount received
- Link to view on Basescan
