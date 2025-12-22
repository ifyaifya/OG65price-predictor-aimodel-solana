/**
 * Crank Script - Periodically updates the feature accumulator on-chain
 *
 * Executes the 7 accumulator transactions in sequence:
 * TX1: accum_v2_p1  - Read Pyth, shift prices
 * TX2: acc_sma      - Calculate SMA
 * TX3: acc_vol_a    - Calculate volatility
 * TX4: acc_mom      - Calculate momentum
 * TX5: acc_ray_liq  - Read Raydium liquidity
 * TX6: acc_dex_price - Calculate DEX price
 * TX7: acc_spread   - Calculate Pyth/DEX spread
 */

const {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
  SystemProgram,
} = require("@solana/web3.js");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const CONFIG = {
  DEVNET_RPC: "https://api.devnet.solana.com",
  MAINNET_RPC: "https://api.mainnet-beta.solana.com",
  PROGRAM_ID: "AdvFUgScZPQmnkhCZ1ZFMN7c1rsanoE7TfYbikggUAxM",

  // Mainnet accounts (for reading)
  PYTH_SOL_USD: "H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG",
  RAYDIUM_SOL_VAULT: "DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz",
  RAYDIUM_USDC_VAULT: "HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz",

  // Crank interval
  INTERVAL_MS: 60000,  // 1 minute

  MODE_EXECUTE_BYTECODE: 0x02,
};

const COMPILER = process.env.PIKA_COMPILE ||
  "/Users/true/Documents/Pipeline/CasterCorp/modelonSolana/solanapython-build/solana/tools/pika_compile";

// Accumulator scripts in order
const ACCUMULATOR_SCRIPTS = [
  { name: "accum_v2_p1", file: "src/python/accum_v2_p1.py", accounts: ["pyth", "accumulator"] },
  { name: "acc_sma", file: "src/python/acc_sma.py", accounts: ["accumulator"] },
  { name: "acc_vol_a", file: "src/python/acc_vol_a.py", accounts: ["accumulator"] },
  { name: "acc_mom", file: "src/python/acc_mom.py", accounts: ["accumulator"] },
  { name: "acc_ray_liq", file: "src/python/acc_ray_liq.py", accounts: ["raydium_sol", "accumulator"] },
  { name: "acc_dex_price", file: "src/python/acc_dex_price.py", accounts: ["raydium_sol", "raydium_usdc", "accumulator"] },
  { name: "acc_spread", file: "src/python/acc_spread.py", accounts: ["accumulator"] },
];

function loadKeypair() {
  const keypairPath = path.join(process.env.HOME, ".config", "solana", "id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath))));
}

function compilePython(scriptPath) {
  const tempBin = `/tmp/${path.basename(scriptPath, ".py")}.bin`;
  execSync(`${COMPILER} -f ${scriptPath} -o ${tempBin}`, { stdio: "pipe" });
  return fs.readFileSync(tempBin);
}

async function createAccumulatorAccount(connection, payer, programId) {
  // Create a PDA for the accumulator
  const [accumulatorPda, bump] = await PublicKey.findProgramAddress(
    [Buffer.from("accumulator"), payer.publicKey.toBuffer()],
    programId
  );
  return accumulatorPda;
}

async function executePythonScript(connection, payer, programId, bytecode, accountPubkeys) {
  const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 500000 });

  // Build instruction data
  const data = Buffer.concat([
    Buffer.from([CONFIG.MODE_EXECUTE_BYTECODE]),
    Buffer.from([bytecode.length & 0xff, (bytecode.length >> 8) & 0xff]),
    bytecode,
  ]);

  // Build account metas
  const keys = accountPubkeys.map((pubkey, i) => ({
    pubkey,
    isSigner: false,
    isWritable: i === accountPubkeys.length - 1,  // Last account is writable (accumulator)
  }));

  const ix = new TransactionInstruction({
    keys,
    programId,
    data,
  });

  const tx = new Transaction().add(computeIx).add(ix);
  tx.feePayer = payer.publicKey;

  const signature = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: "confirmed",
  });

  return signature;
}

