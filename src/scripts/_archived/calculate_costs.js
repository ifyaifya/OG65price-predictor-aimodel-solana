/**
 * Calculate total costs for the Price Predictor pipeline
 */

const { Connection, PublicKey } = require("@solana/web3.js");

const CONFIG = {
  DEVNET_RPC: "https://api.devnet.solana.com",
  MAINNET_RPC: "https://api.mainnet-beta.solana.com",

  // Devnet addresses
  PYTH_SOL_USD_DEVNET: "J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix",
  RAYDIUM_AMM_DEVNET: "DRaya7Kj3aMWQSy19kSjvmuwq9docCHofyP9kanQGaav",
  USDC_DEVNET: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",

  // Mainnet addresses
  PYTH_SOL_USD_MAINNET: "H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG",
  RAYDIUM_SOL_VAULT_MAINNET: "DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz",
  RAYDIUM_USDC_VAULT_MAINNET: "HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz",
};

// Bytecode sizes from test
const SCRIPTS = {
  accumulator: [
    { name: "accum_v2_p1", bytes: 665, cu: 150000 },
    { name: "acc_sma", bytes: 793, cu: 150000 },
    { name: "acc_vol_a", bytes: 641, cu: 150000 },
    { name: "acc_mom", bytes: 528, cu: 150000 },
    { name: "acc_ray_liq", bytes: 588, cu: 150000 },
    { name: "acc_dex_price", bytes: 899, cu: 150000 },
    { name: "acc_spread", bytes: 529, cu: 150000 },
  ],
  nn: [
    { name: "nn6_feat", bytes: 832, cu: 150000 },
    { name: "nn6_h0h1", bytes: 946, cu: 200000 },
    { name: "nn6_h2", bytes: 832, cu: 150000 },
    { name: "decoder", bytes: 531, cu: 150000 },
  ],
};

