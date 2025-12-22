/**
 * Test NN with PERSISTENT weights on-chain
 *
 * Architecture:
 * - Account 0: Weights (65 bytes, deployed ONCE)
 * - Account 1: User features (6 bytes, user provides)
 * - Account 2: Hidden state (8 bytes, temp)
 *
 * User sends: 1 TX with 6 bytes features
 * Gets back: UP (1) or DOWN (0)
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
  MODE_EXECUTE_BYTECODE: 0x02,
  MODE_WRITE_ACCOUNT: 0x03,
};

const COMPILER = "/Users/true/Documents/Pipeline/CasterCorp/modelonSolana/solanapython-build/solana/tools/pika_compile";
const PYTHON_DIR = path.join(__dirname, "../python");
const WEIGHTS_PATH = path.join(__dirname, "../../weights/optimal_model.bin");

function loadKeypair() {
  const keypairPath = path.join(process.env.HOME, ".config", "solana", "id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath))));
}

function compilePythonFile(filename) {
  const pyPath = path.join(PYTHON_DIR, filename);
  const tempBin = "/tmp/" + filename.replace(".py", ".bin");
  execSync(`${COMPILER} -f ${pyPath} -o ${tempBin}`, { stdio: "pipe" });
  return fs.readFileSync(tempBin);
}

async function writeToAccount(connection, payer, programId, account, data) {
  const ix = new TransactionInstruction({
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: account, isSigner: false, isWritable: true },
    ],
    programId,
    data: Buffer.concat([Buffer.from([CONFIG.MODE_WRITE_ACCOUNT]), data]),
  });

  const tx = new Transaction().add(ix);
  return sendAndConfirmTransaction(connection, tx, [payer], {
    skipPreflight: true,
    commitment: "confirmed",
  });
}

async function executePython(connection, payer, programId, bytecode, accounts) {
  const keys = [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }];
  accounts.forEach((acc) => {
    keys.push({ pubkey: acc.pubkey, isSigner: false, isWritable: acc.writable });
  });

  const ix = new TransactionInstruction({
    keys,
    programId,
    data: Buffer.concat([Buffer.from([CONFIG.MODE_EXECUTE_BYTECODE]), bytecode]),
  });

  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }))
    .add(ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }))
    .add(ix);

  const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
    skipPreflight: true,
    commitment: "confirmed",
  });

  const txInfo = await connection.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  return {
    sig,
    cu: txInfo?.meta?.computeUnitsConsumed || 0,
    returnData: txInfo?.meta?.returnData?.data?.[0]
      ? Buffer.from(txInfo.meta.returnData.data[0], "base64").toString("utf8")
      : null,
  };
}

async function main() {
  console.log("═".repeat(60));
  console.log("  PERSISTENT NN TEST - 1 TX INFERENCE");
  console.log("═".repeat(60));

  const connection = new Connection(CONFIG.DEVNET_RPC, "confirmed");
  const payer = loadKeypair();
  const programId = new PublicKey(CONFIG.PROGRAM_ID);

  console.log("\nPayer:", payer.publicKey.toBase58());

  // === PHASE 1: DEPLOY WEIGHTS (ONE TIME) ===
  console.log("\n─ Phase 1: Deploy Weights (one-time) ─");

  const weightsAcc = Keypair.generate();
  const featuresAcc = Keypair.generate();
  const hiddenAcc = Keypair.generate();

  const lamports = await connection.getMinimumBalanceForRentExemption(128);

  // Create accounts
  const createTx = new Transaction()
    .add(SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: weightsAcc.publicKey,
      lamports,
      space: 128,
      programId,
    }))
    .add(SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: featuresAcc.publicKey,
      lamports,
      space: 128,
      programId,
    }))
    .add(SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: hiddenAcc.publicKey,
      lamports,
      space: 128,
      programId,
    }));

  await sendAndConfirmTransaction(connection, createTx, [payer, weightsAcc, featuresAcc, hiddenAcc]);

  console.log("  Weights:  ", weightsAcc.publicKey.toBase58().slice(0, 20) + "...");
  console.log("  Features: ", featuresAcc.publicKey.toBase58().slice(0, 20) + "...");
  console.log("  Hidden:   ", hiddenAcc.publicKey.toBase58().slice(0, 20) + "...");

  // Write weights to account
  const weights = fs.readFileSync(WEIGHTS_PATH);
  console.log(`  Writing ${weights.length} bytes of weights...`);

  await writeToAccount(connection, payer, programId, weightsAcc.publicKey, weights);
  console.log("  ✓ Weights deployed!");

  // === PHASE 2: USER INFERENCE (REPEATABLE) ===
  console.log("\n─ Phase 2: User Inference (1 TX) ─");

  // Simulate user features
  const userFeatures = Buffer.from([
    128 + Math.floor((Math.random() - 0.5) * 16),  // sma_ratio
    128 + Math.floor((Math.random() - 0.5) * 30),  // momentum
    Math.floor(Math.random() * 40),                 // volatility
    128 + Math.floor((Math.random() - 0.5) * 25),  // trend
    80 + Math.floor(Math.random() * 95),            // rsi_like
    50 + Math.floor(Math.random() * 155),           // position
  ]);

  console.log(`  User features: [${Array.from(userFeatures).join(", ")}]`);

  // Write user features to account
  await writeToAccount(connection, payer, programId, featuresAcc.publicKey, userFeatures);

  // Execute NN (single TX!)
  console.log("\n  Executing NN inference...");
  const bytecode = compilePythonFile("nn_persistent_full.py");
  console.log(`  Bytecode: ${bytecode.length} bytes`);

  const result = await executePython(connection, payer, programId, bytecode, [
    { pubkey: weightsAcc.publicKey, writable: false },
    { pubkey: featuresAcc.publicKey, writable: false },
    { pubkey: hiddenAcc.publicKey, writable: true },
  ]);

  const prediction = parseInt(result.returnData);

  console.log("\n" + "═".repeat(60));
  console.log("  RESULT");
  console.log("═".repeat(60));
  console.log(`  Prediction:  ${prediction === 1 ? "UP ↑" : "DOWN ↓"}`);
  console.log(`  CU Used:     ${result.cu.toLocaleString()}`);
  console.log(`  TX Count:    1 (inference only)`);
  console.log("═".repeat(60));
  console.log("\n  Note: Weights account can be reused for all future predictions!");
}

main().catch(console.error);
