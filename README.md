# Price Direction Predictor

On-chain neural network for predicting short-term price direction on Solana.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                 6→4→2 PRICE PREDICTOR                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Inputs (6 features, normalized INT8):                          │
│  ├── vwap_ratio      # VWAP / current price (128 = neutral)    │
│  ├── volume_accel    # Volume acceleration (128 = stable)      │
│  ├── orderbook_imbal # Buy/sell imbalance (128 = balanced)     │
│  ├── volatility      # Recent volatility (0-255)               │
│  ├── liquidity_depth # Relative liquidity (0-255)              │
│  └── momentum        # 5-second trend (128 = neutral)          │
│                                                                 │
│  TX 1: Encoder 6→4 (28 params)                                  │
│  ├── 24 weights (6×4 matrix)                                   │
│  ├── 4 biases                                                   │
│  ├── ReLU activation                                            │
│  └── Write hidden state to account                              │
│                                                                 │
│  TX 2: Decoder 4→2 (10 params)                                  │
│  ├── 8 weights (4×2 matrix)                                    │
│  ├── 2 biases                                                   │
│  └── Output: direction + confidence                             │
│                                                                 │
│  Total: 38 params INT8, 2 TX, ~256K CU                          │
└─────────────────────────────────────────────────────────────────┘
```

## Outputs

- **Direction**: -1 (bearish), 0 (neutral), +1 (bullish)
- **Confidence**: 0-255 (higher = more confident)

## Usage

```javascript
const { PricePredictor } = require('./sdk/price-predictor');

const predictor = new PricePredictor(connection, programId);

// Get market data (from Pyth, Jupiter, etc.)
const marketData = {
  vwap: 100.5,
  price: 100.0,
  volumeChange: 0.2,
  bidAskRatio: 0.1,
  volatility: 0.05,
  liquidityRatio: 0.8,
  momentum: 0.15,
};

// Normalize and predict
const features = predictor.normalizeFeatures(marketData);
const prediction = await predictor.predict(tokenMint, features);

if (predictor.isBullish(prediction)) {
  console.log('Bullish signal!');
}
```

## Files

```
src/
├── python/
│   ├── price_s1.py     # Encoder stage (28 params)
│   └── price_s2.py     # Decoder stage (10 params)
└── scripts/
    ├── deploy.js       # Deploy model to devnet
    ├── test.js         # Run E2E tests
    ├── train.py        # Training pipeline
    └── fetch_data.js   # Collect market data
sdk/
└── price-predictor.js  # JavaScript SDK
demo/
└── live-prediction.js  # Real-time demo
```

## Feature Normalization

All features normalized to INT8 (0-255):

| Feature | Formula | Neutral |
|---------|---------|---------|
| VWAP ratio | `(vwap/price) * 128` | 128 |
| Volume accel | `128 + change * 64` | 128 |
| Orderbook imbal | `128 + ratio * 64` | 128 |
| Volatility | `volatility * 255` | 0 |
| Liquidity | `ratio * 255` | varies |
| Momentum | `128 + momentum * 127` | 128 |

## Performance

| Metric | Value |
|--------|-------|
| Parameters | 38 INT8 |
| Transactions | 2 |
| CU per TX | ~128K |
| Total CU | ~256K |
| Target accuracy | >55% |
| Prediction horizon | 5-30 seconds |

## Use Cases

- **Smart DCA**: Buy only on bullish signals
- **Stop-loss**: Sell before predicted drops
- **Arbitrage timing**: Execute when confidence high
- **DEX integration**: Show prediction before swap

## Data Sources

- Pyth Network (price oracle)
- Jupiter API (aggregated prices)
- Birdeye API (historical trades)
- On-chain: Raydium, Orca pools

## License

MIT
