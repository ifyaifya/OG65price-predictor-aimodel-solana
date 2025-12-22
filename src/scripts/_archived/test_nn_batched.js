/**
 * Test NN 6→8→1 BATCHED (2 neurons per TX)
 * 5 TX for NN: 4 hidden batches + 1 decoder
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
  PYTH_SOL_USD_DEVNET: "J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix",
  MODE_EXECUTE_BYTECODE: 0x02,
};

const COMPILER = "/Users/true/Documents/Pipeline/CasterCorp/modelonSolana/solanapython-build/solana/tools/pika_compile";
const PYTHON_DIR = path.join(__dirname, "../python");

function loadKeypair() {
  const keypairPath = path.join(process.env.HOME, ".config", "solana", "id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath))));
}

function compilePython(code) {
  const tempPy = "/tmp/nn_test.py";
  fs.writeFileSync(tempPy, code);
  const tempBin = "/tmp/nn_test.bin";
  execSync(`${COMPILER} -f ${tempPy} -o ${tempBin}`, { stdio: "pipe" });
  return fs.readFileSync(tempBin);
}

function compilePythonFile(filename) {
  const pyPath = path.join(PYTHON_DIR, filename);
  const tempBin = "/tmp/" + filename.replace(".py", ".bin");
  execSync(`${COMPILER} -f ${pyPath} -o ${tempBin}`, { stdio: "pipe" });
  return fs.readFileSync(tempBin);
}

async function readPythPrice(connection) {
  const pythAccount = await connection.getAccountInfo(new PublicKey(CONFIG.PYTH_SOL_USD_DEVNET));
  if (!pythAccount) return null;
  const data = pythAccount.data;
  const priceLow = data.readUInt32LE(208);
  const priceHigh = data.readInt32LE(212);
  const rawPrice = BigInt(priceHigh) * BigInt(0x100000000) + BigInt(priceLow);
  return Number(rawPrice / 1000000n);
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

  console.log(`  ${label}: ${cu.toLocaleString()} CU${returnData ? ` → ${returnData}` : ""}`);
  return { sig, cu, returnData };
}

async function main() {
  console.log("═".repeat(60));
  console.log("  NN 6→8→1 BATCHED TEST");
  console.log("═".repeat(60));

  const connection = new Connection(CONFIG.DEVNET_RPC, "confirmed");
  const payer = loadKeypair();
  const programId = new PublicKey(CONFIG.PROGRAM_ID);

  console.log("\nPayer:", payer.publicKey.toBase58());

  // Create accounts
  console.log("\n─ Creating Accounts ─");
  const featuresAcc = Keypair.generate();
  const hiddenAcc = Keypair.generate();

  const lamports = await connection.getMinimumBalanceForRentExemption(64);

  const createTx = new Transaction()
    .add(SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: featuresAcc.publicKey,
      lamports,
      space: 64,
      programId,
    }))
    .add(SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: hiddenAcc.publicKey,
      lamports,
      space: 64,
      programId,
    }));

  await sendAndConfirmTransaction(connection, createTx, [payer, featuresAcc, hiddenAcc]);
  console.log("  Features:", featuresAcc.publicKey.toBase58().slice(0, 20) + "...");
  console.log("  Hidden:  ", hiddenAcc.publicKey.toBase58().slice(0, 20) + "...");

  // Read Pyth price
  console.log("\n─ Pyth Price ─");
  const pythPrice = await readPythPrice(connection);
  console.log(`  SOL/USD: $${(pythPrice / 100).toFixed(2)}`);

  // Generate test features (in production: from accumulator)
  const features = [
    128 + Math.floor((Math.random() - 0.5) * 20),  // sma_ratio
    128 + Math.floor((Math.random() - 0.5) * 40),  // momentum
    Math.floor(Math.random() * 50),                 // volatility
    128 + Math.floor((Math.random() - 0.5) * 30),  // trend
    Math.floor(Math.random() * 255),                // rsi_like
    Math.floor(Math.random() * 255),                // position
  ];

  console.log("\n─ Features ─");
  console.log(`  [${features.join(", ")}]`);

  // Write features
  const writeCode = `g=open("/sol/1","wb")
g.write(bytes([${features.join(",")}]))
g.close()
1`;

  console.log("\n─ TX1: Write Features ─");
  let totalCU = 0;
  let result = await executePython(connection, payer, programId, compilePython(writeCode),
    [{ pubkey: featuresAcc.publicKey, writable: true }], "Write");
  totalCU += result.cu;

  // Hidden layer batches
  console.log("\n─ TX2-5: Hidden Layer ─");
  const batches = ["nn_h01_batch.py", "nn_h23_batch.py", "nn_h45_batch.py", "nn_h67_batch.py"];
  for (const batch of batches) {
    const bytecode = compilePythonFile(batch);
    result = await executePython(connection, payer, programId, bytecode,
      [
        { pubkey: featuresAcc.publicKey, writable: false },
        { pubkey: hiddenAcc.publicKey, writable: true },
      ],
      batch.replace("_batch.py", "")
    );
    totalCU += result.cu;
  }

  // Decoder
  console.log("\n─ TX6: Decoder ─");
  const decBytecode = compilePythonFile("nn_dec_fixed.py");
  result = await executePython(connection, payer, programId, decBytecode,
    [{ pubkey: hiddenAcc.publicKey, writable: false }], "Decoder");
  totalCU += result.cu;

  const prediction = parseInt(result.returnData);

  console.log("\n" + "═".repeat(60));
  console.log("  SUMMARY");
  console.log("═".repeat(60));
  console.log(`  Prediction: ${prediction === 1 ? "UP ↑" : "DOWN ↓"}`);
  console.log(`  Total TX:   6`);
  console.log(`  Total CU:   ${totalCU.toLocaleString()}`);
  console.log("═".repeat(60));
}

main().catch(console.error);