async function runCrankCycle(connection, payer, programId, accumulatorPubkey, accountMap) {
  console.log(`\n[${new Date().toISOString()}] Running crank cycle...`);

  for (const script of ACCUMULATOR_SCRIPTS) {
    try {
      // Compile script
      const bytecode = compilePython(script.file);

      // Map account names to pubkeys
      const accountPubkeys = script.accounts.map(name => accountMap[name]);

      // Execute
      console.log(`  ${script.name}...`);
      const sig = await executePythonScript(connection, payer, programId, bytecode, accountPubkeys);
      console.log(`    ✓ ${sig.slice(0, 20)}...`);

    } catch (e) {
      console.log(`    ✗ ${script.name}: ${e.message}`);
    }
  }
}

async function readAccumulatorState(connection, accumulatorPubkey) {
  try {
    const info = await connection.getAccountInfo(accumulatorPubkey);
    if (!info) return null;

    const data = info.data;
    return {
      lastPrice: data.readUInt32LE(0),
      prevPrice1: data.readUInt32LE(4),
      prevPrice2: data.readUInt32LE(8),
      prevPrice3: data.readUInt32LE(12),
      sma: data.readUInt32LE(16),
      volatility: data[20],
      momentum: data[21],
      liquidity: data[22],
      spread: data[23],
      dexPrice: data.readUInt32LE(24),
    };
  } catch {
    return null;
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("Crank Service - Feature Accumulator Updater");
  console.log("=".repeat(60));

  const connection = new Connection(CONFIG.DEVNET_RPC, "confirmed");
  const payer = loadKeypair();
  const programId = new PublicKey(CONFIG.PROGRAM_ID);

  console.log(`\nPayer: ${payer.publicKey.toBase58()}`);
  console.log(`Program: ${programId.toBase58()}`);

  // Check balance
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Balance: ${(balance / 1e9).toFixed(4)} SOL`);

  if (balance < 0.1 * 1e9) {
    console.log("\n⚠️  Low balance! Consider airdropping more SOL on devnet");
  }

  // Create or get accumulator account
  // For demo, we'll use a regular account
  const accumulatorKeypair = Keypair.generate();
  console.log(`\nAccumulator: ${accumulatorKeypair.publicKey.toBase58()}`);

  // Account mapping
  const accountMap = {
    pyth: new PublicKey(CONFIG.PYTH_SOL_USD),
    raydium_sol: new PublicKey(CONFIG.RAYDIUM_SOL_VAULT),
    raydium_usdc: new PublicKey(CONFIG.RAYDIUM_USDC_VAULT),
    accumulator: accumulatorKeypair.publicKey,
  };

  console.log(`\nInterval: ${CONFIG.INTERVAL_MS}ms`);
  console.log("Press Ctrl+C to stop\n");

  // Initial run
  await runCrankCycle(connection, payer, programId, accumulatorKeypair.publicKey, accountMap);

  // Periodic runs
  setInterval(async () => {
    await runCrankCycle(connection, payer, programId, accumulatorKeypair.publicKey, accountMap);

    // Read and display state
    const state = await readAccumulatorState(connection, accumulatorKeypair.publicKey);
    if (state) {
      console.log(`  State: price=${state.lastPrice} sma=${state.sma} vol=${state.volatility} mom=${state.momentum}`);
    }
  }, CONFIG.INTERVAL_MS);
}

// Single run mode for testing
async function singleRun() {
  console.log("Single crank run (test mode)...\n");

  const connection = new Connection(CONFIG.DEVNET_RPC, "confirmed");
  const payer = loadKeypair();

  console.log(`Payer: ${payer.publicKey.toBase58()}`);

  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Balance: ${(balance / 1e9).toFixed(4)} SOL\n`);

  // Just compile and show bytecode sizes
  console.log("Compiling accumulator scripts:\n");
  for (const script of ACCUMULATOR_SCRIPTS) {
    try {
      const bytecode = compilePython(script.file);
      console.log(`  ✓ ${script.name}: ${bytecode.length} bytes`);
    } catch (e) {
      console.log(`  ✗ ${script.name}: ${e.message}`);
    }
  }
}

// Check args
if (process.argv.includes("--test")) {
  singleRun().catch(console.error);
} else {
  main().catch(console.error);
}
