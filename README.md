# On-Chain AI Price Prediction on Solana

> **[Experiment]** A fully on-chain AI model running on Solana. 65 bytes of weights, 59.2% accuracy, ~$0.002 per inference.

This is a proof of concept exploring the limits of on-chain machine learning. The entire model (weights, computation, inference) lives on Solana. No off-chain oracles. No external APIs. Pure blockchain execution.

## Why?

Because we wanted to see if it was possible. Spoiler: it is. Barely.

## The Model

```
┌────────────────────────────────────────────────────────────┐
│                 6 → 8 → 1 NEURAL NETWORK                   │
├────────────────────────────────────────────────────────────┤
│                                                            │
│   Inputs (6 features):     Hidden Layer:      Output:      │
│   ├── SMA ratio            8 neurons          Binary       │
│   ├── Momentum             ReLU activation    UP (1)       │
│   ├── Volatility                              DOWN (0)     │
│   ├── Trend                                                │
│   ├── RSI-like                                             │
│   └── Price position                                       │
│                                                            │
│   Total: 65 bytes (48 + 8 + 8 + 1)                         │
└────────────────────────────────────────────────────────────┘
```

### How small is 65 bytes?

- This README: ~8 KB
- A tweet: ~280 bytes
- A typical ML model: 50-500 MB
- **This model: 65 bytes**

### How?

Everything is **INT8 quantized**. No floats. Each weight is a single byte (-128 to +127).

```python
# The entire forward pass is integer arithmetic
output = bias + (input × weight) // 128
```

No numpy. No libraries. Just addition, multiplication, and integer division.

## Performance

| Metric | Value |
|--------|-------|
| Test Accuracy | **59.2%** |
| Test Samples | 1,803 |
| Total Samples | 9,012 |
| Precision | 60.6% |
| Lookahead | 30 minutes |
| Threshold | 0.5% |

Trained on SOL/USDT data from Binance (1-minute candles).

### Optimization

We started at 53.5% accuracy. To improve, we applied techniques from [xLSTM-TS](https://arxiv.org/abs/2408.12408) (arXiv:2408.12408), a paper that achieved 72.82% on stock trend prediction.

Key insight: raw price data is noisy. The paper uses wavelet denoising. We used a simpler approach for on-chain compatibility: **exponential moving average (EMA) smoothing** before feature extraction. This filters out micro-fluctuations while preserving the trend signal.

Result: 53.5% → 59.2% (+5.7%)

*Is 59.2% good? It's better than a coin flip. For a 65-byte model running on a blockchain VM, we'll take it.*

## On-Chain Stats

| Metric | Value |
|--------|-------|
| Bytecode size | ~4 KB |
| Weights | 65 bytes |
| Compute Units | ~1,247,000 |
| Transactions | 2 per inference |
| Cost | ~$0.002 per prediction |
| Network | Devnet |
| SolanaPython Program | `AdvFUgScZPQmnkhCZ1ZFMN7c1rsanoE7TfYbikggUAxM` |

## How It Works

The model is deployed as compiled Python bytecode on Solana using [SolanaPython](https://github.com/pika-lab/solana-python).

**Deployment (once):**
1. Compile `nn_module.py` to PikaPython bytecode
2. Create 3 Solana accounts (module, weights, features)
3. Write bytecode and weights via chunked transactions

**Inference (per prediction):**
```
TX1: Write 6 input features to account     (~10K CU)
TX2: Import module → executes on import    (~1.25M CU)
     └── Reads weights from /sol/2
     └── Reads features from /sol/3
     └── Computes forward pass
     └── Prints 1 (UP) or 0 (DOWN)
```

The trick: PikaPython can't call functions across modules, so the entire NN executes on `import`. Weird, but it works.

## SolanaPython Modification Required

This project requires a small modification to SolanaPython to support chunked writes with offset. Without this, you can't write bytecode larger than ~1KB.

In `pika_python.c`, modify the `MODE_WRITE_ACCOUNT` (0x03) handler to read an offset:

```c
// Around line 447 in pika_python.c
// Original: writes data at offset 0
// Modified: reads offset from first 2 bytes

case 0x03: {  // MODE_WRITE_ACCOUNT
    if (params->data_len < 3) return ERROR_INVALID_ARGUMENT;

    // First 2 bytes = offset (little-endian)
    uint16_t offset = params->data[1] | (params->data[2] << 8);
    const uint8_t* payload = params->data + 3;
    uint64_t payload_len = params->data_len - 3;

    SolAccountInfo* acct = &params->ka[0];
    if (!acct->is_writable) return ERROR_INVALID_ARGUMENT;
    if (offset + payload_len > acct->data_len) return ERROR_INVALID_ARGUMENT;

    // Write at offset instead of 0
    sol_memcpy(acct->data + offset, payload, payload_len);
    return SUCCESS;
}
```

Instruction format becomes: `[0x03] [offset_lo] [offset_hi] [data...]`

## Quick Start

### Prerequisites

- Node.js 18+
- Solana CLI (`solana config set --url devnet`)
- [pika_compile](https://github.com/pika-lab/solana-python) binary (with modification above)

### Install

```bash
git clone https://github.com/QuantuLabs/price-predictor-aimodel-solana.git
cd price-predictor-aimodel-solana
npm install
```

### Configure

Set the compiler path:
```bash
export PIKA_COMPILE=/path/to/pika_compile
```

Or edit `src/scripts/config.js`.

### Deploy

```bash
node src/scripts/deploy_model.js
```

Creates 3 accounts on devnet and writes bytecode + weights.

### Run Inference

```bash
# Default test features
node src/scripts/user_inference.js

# Custom features (6 INT8 values, 0-255)
node src/scripts/user_inference.js 128,135,20,130,150,100
```

## Project Structure

```
├── src/
│   ├── python/
│   │   └── nn_module.py       # The neural network (executes on import)
│   └── scripts/
│       ├── config.js          # Configuration
│       ├── deploy_model.js    # Deploy to Solana
│       ├── user_inference.js  # Run predictions
│       └── train_optimal.py   # Training script
├── weights/
│   └── optimal_model.bin      # Trained weights (65 bytes)
└── data/                      # Training data
```

## Limitations & Learnings

**SolanaPython is experimental:**
- Many Python builtins don't exist (`bytes()`, `list()`, `chr()`)
- No function calls across modules (`module.function()` fails)
- Bytecode mode only (script mode is 10x slower)

**Solana constraints:**
- Max ~1.4M compute units per transaction
- Max ~1,232 bytes per instruction (chunked writes needed)
- Must request 256KB heap explicitly

**What we learned:**
- On-chain ML is possible, but painful
- INT8 quantization is mandatory
- Everything must be unrolled (no loops in hot paths)
- The VFS (`/sol/N`) for account access actually works well

## Is This Practical?

For production trading? **No.**

But as a proof of concept, it shows that:
- Neural networks can run fully on-chain
- Inference is verifiable and trustless
- Small models (~100 parameters) fit within Solana's constraints

Potential use cases (theoretical):
- On-chain scoring for DeFi protocols
- Verifiable ML predictions without oracles
- Trustless model execution

## License

MIT

## Acknowledgments

- [SolanaPython](https://github.com/pika-lab/solana-python) for running Python on Solana
- [PikaPython](https://github.com/pikasTech/PikaPython) for the lightweight Python implementation

---

*Built by [QuantuLabs](https://github.com/QuantuLabs) as an experiment in on-chain machine learning.*
