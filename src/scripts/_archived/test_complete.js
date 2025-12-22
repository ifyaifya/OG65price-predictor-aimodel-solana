/**
 * Complete E2E Test with Real Pyth Devnet Data
 *
 * Executes the full pipeline:
 * 1. Read real SOL/USD price from Pyth devnet
 * 2. Run all 7 accumulator transactions
 * 3. Run all 4 neural network transactions
 * 4. Output prediction
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
  PROGRAM_ID: "AdvFUgScZPQmnkhCZ1ZFMN7c1rsanoE7TfYbikggUAxM",

  // Real Pyth devnet account
  PYTH_SOL_USD_DEVNET: "J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix",

  MODE_EXECUTE_BYTECODE: 0x02,
};

const COMPILER = process.env.PIKA_COMPILE ||
  "/Users/true/Documents/Pipeline/CasterCorp/modelonSolana/solanapython-build/solana/tools/pika_compile";

// All scripts with proper account mappings
const SCRIPTS = {
  accumulator: [
    { name: "1.Pyth→Acc", file: "src/python/accum_v2_p1.py", accounts: ["pyth", "accumulator"], writes: [1] },
    { name: "2.SMA", file: "src/python/acc_sma.py", accounts: ["accumulator"], writes: [0] },
    { name: "3.Vol", file: "src/python/acc_vol_a.py", accounts: ["accumulator"], writes: [0] },
    { name: "4.Mom", file: "src/python/acc_mom.py", accounts: ["accumulator"], writes: [0] },
    { name: "5.Liq", file: "src/python/acc_ray_liq.py", accounts: ["raydium_sol", "accumulator"], writes: [1] },
    { name: "6.DEX", file: "src/python/acc_dex_price.py", accounts: ["raydium_sol", "raydium_usdc", "accumulator"], writes: [2] },
    { name: "7.Spread", file: "src/python/acc_spread.py", accounts: ["accumulator"], writes: [0] },
  ],
  nn: [
    { name: "8.Feat", file: "src/python/nn6_feat.py", accounts: ["accumulator", "scratch1"], writes: [1] },
    { name: "9.H0H1", file: "src/python/nn6_h0h1.py", accounts: ["scratch1", "scratch2"], writes: [1] },
    { name: "10.H2", file: "src/python/nn6_h2.py", accounts: ["scratch1", "scratch2"], writes: [1] },
    { name: "11.Dec", file: "src/python/price_6_3_s2.py", accounts: ["scratch2"], writes: [] },
  ],
};

function loadKeypair() {
  const keypairPath = path.join(process.env.HOME, ".config", "solana", "id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath))));
}

function compilePython(scriptPath) {
  const tempBin = `/tmp/${path.basename(scriptPath, ".py")}.bin`;
  execSync(`${COMPILER} -f ${scriptPath} -o ${tempBin}`, { stdio: "pipe" });
  return fs.readFileSync(tempBin);
}

async function createAccount(connection, payer, size, programId) {
  const account = Keypair.generate();
  const lamports = await connection.getMinimumBalanceForRentExemption(size);

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: account.publicKey,
      lamports,
      space: size,
      programId, // Account owned by our program for write access
    })
  );

  await sendAndConfirmTransaction(connection, tx, [payer, account]);
  return account;
}

async function initializeSimulatedVault(connection, payer, programId, account, amount) {
  // Write simulated token balance at offset 64
  const data = Buffer.alloc(128);
  data.writeBigUInt64LE(BigInt(amount), 64);

  // Use a simple write script
  const bytesStr = Array.from(data.slice(0, 72)).join(",");
  const writeCode = `f=open("/sol/1","r+b")\nf.write(bytes([${bytesStr}]))\nf.close()\n1`;

  const tempPy = "/tmp/init_vault.py";
  fs.writeFileSync(tempPy, writeCode);
  const bytecode = compilePython(tempPy);

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: account.publicKey, isSigner: false, isWritable: true },
    ],
    programId,
    data: Buffer.concat([Buffer.from([CONFIG.MODE_EXECUTE_BYTECODE]), bytecode]),
  });

  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }))
    .add(ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }))
    .add(ix);

  await sendAndConfirmTransaction(connection, tx, [payer], { skipPreflight: true });
}

async function executeScript(connection, payer, programId, bytecode, accountPubkeys, writes) {
  const keys = [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    ...accountPubkeys.map((pubkey, i) => ({
      pubkey,
      isSigner: false,
      isWritable: writes.includes(i),
    })),
  ];

  const data = Buffer.alloc(1 + bytecode.length);
  data.writeUInt8(CONFIG.MODE_EXECUTE_BYTECODE, 0);
  bytecode.copy(data, 1);

  const ix = new TransactionInstruction({ keys, programId, data });

  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500000 }))
    .add(ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }))
    .add(ix);

  const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: "confirmed",
    skipPreflight: true,
  });

  // Get compute units used
  const txInfo = await connection.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  return {
    signature: sig,
    cu: txInfo?.meta?.computeUnitsConsumed || 0,
  };
}

async function readPythPrice(connection) {
  const pythAccount = await connection.getAccountInfo(
    new PublicKey(CONFIG.PYTH_SOL_USD_DEVNET)
  );

  if (!pythAccount) return null;

  const data = pythAccount.data;
  const priceLow = data.readUInt32LE(208);
  const priceHigh = data.readInt32LE(212);
  const rawPrice = BigInt(priceHigh) * BigInt(0x100000000) + BigInt(priceLow);
  const expo = data.readInt32LE(20);

  return {
    raw: rawPrice,
    price: Number(rawPrice) * Math.pow(10, expo),
    cents: Number(rawPrice) / 1000000,
  };
}

async function readAccumulatorState(connection, accPubkey) {
  const info = await connection.getAccountInfo(accPubkey);
  if (!info || info.data.length < 28) return null;

  const d = info.data;
  return {
    lastPrice: d.readUInt32LE(0),
    prevPrice1: d.readUInt32LE(4),
    prevPrice2: d.readUInt32LE(8),
    prevPrice3: d.readUInt32LE(12),
    sma: d.readUInt32LE(16),
    volatility: d[20],
    momentum: d[21],
    liquidity: d[22],
    spread: d[23],
    dexPrice: d.readUInt32LE(24),
  };
}

async function readScratchState(connection, scratchPubkey) {
  const info = await connection.getAccountInfo(scratchPubkey);
  if (!info || info.data.length < 6) return null;

  const d = info.data;
  return {
    h0: d.readUInt16LE(0),
    h1: d.readUInt16LE(2),
    h2: d.readUInt16LE(4),
  };
}

async function main() {
  console.log("═".repeat(60));
  console.log("  COMPLETE E2E TEST - Real Pyth Devnet Data");
  console.log("═".repeat(60));

  const connection = new Connection(CONFIG.DEVNET_RPC, "confirmed");
  const payer = loadKeypair();
  const programId = new PublicKey(CONFIG.PROGRAM_ID);

  // Check balance
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`\nPayer: ${payer.publicKey.toBase58()}`);
  console.log(`Balance: ${(balance / 1e9).toFixed(4)} SOL`);

  if (balance < 0.5 * 1e9) {
    console.log("\n⚠️  Requesting airdrop...");
    const sig = await connection.requestAirdrop(payer.publicKey, 1e9);
    await connection.confirmTransaction(sig);
  }

  // Read real Pyth price
  console.log("\n─ Reading Real Pyth Price ─");
  const pythPrice = await readPythPrice(connection);
  console.log(`  Pyth SOL/USD: $${pythPrice.price.toFixed(2)}`);
  console.log(`  Price in cents: ${pythPrice.cents.toFixed(0)}`);

  // Create accounts
  console.log("\n─ Creating Accounts ─");

  const accounts = {};

  // Use real Pyth account
  accounts.pyth = { publicKey: new PublicKey(CONFIG.PYTH_SOL_USD_DEVNET) };
  console.log(`  Pyth (real):     ${accounts.pyth.publicKey.toBase58().slice(0, 20)}...`);

  // Create simulated Raydium vaults
  accounts.raydium_sol = await createAccount(connection, payer, 128, programId);
  console.log(`  Raydium SOL:     ${accounts.raydium_sol.publicKey.toBase58().slice(0, 20)}...`);

  accounts.raydium_usdc = await createAccount(connection, payer, 128, programId);
  console.log(`  Raydium USDC:    ${accounts.raydium_usdc.publicKey.toBase58().slice(0, 20)}...`);

  // Initialize with realistic values
  // SOL vault: 35,000 SOL = 35000 * 1e9 lamports
  // USDC vault: 4,900,000 USDC = 4900000 * 1e6 (gives ~$140 price)
  console.log("\n─ Initializing Simulated Vaults ─");
  await initializeSimulatedVault(connection, payer, programId, accounts.raydium_sol, 35000n * 1000000000n);
  console.log(`  SOL vault:  35,000 SOL`);
  await initializeSimulatedVault(connection, payer, programId, accounts.raydium_usdc, 4900000n * 1000000n);
  console.log(`  USDC vault: 4,900,000 USDC`);
  console.log(`  DEX price:  ~$140`);

  // Create accumulator and scratch accounts
  accounts.accumulator = await createAccount(connection, payer, 64, programId);
  console.log(`  Accumulator:     ${accounts.accumulator.publicKey.toBase58().slice(0, 20)}...`);

  accounts.scratch1 = await createAccount(connection, payer, 32, programId);
  accounts.scratch2 = await createAccount(connection, payer, 32, programId);
  console.log(`  Scratch1/2:      created`);

  // Execute accumulator transactions
  console.log("\n─ Accumulator Transactions (7 TX) ─");
  let totalCU = 0;

  for (const script of SCRIPTS.accumulator) {
    const bytecode = compilePython(script.file);
    const pubkeys = script.accounts.map(name => accounts[name].publicKey);

    process.stdout.write(`  ${script.name.padEnd(12)}`);

    try {
      const result = await executeScript(connection, payer, programId, bytecode, pubkeys, script.writes);
      console.log(`✓ ${result.cu.toLocaleString().padStart(8)} CU`);
      totalCU += result.cu;
    } catch (e) {
      console.log(`✗ ${e.message.slice(0, 40)}`);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  // Read accumulator state
  console.log("\n─ Accumulator State ─");
  const accState = await readAccumulatorState(connection, accounts.accumulator.publicKey);
  if (accState) {
    console.log(`  Last Price:  ${accState.lastPrice} cents ($${(accState.lastPrice/100).toFixed(2)})`);
    console.log(`  SMA:         ${accState.sma} cents`);
    console.log(`  Volatility:  ${accState.volatility}`);
    console.log(`  Momentum:    ${accState.momentum} (128=neutral)`);
    console.log(`  Liquidity:   ${accState.liquidity}`);
    console.log(`  DEX Price:   ${accState.dexPrice} cents`);
    console.log(`  Spread:      ${accState.spread} (128=neutral)`);
  }

  // Execute NN transactions
  console.log("\n─ Neural Network Transactions (4 TX) ─");

  for (const script of SCRIPTS.nn) {
    const bytecode = compilePython(script.file);
    const pubkeys = script.accounts.map(name => accounts[name].publicKey);

    process.stdout.write(`  ${script.name.padEnd(12)}`);

    try {
      const result = await executeScript(connection, payer, programId, bytecode, pubkeys, script.writes);
      console.log(`✓ ${result.cu.toLocaleString().padStart(8)} CU`);
      totalCU += result.cu;
    } catch (e) {
      console.log(`✗ ${e.message.slice(0, 40)}`);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  // Read hidden state
  console.log("\n─ Hidden Layer State ─");
  const hiddenState = await readScratchState(connection, accounts.scratch2.publicKey);
  if (hiddenState) {
    console.log(`  h0: ${hiddenState.h0}`);
    console.log(`  h1: ${hiddenState.h1}`);
    console.log(`  h2: ${hiddenState.h2}`);
  }

  // Final summary
  console.log("\n" + "═".repeat(60));
  console.log("  RESULTS");
  console.log("═".repeat(60));
  console.log(`
  Pyth Price:      $${pythPrice.price.toFixed(2)}
  DEX Price:       $${accState ? (accState.dexPrice/100).toFixed(2) : 'N/A'}
  Total CU:        ${totalCU.toLocaleString()}

  Features extracted:
    price_vs_sma:    ${accState ? accState.lastPrice - accState.sma : 'N/A'}
    momentum:        ${accState ? accState.momentum : 'N/A'}
    volatility:      ${accState ? accState.volatility : 'N/A'}
    liquidity:       ${accState ? accState.liquidity : 'N/A'}
    spread:          ${accState ? accState.spread - 128 : 'N/A'}%
`);

  console.log("═".repeat(60));
}

main().catch(console.error);
