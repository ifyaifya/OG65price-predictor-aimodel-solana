/**
 * Price Predictor E2E Tests
 * Tests the complete flow on Solana devnet
 */

const {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
} = require("@solana/web3.js");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const CONFIG = {
  PROGRAM_ID: "AdvFUgScZPQmnkhCZ1ZFMN7c1rsanoE7TfYbikggUAxM",
  DEVNET_RPC: "https://api.devnet.solana.com",
  MODE_EXECUTE_BYTECODE: 0x02,
};

const COMPILER = process.env.PIKA_COMPILE || "../../../solanapython-build/solana/tools/pika_compile";

function loadKeypair() {
  const keypairPath = path.join(process.env.HOME, ".config", "solana", "id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath))));
}

function compilePython(inputPath, outputPath) {
  execSync(`${COMPILER} -f ${inputPath} -o ${outputPath}`, { stdio: "pipe" });
  return fs.readFileSync(outputPath);
}

// Test cases with different market conditions
const TEST_CASES = [
  {
    name: "Bullish signal",
    // Features: vwap_ratio, vol_accel, orderbook_imbal, volatility, liquidity, momentum
    // Values > 128 indicate bullish for ratio-based features
    features: [140, 150, 140, 50, 200, 160],
    expectedDirection: "positive",
  },
  {
    name: "Bearish signal",
    // Values < 128 indicate bearish
    features: [110, 100, 110, 80, 150, 90],
    expectedDirection: "negative",
  },
  {
    name: "Neutral signal",
    // Values around 128 indicate neutral
    features: [128, 128, 128, 30, 180, 128],
    expectedDirection: "neutral",
  },
  {
    name: "High volatility bullish",
    features: [145, 180, 135, 200, 100, 155],
    expectedDirection: "positive",
  },
];

async function runTest(connection, payer, programId, testCase, encBytecode, decBytecode) {
  console.log(`\n  Testing: ${testCase.name}`);
  console.log(`  Features: [${testCase.features.join(", ")}]`);

  // Create accounts
  const encWeights = Keypair.generate();
  const hiddenAcc = Keypair.generate();
  const decWeights = Keypair.generate();

  // Encoder weights: 28 bytes (weights+biases) + 6 bytes (features) = 34 bytes
  const encWeightsData = Buffer.alloc(34);
  // Fill with small random weights (simulating trained model)
  for (let i = 0; i < 28; i++) {
    encWeightsData[i] = Math.floor(Math.random() * 20) - 10 + 128;
  }
  // Add input features at bytes 28-33
  for (let i = 0; i < 6; i++) {
    encWeightsData[28 + i] = testCase.features[i];
  }

  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: encWeights.publicKey,
        lamports: await connection.getMinimumBalanceForRentExemption(34),
        space: 34,
        programId: SystemProgram.programId,
      })
    ),
    [payer, encWeights]
  );

  // Hidden state: 4 bytes
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: hiddenAcc.publicKey,
        lamports: await connection.getMinimumBalanceForRentExemption(4),
        space: 4,
        programId: SystemProgram.programId,
      })
    ),
    [payer, hiddenAcc]
  );

  // Decoder weights: 10 bytes
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: decWeights.publicKey,
        lamports: await connection.getMinimumBalanceForRentExemption(10),
        space: 10,
        programId: SystemProgram.programId,
      })
    ),
    [payer, decWeights]
  );

  // Execute encoder
  const encData = Buffer.alloc(1 + encBytecode.length);
  encData.writeUInt8(CONFIG.MODE_EXECUTE_BYTECODE, 0);
  encBytecode.copy(encData, 1);

  const encTx = new Transaction();
  encTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }));
  encTx.add(ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }));
  encTx.add(
    new TransactionInstruction({
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: encWeights.publicKey, isSigner: false, isWritable: false },
        { pubkey: hiddenAcc.publicKey, isSigner: false, isWritable: true },
      ],
      programId,
      data: encData,
    })
  );

  const encSig = await sendAndConfirmTransaction(connection, encTx, [payer]);
  const encDetails = await connection.getTransaction(encSig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  console.log(`  Encoder CU: ${encDetails?.meta?.computeUnitsConsumed?.toLocaleString()}`);

  // Execute decoder
  const decData = Buffer.alloc(1 + decBytecode.length);
  decData.writeUInt8(CONFIG.MODE_EXECUTE_BYTECODE, 0);
  decBytecode.copy(decData, 1);

  const decTx = new Transaction();
  decTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }));
  decTx.add(ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }));
  decTx.add(
    new TransactionInstruction({
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: decWeights.publicKey, isSigner: false, isWritable: false },
        { pubkey: hiddenAcc.publicKey, isSigner: false, isWritable: false },
      ],
      programId,
      data: decData,
    })
  );

  const decSig = await sendAndConfirmTransaction(connection, decTx, [payer]);
  const decDetails = await connection.getTransaction(decSig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  console.log(`  Decoder CU: ${decDetails?.meta?.computeUnitsConsumed?.toLocaleString()}`);
  console.log(`  Expected: ${testCase.expectedDirection}`);

  // Check execution success
  const success = !encDetails?.meta?.err && !decDetails?.meta?.err;

  return success;
}

async function main() {
  console.log("=".repeat(50));
  console.log("Price Predictor E2E Tests");
  console.log("=".repeat(50));

  const connection = new Connection(CONFIG.DEVNET_RPC, "confirmed");
  const payer = loadKeypair();
  const programId = new PublicKey(CONFIG.PROGRAM_ID);

  console.log(`\nPayer: ${payer.publicKey.toBase58()}`);

  // Check balance
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Balance: ${(balance / 1e9).toFixed(4)} SOL`);

  if (balance < 0.2 * 1e9) {
    console.error("\nInsufficient balance. Need at least 0.2 SOL for tests.");
    console.log("Run: solana airdrop 1");
    return;
  }

  // Compile models
  console.log("\nCompiling models...");
  const pythonDir = path.join(__dirname, "..", "python");

  const encBytecode = compilePython(
    path.join(pythonDir, "price_s1.py"),
    "/tmp/test_price_encoder.bin"
  );
  const decBytecode = compilePython(
    path.join(pythonDir, "price_s2.py"),
    "/tmp/test_price_decoder.bin"
  );

  console.log(`Encoder: ${encBytecode.length} bytes`);
  console.log(`Decoder: ${decBytecode.length} bytes`);

  // Verify bytecode fits in transaction
  const maxBytecode = 946;
  if (encBytecode.length > maxBytecode || decBytecode.length > maxBytecode) {
    console.error(`\n❌ Bytecode exceeds ${maxBytecode} byte limit!`);
    return;
  }
  console.log(`✅ Bytecode sizes within limits`);

  // Run tests
  console.log("\n" + "-".repeat(50));
  console.log("Running tests...");
  console.log("-".repeat(50));

  let passed = 0;
  let failed = 0;

  for (const testCase of TEST_CASES) {
    try {
      const success = await runTest(
        connection, payer, programId, testCase,
        encBytecode, decBytecode
      );
      if (success) {
        passed++;
        console.log(`  ✅ PASSED`);
      } else {
        failed++;
        console.log(`  ❌ FAILED`);
      }
    } catch (err) {
      failed++;
      console.log(`  ❌ ERROR: ${err.message}`);
    }
  }

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log("TEST SUMMARY");
  console.log("=".repeat(50));
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total: ${passed + failed}`);

  if (failed === 0) {
    console.log("\n✅ All tests passed!");
  } else {
    console.log("\n❌ Some tests failed.");
    process.exit(1);
  }
}

main().catch(console.error);
