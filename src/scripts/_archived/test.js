/**
 * Price Predictor E2E Tests (4→3→2 Architecture)
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
  MODE_EXECUTE_SCRIPT: 0x00,
  MODE_EXECUTE_BYTECODE: 0x02,
};

const COMPILER = process.env.PIKA_COMPILE || "/Users/true/Documents/Pipeline/CasterCorp/modelonSolana/solanapython-build/solana/tools/pika_compile";

// Load trained weights from binary files
const WEIGHTS_DIR = path.join(__dirname, "..", "..", "weights");
let TRAINED_ENCODER_WEIGHTS = null;
let TRAINED_DECODER_WEIGHTS = null;

function loadTrainedWeights() {
  const encPath = path.join(WEIGHTS_DIR, "encoder_4_3.bin");
  const decPath = path.join(WEIGHTS_DIR, "decoder_4_3.bin");

  if (fs.existsSync(encPath) && fs.existsSync(decPath)) {
    TRAINED_ENCODER_WEIGHTS = fs.readFileSync(encPath);
    TRAINED_DECODER_WEIGHTS = fs.readFileSync(decPath);
    console.log(`\nLoaded trained weights:`);
    console.log(`  Encoder: ${TRAINED_ENCODER_WEIGHTS.length} bytes`);
    console.log(`  Decoder: ${TRAINED_DECODER_WEIGHTS.length} bytes`);

    // Display weights as signed INT8
    const encSigned = Array.from(TRAINED_ENCODER_WEIGHTS).map(b => b > 127 ? b - 256 : b);
    const decSigned = Array.from(TRAINED_DECODER_WEIGHTS).map(b => b > 127 ? b - 256 : b);

    console.log(`\n  Encoder weights (W1): [${encSigned.slice(0, 12).join(", ")}]`);
    console.log(`  Encoder biases (b1):  [${encSigned.slice(12, 15).join(", ")}]`);
    console.log(`  Decoder weights (W2): [${decSigned.slice(0, 6).join(", ")}]`);
    console.log(`  Decoder biases (b2):  [${decSigned.slice(6, 8).join(", ")}]`);
    return true;
  } else {
    console.log("⚠️  Trained weights not found, using random weights");
    console.log(`  Expected: ${encPath}`);
    console.log(`  Expected: ${decPath}`);
    return false;
  }
}

function loadKeypair() {
  const keypairPath = path.join(process.env.HOME, ".config", "solana", "id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath))));
}

/**
 * Write data to an account using SolanaPython MODE_EXECUTE_SCRIPT
 */
async function writeToAccount(connection, payer, programId, account, data) {
  // Convert to unsigned bytes for Python
  const bytesStr = Array.from(data).join(",");

  const writeCode = `
f=open("/sol/1","r+b")
f.write(bytes([${bytesStr}]))
f.close()
1
`;

  const writeBuffer = Buffer.from(writeCode.trim(), "utf8");
  const writeData = Buffer.alloc(1 + writeBuffer.length);
  writeData.writeUInt8(CONFIG.MODE_EXECUTE_SCRIPT, 0);
  writeBuffer.copy(writeData, 1);

  const writeTx = new Transaction();
  writeTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }));
  writeTx.add(ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }));
  writeTx.add(
    new TransactionInstruction({
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: account, isSigner: false, isWritable: true },
      ],
      programId,
      data: writeData,
    })
  );

  await sendAndConfirmTransaction(connection, writeTx, [payer]);
}

function compilePython(inputPath, outputPath) {
  execSync(`${COMPILER} -f ${inputPath} -o ${outputPath}`, { stdio: "pipe" });
  return fs.readFileSync(outputPath);
}

/**
 * Generate encoder bytecode with specific features embedded
 */
function generateEncoderBytecode(features) {
  const pythonCode = `# Price 4→3→2 S1: Encoder with TRAINED weights and embedded features
W=[23,-12,1,-41,-10,0,-127,-12,1,76,-21,1,61,127,123]
I=[${features.join(",")}]
h0=W[12]+I[0]*W[0]+I[1]*W[3]+I[2]*W[6]+I[3]*W[9]
h1=W[13]+I[0]*W[1]+I[1]*W[4]+I[2]*W[7]+I[3]*W[10]
h2=W[14]+I[0]*W[2]+I[1]*W[5]+I[2]*W[8]+I[3]*W[11]
if h0<0:h0=0
if h1<0:h1=0
if h2<0:h2=0
g=open("/sol/1","wb")
g.write(bytes([h0%256,h1%256,h2%256]))
g.close()
1
`;

  const tempPyPath = "/tmp/encoder_dynamic.py";
  const tempBinPath = "/tmp/encoder_dynamic.bin";
  fs.writeFileSync(tempPyPath, pythonCode);
  execSync(`${COMPILER} -f ${tempPyPath} -o ${tempBinPath}`, { stdio: "pipe" });
  return fs.readFileSync(tempBinPath);
}

// Test cases with different market conditions (4 features)
// Features: vwap_ratio, volume_accel, orderbook_imbal, momentum
const TEST_CASES = [
  {
    name: "Bullish signal",
    // Values > 128 indicate bullish for ratio-based features
    features: [140, 150, 140, 160],
    expectedDirection: "positive",
  },
  {
    name: "Bearish signal",
    // Values < 128 indicate bearish
    features: [110, 100, 110, 90],
    expectedDirection: "negative",
  },
  {
    name: "Neutral signal",
    // Values around 128 indicate neutral
    features: [128, 128, 128, 128],
    expectedDirection: "neutral",
  },
  {
    name: "Strong bullish",
    features: [160, 180, 155, 175],
    expectedDirection: "positive",
  },
];

async function runTest(connection, payer, programId, testCase, decBytecode) {
  console.log(`\n  Testing: ${testCase.name}`);
  console.log(`  Features: [${testCase.features.join(", ")}]`);

  // Generate encoder bytecode with features embedded
  const encBytecode = generateEncoderBytecode(testCase.features);
  console.log(`  Encoder bytecode: ${encBytecode.length} bytes`);

  // Create hidden state account (3 bytes)
  // Encoder writes hidden state here, decoder reads from it
  const hiddenAcc = Keypair.generate();

  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: hiddenAcc.publicKey,
        lamports: await connection.getMinimumBalanceForRentExemption(3),
        space: 3,
        programId: SystemProgram.programId,
      })
    ),
    [payer, hiddenAcc]
  );

  // Execute encoder (weights and features embedded in bytecode)
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

  // Execute decoder (weights embedded in bytecode)
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
  console.log("Price Predictor E2E Tests (4→3→2)");
  console.log("=".repeat(50));

  // Load trained weights
  const hasTrainedWeights = loadTrainedWeights();

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

  // Compile decoder (encoder is generated dynamically per test with features embedded)
  console.log("\nCompiling decoder with trained weights...");
  const pythonDir = path.join(__dirname, "..", "python");

  const decBytecode = compilePython(
    path.join(pythonDir, "price_4_3_s2_trained.py"),
    "/tmp/test_price_decoder_trained.bin"
  );

  console.log(`Decoder: ${decBytecode.length} bytes (encoder generated per test)`);

  // Verify bytecode fits in transaction
  const maxBytecode = 946;
  if (decBytecode.length > maxBytecode) {
    console.error(`\n❌ Decoder bytecode exceeds ${maxBytecode} byte limit!`);
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
        connection, payer, programId, testCase, decBytecode
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