async function calculateCosts() {
  console.log("=".repeat(60));
  console.log("PRICE PREDICTOR - COST ANALYSIS");
  console.log("=".repeat(60));

  // Get current SOL price
  const mainnetConn = new Connection(CONFIG.MAINNET_RPC, "confirmed");
  let solPrice = 120; // Default

  try {
    const pythAccount = await mainnetConn.getAccountInfo(
      new PublicKey(CONFIG.PYTH_SOL_USD_MAINNET)
    );
    if (pythAccount) {
      const priceLow = pythAccount.data.readUInt32LE(208);
      const priceHigh = pythAccount.data.readInt32LE(212);
      const rawPrice = BigInt(priceHigh) * BigInt(0x100000000) + BigInt(priceLow);
      const expo = pythAccount.data.readInt32LE(20);
      solPrice = Number(rawPrice) * Math.pow(10, expo);
    }
  } catch (e) {
    console.log("Could not fetch SOL price, using default $120");
  }

  console.log(`\nCurrent SOL Price: $${solPrice.toFixed(2)}`);

  // Transaction costs
  const BASE_TX_FEE = 5000; // 5000 lamports = 0.000005 SOL
  const PRIORITY_FEE = 10000; // Optional priority fee

  console.log("\n" + "─".repeat(60));
  console.log("ACCUMULATOR TRANSACTIONS (7 TX - run periodically)");
  console.log("─".repeat(60));

  let accTotalBytes = 0;
  let accTotalCU = 0;
  let accTotalFee = 0;

  for (const script of SCRIPTS.accumulator) {
    const fee = BASE_TX_FEE + PRIORITY_FEE;
    accTotalBytes += script.bytes;
    accTotalCU += script.cu;
    accTotalFee += fee;
    console.log(`  ${script.name.padEnd(15)} ${script.bytes}b  ${(script.cu/1000).toFixed(0)}K CU  ${(fee/1e9).toFixed(6)} SOL`);
  }

  console.log("─".repeat(60));
  console.log(`  TOTAL:          ${accTotalBytes}b  ${(accTotalCU/1000).toFixed(0)}K CU  ${(accTotalFee/1e9).toFixed(6)} SOL`);
  console.log(`                                      $${(accTotalFee/1e9 * solPrice).toFixed(4)}`);

  console.log("\n" + "─".repeat(60));
  console.log("NEURAL NETWORK TRANSACTIONS (4 TX - per prediction)");
  console.log("─".repeat(60));

  let nnTotalBytes = 0;
  let nnTotalCU = 0;
  let nnTotalFee = 0;

  for (const script of SCRIPTS.nn) {
    const fee = BASE_TX_FEE + PRIORITY_FEE;
    nnTotalBytes += script.bytes;
    nnTotalCU += script.cu;
    nnTotalFee += fee;
    console.log(`  ${script.name.padEnd(15)} ${script.bytes}b  ${(script.cu/1000).toFixed(0)}K CU  ${(fee/1e9).toFixed(6)} SOL`);
  }

  console.log("─".repeat(60));
  console.log(`  TOTAL:          ${nnTotalBytes}b  ${(nnTotalCU/1000).toFixed(0)}K CU  ${(nnTotalFee/1e9).toFixed(6)} SOL`);
  console.log(`                                      $${(nnTotalFee/1e9 * solPrice).toFixed(4)}`);

  // Account creation costs
  const ACCOUNT_RENT = 0.002; // ~0.002 SOL per account

  console.log("\n" + "─".repeat(60));
  console.log("ONE-TIME SETUP COSTS");
  console.log("─".repeat(60));
  console.log(`  Accumulator account (48b):    ~0.001 SOL`);
  console.log(`  Scratch1 account (32b):       ~0.001 SOL`);
  console.log(`  Scratch2 account (32b):       ~0.001 SOL`);
  console.log("─".repeat(60));
  console.log(`  TOTAL:                        ~0.003 SOL ($${(0.003 * solPrice).toFixed(2)})`);

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));

  const totalTX = 11;
  const totalBytes = accTotalBytes + nnTotalBytes;
  const totalCU = accTotalCU + nnTotalCU;
  const totalFee = accTotalFee + nnTotalFee;

  console.log(`
┌────────────────────────────────────────────────────────┐
│ FULL PIPELINE (11 TX)                                  │
├────────────────────────────────────────────────────────┤
│ Total Bytecode:     ${totalBytes.toString().padStart(6)} bytes                       │
│ Total Compute:      ${(totalCU/1000).toFixed(0).padStart(6)}K CU                          │
│ Transaction Fees:   ${(totalFee/1e9).toFixed(6)} SOL ($${(totalFee/1e9 * solPrice).toFixed(4)})           │
├────────────────────────────────────────────────────────┤
│ COST BREAKDOWN                                         │
├────────────────────────────────────────────────────────┤
│ Per Crank (7 TX):   ${(accTotalFee/1e9).toFixed(6)} SOL ($${(accTotalFee/1e9 * solPrice).toFixed(4)})           │
│ Per Prediction:     ${(nnTotalFee/1e9).toFixed(6)} SOL ($${(nnTotalFee/1e9 * solPrice).toFixed(4)})           │
├────────────────────────────────────────────────────────┤
│ DAILY COSTS (crank every minute)                       │
├────────────────────────────────────────────────────────┤
│ Cranks (1440/day):  ${(accTotalFee/1e9 * 1440).toFixed(4)} SOL ($${(accTotalFee/1e9 * 1440 * solPrice).toFixed(2)})            │
│ 100 predictions:    ${(nnTotalFee/1e9 * 100).toFixed(4)} SOL ($${(nnTotalFee/1e9 * 100 * solPrice).toFixed(2)})             │
└────────────────────────────────────────────────────────┘

DEVNET ADDRESSES:
  Pyth SOL/USD:    ${CONFIG.PYTH_SOL_USD_DEVNET}
  Raydium AMM:     ${CONFIG.RAYDIUM_AMM_DEVNET}
  USDC Token:      ${CONFIG.USDC_DEVNET}

MAINNET ADDRESSES:
  Pyth SOL/USD:    ${CONFIG.PYTH_SOL_USD_MAINNET}
  Raydium SOL:     ${CONFIG.RAYDIUM_SOL_VAULT_MAINNET}
  Raydium USDC:    ${CONFIG.RAYDIUM_USDC_VAULT_MAINNET}
`);
}

calculateCosts().catch(console.error);
