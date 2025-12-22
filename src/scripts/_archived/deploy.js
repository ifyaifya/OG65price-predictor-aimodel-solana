/**
 * Deploy Price Predictor (6→4→2 Neural Network)
 * Deploys encoder and decoder stages to Solana devnet
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

async function main() {
  const connection = new Connection(CONFIG.DEVNET_RPC, "confirmed");
  const payer = loadKeypair();
  const programId = new PublicKey(CONFIG.PROGRAM_ID);

  console.log("=== Price Predictor Deployment ===\n");
  console.log(`Payer: ${payer.publicKey.toBase58()}`);
  console.log(`Program: ${CONFIG.PROGRAM_ID}\n`);

  // Compile stages
  console.log("Compiling Python models...");
  const pythonDir = path.join(__dirname, "..", "python");

  const encoderBytecode = compilePython(
    path.join(pythonDir, "price_s1.py"),
    "/tmp/price_encoder.bin"
  );
  const decoderBytecode = compilePython(
    path.join(pythonDir, "price_s2.py"),
    "/tmp/price_decoder.bin"
  );

  console.log(`Encoder bytecode: ${encoderBytecode.length} bytes`);
  console.log(`Decoder bytecode: ${decoderBytecode.length} bytes\n`);

  // Create accounts
  console.log("Creating accounts...");

  // Encoder weights (34 bytes: 24 weights + 4 biases + 6 input features)
  const encWeights = Keypair.generate();
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

  // Hidden state (4 bytes)
  const hiddenAcc = Keypair.generate();
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

  // Decoder weights (10 bytes: 8 weights + 2 biases)
  const decWeights = Keypair.generate();
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

  console.log(`Encoder weights: ${encWeights.publicKey.toBase58()}`);
  console.log(`Hidden state: ${hiddenAcc.publicKey.toBase58()}`);
  console.log(`Decoder weights: ${decWeights.publicKey.toBase58()}\n`);

  // Execute encoder
  console.log("Executing encoder stage...");
  const encData = Buffer.alloc(1 + encoderBytecode.length);
  encData.writeUInt8(CONFIG.MODE_EXECUTE_BYTECODE, 0);
  encoderBytecode.copy(encData, 1);

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
    maxSupportedTransactionVersion: 0
  });
  console.log(`Encoder: ${encDetails?.meta?.computeUnitsConsumed?.toLocaleString()} CU`);

  // Execute decoder
  console.log("Executing decoder stage...");
  const decData = Buffer.alloc(1 + decoderBytecode.length);
  decData.writeUInt8(CONFIG.MODE_EXECUTE_BYTECODE, 0);
  decoderBytecode.copy(decData, 1);

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
    maxSupportedTransactionVersion: 0
  });
  console.log(`Decoder: ${decDetails?.meta?.computeUnitsConsumed?.toLocaleString()} CU`);

  // Parse result
  const result = decDetails?.meta?.returnData?.data;
  if (result) {
    const decoded = Buffer.from(result[0], 'base64');
    const value = decoded.readInt32LE(0);
    const direction = Math.floor(value / 1000);
    const confidence = value % 1000;
    console.log(`\nPrediction: direction=${direction}, confidence=${confidence}`);
  }

  console.log("\n" + "=".repeat(50));
  console.log("DEPLOYMENT SUCCESS!");
  console.log("=".repeat(50));
  console.log(`\nEncoder TX: https://explorer.solana.com/tx/${encSig}?cluster=devnet`);
  console.log(`Decoder TX: https://explorer.solana.com/tx/${decSig}?cluster=devnet`);
}

main().catch(console.error);
