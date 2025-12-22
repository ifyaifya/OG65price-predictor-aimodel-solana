/**
 * User Inference Script - NN On-Chain
 *
 * Usage:
 *   node user_inference.js [features]
 *   node user_inference.js 128,135,20,130,150,100
 *
 * Flow:
 *   TX1: Write features to features account
 *   TX2: Import NN module (executes on import)
 */

const {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
} = require("@solana/web3.js");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const CONFIG = require("./config");

function loadKeypair() {
  const keypairPath = path.join(process.env.HOME, ".config", "solana", "id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath))));
}

function compilePython(code) {
  const tempPy = "/tmp/inference_temp.py";
  fs.writeFileSync(tempPy, code);
  const tempBin = "/tmp/inference_temp.bin";
  execSync(`${CONFIG.COMPILER} -f ${tempPy} -o ${tempBin}`, { stdio: "pipe" });
  return fs.readFileSync(tempBin);
}

async function writeFeatures(connection, payer, programId, account, features) {
  const offsetBuf = Buffer.alloc(2);
  offsetBuf.writeUInt16LE(0);

  const ix = new TransactionInstruction({
    keys: [{ pubkey: account, isSigner: false, isWritable: true }],
    programId,
    data: Buffer.concat([Buffer.from([CONFIG.MODE_WRITE_ACCOUNT]), offsetBuf, Buffer.from(features)]),
  });

  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }))
    .add(ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }))
    .add(ix);

  return await sendAndConfirmTransaction(connection, tx, [payer], {
    skipPreflight: true,
    commitment: "confirmed",
  });
}

async function runInference(connection, payer, programId, moduleAcc, weightsAcc, featuresAcc) {
  // Just import sol_1 - the module code executes on import
  const importCode = `import sol_1`;
  const importBytecode = compilePython(importCode);

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: moduleAcc, isSigner: false, isWritable: false },
      { pubkey: weightsAcc, isSigner: false, isWritable: false },
      { pubkey: featuresAcc, isSigner: false, isWritable: false },
    ],
    programId,
    data: Buffer.concat([Buffer.from([CONFIG.MODE_EXECUTE_BYTECODE]), importBytecode]),
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

  let prediction = null;
  let cu = 0;
  for (const log of txInfo?.meta?.logMessages || []) {
    if (log.includes("Program log: 1") && !log.includes("/")) prediction = 1;
    if (log.includes("Program log: 0") && !log.includes("/")) prediction = 0;
    const cuMatch = log.match(/consumed (\d+) of/);
    if (cuMatch) cu = parseInt(cuMatch[1]);
  }

  return { sig, prediction, cu, logs: txInfo?.meta?.logMessages || [] };
}

async function main() {
  console.log("═".repeat(60));
  console.log("  NN ON-CHAIN INFERENCE (6→8→1)");
  console.log("═".repeat(60));

  const deploymentPath = path.join(__dirname, "../../deployment.json");
  if (!fs.existsSync(deploymentPath)) {
    console.error("Error: deployment.json not found. Run deploy_model.js first.");
    process.exit(1);
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentPath));
  console.log("\nDeployment:");
  console.log(`  Module:   ${deployment.accounts.module}`);
  console.log(`  Weights:  ${deployment.accounts.weights}`);
  console.log(`  Features: ${deployment.accounts.features}`);

  let features;
  if (process.argv[2]) {
    features = process.argv[2].split(",").map(Number);
  } else {
    features = [128, 135, 20, 130, 150, 100];
  }

  if (features.length !== 6) {
    console.error("Error: Exactly 6 features required");
    process.exit(1);
  }

  console.log(`\nInput: [${features.join(", ")}]`);

  const connection = new Connection(CONFIG.DEVNET_RPC || "https://api.devnet.solana.com", "confirmed");
  const payer = loadKeypair();
  const programId = new PublicKey(CONFIG.PROGRAM_ID);
  const moduleAcc = new PublicKey(deployment.accounts.module);
  const weightsAcc = new PublicKey(deployment.accounts.weights);
  const featuresAcc = new PublicKey(deployment.accounts.features);

  console.log("\n─ TX1: Writing Features ─");
  await writeFeatures(connection, payer, programId, featuresAcc, features);
  console.log("  ✓ Features written");

  console.log("\n─ TX2: Running Inference ─");
  const result = await runInference(connection, payer, programId, moduleAcc, weightsAcc, featuresAcc);
  console.log(`  ✓ CU: ${result.cu.toLocaleString()}`);

  console.log("\n" + "═".repeat(60));
  if (result.prediction === 1) {
    console.log("  📈 PREDICTION: UP");
  } else if (result.prediction === 0) {
    console.log("  📉 PREDICTION: DOWN");
  } else {
    console.log("  ❓ PREDICTION: Unknown");
    console.log("  Logs:", result.logs.slice(-5));
  }
  console.log("═".repeat(60));
}

main().catch(console.error);
