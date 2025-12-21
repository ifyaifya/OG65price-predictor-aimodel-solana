/**
 * Test reading Raydium pool reserves on-chain via SolanaPython
 *
 * This demonstrates reading SOL/USDC liquidity from Raydium vault accounts.
 */

const {
  Connection,
  PublicKey,
  Keypair,
} = require("@solana/web3.js");
const fs = require("fs");
const path = require("path");

const CONFIG = {
  MAINNET_RPC: "https://api.mainnet-beta.solana.com",

  // Raydium SOL/USDC pool (AMM V4)
  // Pool: 58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2
  RAYDIUM_SOL_USDC_POOL: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2",

  // Vault offsets in LIQUIDITY_STATE_LAYOUT_V4
  BASE_VAULT_OFFSET: 336,
  QUOTE_VAULT_OFFSET: 368,
  BASE_DECIMAL_OFFSET: 32,
  QUOTE_DECIMAL_OFFSET: 40,
};

async function testRaydiumRead() {
  console.log("=".repeat(60));
  console.log("Test: Reading Raydium Pool Data On-Chain");
  console.log("=".repeat(60));

  const connection = new Connection(CONFIG.MAINNET_RPC, "confirmed");
  const poolAddress = new PublicKey(CONFIG.RAYDIUM_SOL_USDC_POOL);

  console.log(`\nPool Address: ${poolAddress.toBase58()}`);

  try {
    // Step 1: Read the AMM pool account to get vault addresses
    console.log("\n--- Reading AMM Pool Account ---");
    const poolInfo = await connection.getAccountInfo(poolAddress);

    if (!poolInfo) {
      console.log("Could not fetch pool account");
      return;
    }

    console.log(`Pool account size: ${poolInfo.data.length} bytes`);
    console.log(`Owner: ${poolInfo.owner.toBase58()}`);

    const data = poolInfo.data;

    // Read decimals
    const baseDecimal = Number(data.readBigUInt64LE(CONFIG.BASE_DECIMAL_OFFSET));
    const quoteDecimal = Number(data.readBigUInt64LE(CONFIG.QUOTE_DECIMAL_OFFSET));
    console.log(`Base decimals: ${baseDecimal}`);
    console.log(`Quote decimals: ${quoteDecimal}`);

    // Read vault public keys
    const baseVaultPubkey = new PublicKey(
      data.slice(CONFIG.BASE_VAULT_OFFSET, CONFIG.BASE_VAULT_OFFSET + 32)
    );
    const quoteVaultPubkey = new PublicKey(
      data.slice(CONFIG.QUOTE_VAULT_OFFSET, CONFIG.QUOTE_VAULT_OFFSET + 32)
    );

    console.log(`\nBase Vault (SOL): ${baseVaultPubkey.toBase58()}`);
    console.log(`Quote Vault (USDC): ${quoteVaultPubkey.toBase58()}`);

    // Step 2: Read vault token accounts
    console.log("\n--- Reading Vault Token Accounts ---");

    const [baseVaultInfo, quoteVaultInfo] = await Promise.all([
      connection.getAccountInfo(baseVaultPubkey),
      connection.getAccountInfo(quoteVaultPubkey),
    ]);

    if (!baseVaultInfo || !quoteVaultInfo) {
      console.log("Could not fetch vault accounts");
      return;
    }

    // Token account amount is at offset 64 (u64)
    const solAmount = baseVaultInfo.data.readBigUInt64LE(64);
    const usdcAmount = quoteVaultInfo.data.readBigUInt64LE(64);

    const solReserve = Number(solAmount) / Math.pow(10, baseDecimal);
    const usdcReserve = Number(usdcAmount) / Math.pow(10, quoteDecimal);

    console.log(`\nSOL Reserve: ${solReserve.toLocaleString()} SOL`);
    console.log(`USDC Reserve: ${usdcReserve.toLocaleString()} USDC`);

    // Calculate spot price
    const spotPrice = usdcReserve / solReserve;
    console.log(`\nSpot Price: $${spotPrice.toFixed(2)} per SOL`);

    // Calculate TVL
    const tvl = usdcReserve * 2; // Assuming balanced pool
    console.log(`TVL (estimated): $${tvl.toLocaleString()}`);

    // Step 3: Show what our Python script would calculate
    console.log("\n--- Python Script Calculation ---");
    const priceInCents = Math.floor((Number(usdcAmount) * 100000) / Number(solAmount));
    console.log(`Price (cents): ${priceInCents} ($${(priceInCents / 100).toFixed(2)})`);

    // Liquidity indicator (log2 of SOL lamports)
    let liq = 0;
    let s = Number(solAmount);
    while (s > 0) {
      liq++;
      s = Math.floor(s / 2);
    }
    if (liq > 255) liq = 255;
    console.log(`Liquidity indicator: ${liq}`);

    const returnValue = priceInCents * 1000 + liq;
    console.log(`Return value: ${returnValue}`);

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("SUMMARY");
    console.log("=".repeat(60));
    console.log(`
For on-chain reading via SolanaPython:

Accounts to pass:
  Account 1: ${baseVaultPubkey.toBase58()} (SOL vault)
  Account 2: ${quoteVaultPubkey.toBase58()} (USDC vault)

These vault addresses are STATIC for this pool and can be hardcoded.

Python script reads:
  - SOL amount at offset 64 of account 1
  - USDC amount at offset 64 of account 2
  - Calculates: price = (usdc * 1000) / sol (in cents)
  - Returns: price * 1000 + liquidity_indicator
`);

    return {
      baseVault: baseVaultPubkey.toBase58(),
      quoteVault: quoteVaultPubkey.toBase58(),
      solReserve,
      usdcReserve,
      spotPrice,
    };

  } catch (e) {
    console.log(`Error: ${e.message}`);
    console.error(e);
  }
}

testRaydiumRead().catch(console.error);
