/**
 * Collect real-time data from Pyth Oracle + Raydium DEX
 * For training the 6-feature neural network
 */

const { Connection, PublicKey } = require("@solana/web3.js");
const fs = require("fs");

const CONFIG = {
  MAINNET_RPC: "https://api.mainnet-beta.solana.com",
  PYTH_SOL_USD: "H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG",
  RAYDIUM_SOL_VAULT: "DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz",
  RAYDIUM_USDC_VAULT: "HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz",

  INTERVAL_MS: 10000,  // 10 seconds
  OUTPUT_FILE: "data/pyth_raydium_data.csv",
  LOOKAHEAD: 6,  // 6 periods = 60 seconds for labeling
};

const connection = new Connection(CONFIG.MAINNET_RPC, "confirmed");

// Rolling window for features
const priceHistory = [];
const MAX_HISTORY = 20;

async function fetchData() {
  try {
    // Fetch all accounts in parallel
    const [pythAccount, solVault, usdcVault] = await Promise.all([
      connection.getAccountInfo(new PublicKey(CONFIG.PYTH_SOL_USD)),
      connection.getAccountInfo(new PublicKey(CONFIG.RAYDIUM_SOL_VAULT)),
      connection.getAccountInfo(new PublicKey(CONFIG.RAYDIUM_USDC_VAULT)),
    ]);

    if (!pythAccount || !solVault || !usdcVault) {
      console.log("Failed to fetch accounts");
      return null;
    }

    // Parse Pyth price (i64 at offset 208, expo at offset 20)
    const pythData = pythAccount.data;
    const priceLow = pythData.readUInt32LE(208);
    const priceHigh = pythData.readInt32LE(212);
    const rawPrice = BigInt(priceHigh) * BigInt(0x100000000) + BigInt(priceLow);
    const expo = pythData.readInt32LE(20);
    const pythPrice = Number(rawPrice) * Math.pow(10, expo);

    // Parse Raydium reserves
    const solAmount = solVault.data.readBigUInt64LE(64);
    const usdcAmount = usdcVault.data.readBigUInt64LE(64);
    const dexPrice = (Number(usdcAmount) / 1e6) / (Number(solAmount) / 1e9);

    // Calculate liquidity indicator
    let liq = 0;
    let s = Number(solAmount);
    while (s > 0) { liq++; s = Math.floor(s / 2); }
    if (liq > 255) liq = 255;

    return {
      timestamp: Date.now(),
      pythPrice,
      dexPrice,
      solReserve: Number(solAmount) / 1e9,
      usdcReserve: Number(usdcAmount) / 1e6,
      liquidity: liq,
      spread: ((dexPrice - pythPrice) / pythPrice) * 100,
    };
  } catch (e) {
    console.error("Fetch error:", e.message);
    return null;
  }
}

function calculateFeatures(history) {
  if (history.length < 4) return null;

  const current = history[history.length - 1];
  const prev1 = history[history.length - 2];
  const prev2 = history[history.length - 3];
  const prev3 = history[history.length - 4];

  // SMA of last 4 prices
  const sma = (current.pythPrice + prev1.pythPrice + prev2.pythPrice + prev3.pythPrice) / 4;

  // Feature 0: Price vs SMA (128 = at SMA)
  let priceVsSma = 128 + ((current.pythPrice - sma) / sma) * 100;
  priceVsSma = Math.max(0, Math.min(255, Math.round(priceVsSma)));

  // Feature 1: Momentum (128 = neutral)
  let momentum = 128 + ((current.pythPrice - prev3.pythPrice) / prev3.pythPrice) * 100;
  momentum = Math.max(0, Math.min(255, Math.round(momentum)));

  // Feature 2: Volatility (range / sma)
  const prices = [current.pythPrice, prev1.pythPrice, prev2.pythPrice, prev3.pythPrice];
  const range = Math.max(...prices) - Math.min(...prices);
  let volatility = (range / sma) * 1000;
  volatility = Math.max(0, Math.min(255, Math.round(volatility)));

  // Feature 3: Liquidity
  const liquidity = current.liquidity;

  // Feature 4: Spread (128 = no spread)
  let spreadFeature = 128 + current.spread;
  spreadFeature = Math.max(0, Math.min(255, Math.round(spreadFeature)));

  // Feature 5: Trend (count ups)
  let ups = 0;
  if (current.pythPrice > prev1.pythPrice) ups++;
  if (prev1.pythPrice > prev2.pythPrice) ups++;
  const trend = ups * 85;

  return {
    timestamp: current.timestamp,
    pythPrice: current.pythPrice,
    dexPrice: current.dexPrice,
    priceVsSma,
    momentum,
    volatility,
    liquidity,
    spreadFeature,
    trend,
  };
}

function labelData(features, futurePrice) {
  const change = (futurePrice - features.pythPrice) / features.pythPrice;

  // -1 = down (< -0.1%), 0 = neutral, 1 = up (> +0.1%)
  if (change < -0.001) return -1;
  if (change > 0.001) return 1;
  return 0;
}

async function collect() {
  console.log("=".repeat(60));
  console.log("Collecting Pyth + Raydium Data");
  console.log("=".repeat(60));
  console.log(`Interval: ${CONFIG.INTERVAL_MS}ms`);
  console.log(`Lookahead: ${CONFIG.LOOKAHEAD} periods`);
  console.log(`Output: ${CONFIG.OUTPUT_FILE}`);
  console.log("Press Ctrl+C to stop\n");

  // Initialize CSV
  const header = "timestamp,pyth_price,dex_price,price_vs_sma,momentum,volatility,liquidity,spread,trend,label\n";
  if (!fs.existsSync(CONFIG.OUTPUT_FILE)) {
    fs.writeFileSync(CONFIG.OUTPUT_FILE, header);
  }

  const pendingLabels = [];  // Store data waiting for future price
  let sampleCount = 0;

  const tick = async () => {
    const data = await fetchData();
    if (!data) return;

    priceHistory.push(data);
    if (priceHistory.length > MAX_HISTORY) {
      priceHistory.shift();
    }

    const features = calculateFeatures(priceHistory);
    if (features) {
      // Add to pending for labeling later
      pendingLabels.push(features);

      // Label old entries that now have future data
      while (pendingLabels.length > CONFIG.LOOKAHEAD) {
        const old = pendingLabels.shift();
        const label = labelData(old, data.pythPrice);

        const row = [
          old.timestamp,
          old.pythPrice.toFixed(4),
          old.dexPrice.toFixed(4),
          old.priceVsSma,
          old.momentum,
          old.volatility,
          old.liquidity,
          old.spreadFeature,
          old.trend,
          label
        ].join(",") + "\n";

        fs.appendFileSync(CONFIG.OUTPUT_FILE, row);
        sampleCount++;
      }
    }

    // Status
    const status = `[${new Date().toISOString()}] Pyth: $${data.pythPrice.toFixed(2)} | DEX: $${data.dexPrice.toFixed(2)} | Spread: ${data.spread.toFixed(3)}% | Samples: ${sampleCount}`;
    process.stdout.write(`\r${status}`);
  };

  // Initial fetch
  await tick();

  // Periodic collection
  setInterval(tick, CONFIG.INTERVAL_MS);
}

collect().catch(console.error);
