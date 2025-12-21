/**
 * Test reading real Pyth price data on Devnet
 */

const { Connection, PublicKey } = require("@solana/web3.js");

const CONFIG = {
  DEVNET_RPC: "https://api.devnet.solana.com",
  PYTH_SOL_USD_DEVNET: "J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix",
};

async function testPythDevnet() {
  console.log("=".repeat(60));
  console.log("Testing Pyth SOL/USD Feed on Devnet");
  console.log("=".repeat(60));

  const connection = new Connection(CONFIG.DEVNET_RPC, "confirmed");
  const pythPubkey = new PublicKey(CONFIG.PYTH_SOL_USD_DEVNET);

  console.log(`\nPyth Account: ${pythPubkey.toBase58()}`);

  try {
    const accountInfo = await connection.getAccountInfo(pythPubkey);

    if (!accountInfo) {
      console.log("Account not found!");
      return;
    }

    console.log(`\nAccount Size: ${accountInfo.data.length} bytes`);
    console.log(`Owner: ${accountInfo.owner.toBase58()}`);

    const data = accountInfo.data;

    // Parse Pyth price structure
    // Magic at offset 0
    const magic = data.readUInt32LE(0);
    console.log(`\nMagic: 0x${magic.toString(16)}`);

    // Version at offset 4
    const version = data.readUInt32LE(4);
    console.log(`Version: ${version}`);

    // Expo at offset 20
    const expo = data.readInt32LE(20);
    console.log(`Exponent: ${expo}`);

    // Price at offset 208 (i64)
    const priceLow = data.readUInt32LE(208);
    const priceHigh = data.readInt32LE(212);
    const rawPrice = BigInt(priceHigh) * BigInt(0x100000000) + BigInt(priceLow);
    console.log(`Raw Price: ${rawPrice}`);

    // Actual price
    const actualPrice = Number(rawPrice) * Math.pow(10, expo);
    console.log(`\n>>> SOL/USD Price: $${actualPrice.toFixed(4)} <<<`);

    // Confidence at offset 216
    const confLow = data.readUInt32LE(216);
    const confHigh = data.readUInt32LE(220);
    const rawConf = BigInt(confHigh) * BigInt(0x100000000) + BigInt(confLow);
    const confidence = Number(rawConf) * Math.pow(10, expo);
    console.log(`Confidence: ±$${confidence.toFixed(4)}`);

    // Status at offset 224
    const status = data.readUInt32LE(224);
    const statusNames = ["Unknown", "Trading", "Halted", "Auction"];
    console.log(`Status: ${statusNames[status] || status}`);

    // Last updated slot
    const slot = data.readBigUInt64LE(232);
    console.log(`Last Update Slot: ${slot}`);

    // Show raw bytes for Python script verification
    console.log("\n--- Raw bytes for Python script ---");
    console.log(`Offset 20 (expo):  [${Array.from(data.slice(20, 24)).join(", ")}]`);
    console.log(`Offset 208 (price): [${Array.from(data.slice(208, 216)).join(", ")}]`);

    // Calculate what our Python script would return
    const pythCents = Math.floor(Number(rawPrice) / 10000);
    console.log(`\nPython script price (cents): ${pythCents} ($${(pythCents/100).toFixed(2)})`);

    console.log("\n" + "=".repeat(60));
    console.log("SUCCESS - Pyth devnet feed is working!");
    console.log("=".repeat(60));

  } catch (e) {
    console.error("Error:", e.message);
  }
}

testPythDevnet().catch(console.error);
