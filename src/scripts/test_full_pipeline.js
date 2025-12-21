/**
 * Test Full On-Chain Pipeline: Pyth + Raydium → Features → NN Prediction
 *
 * This script:
 * 1. Fetches current data from Pyth and Raydium on mainnet
 * 2. Compiles all Python scripts
 * 3. Verifies bytecode sizes fit within limits
 * 4. Simulates the full prediction pipeline
 */

const { Connection, PublicKey } = require("@solana/web3.js");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const CONFIG = {
  MAINNET_RPC: "https://api.mainnet-beta.solana.com",

  // Account addresses
  PYTH_SOL_USD: "H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG",
  RAYDIUM_SOL_VAULT: "DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz",
  RAYDIUM_USDC_VAULT: "HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz",

  // Bytecode limit per TX
  BYTECODE_LIMIT: 946,
};

const COMPILER = process.env.PIKA_COMPILE ||
  "/Users/true/Documents/Pipeline/CasterCorp/modelonSolana/solanapython-build/solana/tools/pika_compile";

const SCRIPTS = {
  // Accumulator pipeline (6 TX)
  "1_accum_pyth": "src/python/accum_v2_p1.py",
  "2_accum_sma": "src/python/acc_sma.py",
  "3_accum_vol": "src/python/acc_vol_a.py",
  "4_accum_mom": "src/python/acc_mom.py",
  "5_accum_ray_liq": "src/python/acc_ray_liq.py",
  "6_accum_dex": "src/python/acc_dex_price.py",
  "7_accum_spread": "src/python/acc_spread.py",
  // Neural network (4 TX)
  "8_nn_features": "src/python/nn6_feat.py",
  "9_nn_h0h1": "src/python/nn6_h0h1.py",
  "10_nn_h2": "src/python/nn6_h2.py",
  "11_nn_decoder": "src/python/price_6_3_s2.py",
};

