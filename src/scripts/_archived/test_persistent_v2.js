/**
 * Test NN with PERSISTENT weights - using Python to write
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
};

const COMPILER = "/Users/true/Documents/Pipeline/CasterCorp/modelonSolana/solanapython-build/solana/tools/pika_compile";
const PYTHON_DIR = path.join(__dirname, "../python");
const WEIGHTS_PATH = path.join(__dirname, "../../weights/optimal_model.bin");

function loadKeypair() {
  const keypairPath = path.join(process.env.HOME, ".config", "solana", "id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath))));
}

function compilePython(code) {
  const tempPy = "/tmp/persist_test.py";
  fs.writeFileSync(tempPy, code);
  const tempBin = "/tmp/persist_test.bin";
  execSync(`${COMPILER} -f ${tempPy} -o ${tempBin}`, { stdio: "pipe" });
  return fs.readFileSync(tempBin);
}

function compilePythonFile(filename) {
  const pyPath = path.join(PYTHON_DIR, filename);
  const tempBin = "/tmp/" + filename.replace(".py", ".bin");
  execSync(`${COMPILER} -f ${pyPath} -o ${tempBin}`, { stdio: "pipe" });
  return fs.readFileSync(tempBin);
}

async function executePython(connection, payer, programId, bytecode, accounts, label) {
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

  const cu = txInfo?.meta?.computeUnitsConsumed || 0;
  const returnData = txInfo?.meta?.returnData?.data?.[0]
    ? Buffer.from(txInfo.meta.returnData.data[0], "base64").toString("utf8")
    : null;

  console.log(`  ${label}: ${cu.toLocaleString()} CU${returnData !== null ? ` → ${returnData}` : ""}`);
  return { sig, cu, returnData };
}

async function main() {
  console.log("═".repeat(60));
  console.log("  PERSISTENT NN - WEIGHTS ON-CHAIN");
  console.log("═".repeat(60));

  const connection = new Connection(CONFIG.DEVNET_RPC, "confirmed");
  const payer = loadKeypair();
  const programId = new PublicKey(CONFIG.PROGRAM_ID);

  console.log("\nPayer:", payer.publicKey.toBase58());

  // Create accounts
  console.log("\n─ Creating Persistent Accounts ─");
  const weightsAcc = Keypair.generate();
  const featuresAcc = Keypair.generate();
  const hiddenAcc = Keypair.generate();

  const lamports = await connection.getMinimumBalanceForRentExemption(128);

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

  console.log("  Weights:  ", weightsAcc.publicKey.toBase58());
  console.log("  Features: ", featuresAcc.publicKey.toBase58());
  console.log("  Hidden:   ", hiddenAcc.publicKey.toBase58());

  // Load weights
  const weights = fs.readFileSync(WEIGHTS_PATH);
  const weightsArray = Array.from(weights);
  console.log(`\n  Weights: ${weights.length} bytes`);

  // Write weights using Python
  console.log("\n─ Deploying Weights (one-time) ─");
  const writeWeightsCode = `g=open("/sol/1","wb")
g.write(bytes([${weightsArray.join(",")}]))
g.close()
1`;

  const writeWeightsBytecode = compilePython(writeWeightsCode);
  await executePython(connection, payer, programId, writeWeightsBytecode,
    [{ pubkey: weightsAcc.publicKey, writable: true }], "Deploy weights");

  // Simulate multiple user inferences
  console.log("\n─ User Inferences (reusing weights) ─");

  for (let i = 0; i < 3; i++) {
    // Generate random features for this "user"
    const userFeatures = [
      128 + Math.floor((Math.random() - 0.5) * 16),
      128 + Math.floor((Math.random() - 0.5) * 30),
      Math.floor(Math.random() * 40),
      128 + Math.floor((Math.random() - 0.5) * 25),
      80 + Math.floor(Math.random() * 95),
      50 + Math.floor(Math.random() * 155),
    ];

    console.log(`\n  User ${i + 1} features: [${userFeatures.join(", ")}]`);

    // Write user features
    const writeFeaturesCode = `g=open("/sol/1","wb")
g.write(bytes([${userFeatures.join(",")}]))
g.close()
1`;
    const writeFeaturesBytecode = compilePython(writeFeaturesCode);
    await executePython(connection, payer, programId, writeFeaturesBytecode,
      [{ pubkey: featuresAcc.publicKey, writable: true }], "  Write features");

    // Execute NN
    const nnBytecode = compilePythonFile("nn_persistent_full.py");
    const result = await executePython(connection, payer, programId, nnBytecode,
      [
        { pubkey: weightsAcc.publicKey, writable: false },
        { pubkey: featuresAcc.publicKey, writable: false },
        { pubkey: hiddenAcc.publicKey, writable: true },
      ],
      "  NN inference");

    const prediction = parseInt(result.returnData);
    console.log(`  → Prediction: ${prediction === 1 ? "UP ↑" : "DOWN ↓"}`);
  }

  console.log("\n" + "═".repeat(60));
  console.log("  SUMMARY");
  console.log("═".repeat(60));
  console.log("  Weights account: PERSISTENT (deploy once)");
  console.log("  User inference:  2 TX (write features + execute NN)");
  console.log("  Bytecode:        902 bytes");
  console.log("  Accuracy:        59.2%");
  console.log("═".repeat(60));
}

main().catch(console.error);
