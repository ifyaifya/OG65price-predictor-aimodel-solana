/**
 * Deploy NN Model On-Chain
 *
 * Deploys:
 * 1. NN Module bytecode (nn_module.py compiled)
 * 2. Trained weights (optimal_model.bin)
 * 3. Features account (for user input)
 *
 * After deployment, users can run inference via:
 *   import sol_0
 *   result = sol_0.predict("/sol/1", "/sol/2")
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
const CONFIG = require("./config");

function loadKeypair() {
  const keypairPath = path.join(process.env.HOME, ".config", "solana", "id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath))));
}

function compilePythonFile(filepath) {
  const tempBin = "/tmp/nn_module_deploy.bin";
  execSync(`${CONFIG.COMPILER} -f ${filepath} -o ${tempBin}`, { stdio: "pipe" });
  return fs.readFileSync(tempBin);
}

function compilePython(code) {
  const tempPy = "/tmp/deploy_temp.py";
  fs.writeFileSync(tempPy, code);
  const tempBin = "/tmp/deploy_temp.bin";
  execSync(`${CONFIG.COMPILER} -f ${tempPy} -o ${tempBin}`, { stdio: "pipe" });
  return fs.readFileSync(tempBin);
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

  return sig;
}

/**
 * Write raw bytes directly to account using MODE 0x03 with offset
 * Format: [0x03] [offset_lo] [offset_hi] [data...]
 */
async function writeAccountDirect(connection, payer, programId, account, data, offset = 0) {
  const offsetBuf = Buffer.alloc(2);
  offsetBuf.writeUInt16LE(offset);

  const ix = new TransactionInstruction({
    keys: [{ pubkey: account, isSigner: false, isWritable: true }],
    programId,
    data: Buffer.concat([Buffer.from([CONFIG.MODE_WRITE_ACCOUNT]), offsetBuf, data]),
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

/**
 * Write large data to account in chunks using MODE 0x03
 */
async function writeToAccountChunked(connection, payer, programId, account, data, chunkSize = 900) {
  const numChunks = Math.ceil(data.length / chunkSize);
  console.log(`  Writing ${data.length} bytes in ${numChunks} chunks...`);

  for (let i = 0; i < numChunks; i++) {
    const offset = i * chunkSize;
    const chunk = data.slice(offset, offset + chunkSize);

    await writeAccountDirect(connection, payer, programId, account, chunk, offset);
    process.stdout.write(`\r  Chunk ${i + 1}/${numChunks} written`);
  }
  console.log(" ✓");
}

async function main() {
  console.log("═".repeat(60));
  console.log("  DEPLOY NN MODEL ON-CHAIN");
  console.log("═".repeat(60));

  const connection = new Connection(CONFIG.DEVNET_RPC, "confirmed");
  const payer = loadKeypair();
  const programId = new PublicKey(CONFIG.PROGRAM_ID);

  console.log("\nPayer:", payer.publicKey.toBase58());

  // Compile NN module
  console.log("\n─ Compiling NN Module ─");
  const modulePath = path.join(__dirname, "../python/nn_module.py");
  const moduleBytecode = compilePythonFile(modulePath);
  console.log(`  Bytecode size: ${moduleBytecode.length} bytes`);

  // Load weights
  const weightsPath = path.join(__dirname, "../../weights/optimal_model.bin");
  const weights = fs.readFileSync(weightsPath);
  console.log(`  Weights size: ${weights.length} bytes`);

  // Create accounts
  console.log("\n─ Creating Accounts ─");
  const moduleAcc = Keypair.generate();
  const weightsAcc = Keypair.generate();
  const featuresAcc = Keypair.generate();

  // Calculate space needed
  const moduleSpace = Math.max(moduleBytecode.length + 64, 4096); // Extra padding
  const weightsSpace = 128;
  const featuresSpace = 128;

  const moduleLamports = await connection.getMinimumBalanceForRentExemption(moduleSpace);
  const weightsLamports = await connection.getMinimumBalanceForRentExemption(weightsSpace);
  const featuresLamports = await connection.getMinimumBalanceForRentExemption(featuresSpace);

  const createTx = new Transaction()
    .add(SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: moduleAcc.publicKey,
      lamports: moduleLamports,
      space: moduleSpace,
      programId,
    }))
    .add(SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: weightsAcc.publicKey,
      lamports: weightsLamports,
      space: weightsSpace,
      programId,
    }))
    .add(SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: featuresAcc.publicKey,
      lamports: featuresLamports,
      space: featuresSpace,
      programId,
    }));

  await sendAndConfirmTransaction(connection, createTx, [payer, moduleAcc, weightsAcc, featuresAcc]);

  console.log(`  Module:   ${moduleAcc.publicKey.toBase58()}`);
  console.log(`  Weights:  ${weightsAcc.publicKey.toBase58()}`);
  console.log(`  Features: ${featuresAcc.publicKey.toBase58()}`);

  // Write module bytecode
  console.log("\n─ Deploying NN Module ─");
  await writeToAccountChunked(connection, payer, programId, moduleAcc.publicKey, moduleBytecode);

  // Write weights using MODE 0x03 (direct binary write)
  console.log("\n─ Deploying Weights ─");
  await writeAccountDirect(connection, payer, programId, weightsAcc.publicKey, weights, 0);
  console.log(`  Weights written (${weights.length} bytes) ✓`);

  // Save deployment info
  const deploymentInfo = {
    network: "devnet",
    programId: CONFIG.PROGRAM_ID,
    accounts: {
      module: moduleAcc.publicKey.toBase58(),
      weights: weightsAcc.publicKey.toBase58(),
      features: featuresAcc.publicKey.toBase58(),
    },
    bytecodeSize: moduleBytecode.length,
    weightsSize: weights.length,
    deployedAt: new Date().toISOString(),
  };

  const deploymentPath = path.join(__dirname, "../../deployment.json");
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));

  console.log("\n" + "═".repeat(60));
  console.log("  DEPLOYMENT COMPLETE");
  console.log("═".repeat(60));
  console.log(`\n  Module:   ${moduleAcc.publicKey.toBase58()}`);
  console.log(`  Weights:  ${weightsAcc.publicKey.toBase58()}`);
  console.log(`  Features: ${featuresAcc.publicKey.toBase58()}`);
  console.log(`\n  Saved to: ${deploymentPath}`);
  console.log("═".repeat(60));
}

main().catch(console.error);