function compilePython(scriptPath) {
  const tempBin = `/tmp/${path.basename(scriptPath, ".py")}.bin`;
  try {
    execSync(`${COMPILER} -f ${scriptPath} -o ${tempBin}`, { stdio: "pipe" });
    const bytecode = fs.readFileSync(tempBin);
    return { success: true, size: bytecode.length, bytecode };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function fetchMarketData() {
  const connection = new Connection(CONFIG.MAINNET_RPC, "confirmed");

  console.log("\n--- Fetching Market Data ---\n");

  // Fetch Pyth price (need full i64 + expo)
  const pythAccount = await connection.getAccountInfo(
    new PublicKey(CONFIG.PYTH_SOL_USD)
  );
  const pythData = pythAccount.data;
  const priceLow = pythData.readUInt32LE(208);
  const priceHigh = pythData.readInt32LE(212);
  const rawPrice = BigInt(priceHigh) * BigInt(0x100000000) + BigInt(priceLow);
  const expo = pythData.readInt32LE(20); // -8 typically
  const pythDollars = Number(rawPrice) * Math.pow(10, expo);
  const pythCents = Math.floor(pythDollars * 100);

  console.log(`Pyth SOL/USD: $${(pythCents / 100).toFixed(2)}`);

  // Fetch Raydium reserves
  const [solVault, usdcVault] = await Promise.all([
    connection.getAccountInfo(new PublicKey(CONFIG.RAYDIUM_SOL_VAULT)),
    connection.getAccountInfo(new PublicKey(CONFIG.RAYDIUM_USDC_VAULT)),
  ]);

  const solAmount = solVault.data.readBigUInt64LE(64);
  const usdcAmount = usdcVault.data.readBigUInt64LE(64);
  const dexPrice = Number((usdcAmount * 100000n) / solAmount);
  const dexDollars = dexPrice / 100;

  console.log(`Raydium DEX: $${dexDollars.toFixed(2)}`);

  // Calculate spread
  const spread = ((dexDollars - pythCents / 100) / (pythCents / 100)) * 100;
  console.log(`Spread: ${spread.toFixed(3)}%`);

  // Liquidity indicator
  let liq = 0;
  let s = Number(solAmount);
  while (s > 0) {
    liq++;
    s = Math.floor(s / 2);
  }
  console.log(`Liquidity indicator: ${liq}`);

  return {
    pythCents,
    dexCents: dexPrice,
    spread: Math.round(128 + spread),
    liquidity: Math.min(liq, 255),
    solReserve: Number(solAmount) / 1e9,
    usdcReserve: Number(usdcAmount) / 1e6,
  };
}

function simulateFeatures(marketData) {
  console.log("\n--- Simulating Feature Extraction ---\n");

  // Simulate accumulator state (using current as all 4 prices for demo)
  const p0 = marketData.pythCents;
  const p1 = p0; // Would be from history
  const p2 = p0;
  const p3 = p0;
  const sma = Math.floor((p0 + p1 + p2 + p3) / 4);

  // Feature 0: Price vs SMA
  let I0 = 128; // At SMA since all prices same
  console.log(`I0 (price_vs_sma): ${I0}`);

  // Feature 1: Momentum (128 = neutral)
  const I1 = 128;
  console.log(`I1 (momentum): ${I1}`);

  // Feature 2: Volatility (0 = no volatility)
  const I2 = 0;
  console.log(`I2 (volatility): ${I2}`);

  // Feature 3: Liquidity
  const I3 = marketData.liquidity;
  console.log(`I3 (liquidity): ${I3}`);

  // Feature 4: Pyth/DEX spread
  const I4 = Math.min(255, Math.max(0, marketData.spread));
  console.log(`I4 (pyth_dex_spread): ${I4}`);

  // Feature 5: Trend (neutral)
  const I5 = 85; // 1 up
  console.log(`I5 (trend): ${I5}`);

  return { I0, I1, I2, I3, I4, I5 };
}

function simulateNeuralNetwork(features) {
  console.log("\n--- Simulating Neural Network 6→3→2 ---\n");

  const { I0, I1, I2, I3, I4, I5 } = features;

  // Encoder weights (placeholder - would be trained)
  const W = [10, -5, 2, -8, 15, -3, -12, 8, -1, 5, -10, 6, 3, -7, 12, -2, 8, -9, 50, 60, 45];

  // Hidden layer
  let h0 = W[18] + I0 * W[0] + I1 * W[1] + I2 * W[2] + I3 * W[3] + I4 * W[4] + I5 * W[5];
  let h1 = W[19] + I0 * W[6] + I1 * W[7] + I2 * W[8] + I3 * W[9] + I4 * W[10] + I5 * W[11];
  let h2 = W[20] + I0 * W[12] + I1 * W[13] + I2 * W[14] + I3 * W[15] + I4 * W[16] + I5 * W[17];

  // ReLU
  h0 = Math.max(0, h0);
  h1 = Math.max(0, h1);
  h2 = Math.max(0, h2);

  console.log(`Hidden layer: h0=${h0}, h1=${h1}, h2=${h2}`);

  // Decoder weights
  const D = [-5, 8, -3, 6, -4, 10, 100, 80];

  // Output layer
  const o0 = D[6] + h0 * D[0] + h1 * D[1] + h2 * D[2];
  const o1 = D[7] + h0 * D[3] + h1 * D[4] + h2 * D[5];

  console.log(`Output: o0=${o0} (direction), o1=${o1} (confidence)`);

  // Interpret
  let direction = "NEUTRAL";
  if (o0 > 1000) direction = "BULLISH";
  if (o0 < -1000) direction = "BEARISH";

  console.log(`\nPrediction: ${direction}`);

  return { o0, o1, direction };
}

async function main() {
  console.log("=".repeat(60));
  console.log("Full On-Chain Pipeline Test: Pyth + Raydium → NN");
  console.log("=".repeat(60));

  // Step 1: Compile all scripts and check sizes
  console.log("\n--- Compiling Python Scripts ---\n");

  const results = {};
  let allFit = true;

  for (const [name, scriptPath] of Object.entries(SCRIPTS)) {
    const result = compilePython(scriptPath);
    results[name] = result;

    if (result.success) {
      const fits = result.size <= CONFIG.BYTECODE_LIMIT;
      const status = fits ? "✓" : "✗ EXCEEDS LIMIT";
      console.log(`${name}: ${result.size} bytes ${status}`);
      if (!fits) allFit = false;
    } else {
      console.log(`${name}: COMPILE ERROR - ${result.error}`);
      allFit = false;
    }
  }

  if (!allFit) {
    console.log("\n⚠️  Some scripts exceed bytecode limit or failed to compile");
  }

  // Step 2: Fetch market data
  const marketData = await fetchMarketData();

  // Step 3: Simulate feature extraction
  const features = simulateFeatures(marketData);

  // Step 4: Simulate neural network
  const prediction = simulateNeuralNetwork(features);

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("PIPELINE SUMMARY");
  console.log("=".repeat(60));
  console.log(`
On-Chain Data Sources:
  - Pyth Oracle: ${CONFIG.PYTH_SOL_USD}
  - Raydium SOL Vault: ${CONFIG.RAYDIUM_SOL_VAULT}
  - Raydium USDC Vault: ${CONFIG.RAYDIUM_USDC_VAULT}

Transaction Flow:
  TX1: feature_accumulator_v2.py
       Reads: Pyth + Raydium vaults
       Writes: Accumulator (48 bytes)
       Size: ${results.feature_accumulator_v2?.size || "N/A"} bytes

  TX2: price_6_3_s1.py (Encoder)
       Reads: Accumulator
       Writes: Scratch (6 bytes)
       Size: ${results.price_6_3_s1?.size || "N/A"} bytes

  TX3: price_6_3_s2.py (Decoder)
       Reads: Scratch
       Returns: Prediction
       Size: ${results.price_6_3_s2?.size || "N/A"} bytes

Current Market:
  - Pyth Price: $${(marketData.pythCents / 100).toFixed(2)}
  - DEX Price: $${(marketData.dexCents / 100).toFixed(2)}
  - SOL Reserve: ${marketData.solReserve.toLocaleString()} SOL
  - USDC Reserve: ${marketData.usdcReserve.toLocaleString()} USDC
  - Prediction: ${prediction.direction}
`);
}

main().catch(console.error);
