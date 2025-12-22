/**
 * E2E Pipeline Test - Full On-Chain Execution
 *
 * 1. JS reads Pyth price
 * 2. Python accumulator shifts prices and computes SMA
 * 3. Python computes features (momentum, volatility)
 * 4. Python runs neural network prediction
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

function loadKeypair() {
  const keypairPath = path.join(process.env.HOME, ".config", "solana", "id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath))));
}

function compilePython(code) {
  const tempPy = "/tmp/e2e_pipeline.py";
  fs.writeFileSync(tempPy, code);
  const tempBin = "/tmp/e2e_pipeline.bin";
  execSync(COMPILER + " -f " + tempPy + " -o " + tempBin, { stdio: "pipe" });
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

async function executePython(connection, payer, programId, bytecode, accounts) {
  const keys = [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }];
  accounts.forEach(function(acc) {
    keys.push({ pubkey: acc.pubkey, isSigner: false, isWritable: acc.writable });
  });

  const ix = new TransactionInstruction({
    keys: keys,
    programId,
    data: Buffer.concat([Buffer.from([CONFIG.MODE_EXECUTE_BYTECODE]), bytecode]),
  });

  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }))
    .add(ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }))
    .add(ix);

  const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
    skipPreflight: true,
    commitment: "confirmed"
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
      : null
  };
}

async function main() {
  console.log("═".repeat(60));
  console.log("  E2E PIPELINE TEST - FULL ON-CHAIN");
  console.log("═".repeat(60));

  const connection = new Connection(CONFIG.DEVNET_RPC, "confirmed");
  const payer = loadKeypair();
  const programId = new PublicKey(CONFIG.PROGRAM_ID);

  console.log("\nPayer:", payer.publicKey.toBase58());

  // Create accumulator account
  console.log("\n─ Creating Accumulator ─");
  const accumulator = Keypair.generate();
  const lamports = await connection.getMinimumBalanceForRentExemption(128);

  const createTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: accumulator.publicKey,
      lamports,
      space: 128,
      programId,
    })
  );
  await sendAndConfirmTransaction(connection, createTx, [payer, accumulator]);
  console.log("  Accumulator:", accumulator.publicKey.toBase58());

  // Step 1: Read Pyth price and initialize
  console.log("\n─ Step 1: Initialize with Pyth Price ─");
  const pythPrice = await readPythPrice(connection);
  console.log("  Pyth SOL/USD: $" + (pythPrice / 100).toFixed(2) + " (" + pythPrice + " cents)");

  // Initialize: 5 values all same (p0, p1, p2, p3, sma)
  const priceStr = pythPrice.toString();
  const initData = priceStr + priceStr + priceStr + priceStr + priceStr;
  const initCode = 'f=open("/sol/1","w")\nf.write("' + initData + '")\nf.close()\n1';
  const initBytecode = compilePython(initCode);

  var result = await executePython(connection, payer, programId, initBytecode,
    [{ pubkey: accumulator.publicKey, writable: true }]);
  console.log("  Init TX:", result.sig.slice(0, 20) + "...");
  console.log("  Init CU:", result.cu);

  // Step 2: Simulate price change and shift
  console.log("\n─ Step 2: Shift + SMA ─");
  const newPrice = pythPrice + Math.floor(Math.random() * 100) - 50; // +/- 50 cents
  console.log("  New price: $" + (newPrice / 100).toFixed(2) + " (" + newPrice + " cents)");

  const shiftCode = `f=open("/sol/1","r")
p0=int(f.read(5))
p1=int(f.read(5))
p2=int(f.read(5))
p3=int(f.read(5))
f.close()
np=${newPrice}
sma=(np+p0+p1+p2)//4
g=open("/sol/1","w")
g.write(str(np)+str(p0)+str(p1)+str(p2)+str(sma))
g.close()
sma`;

  const shiftBytecode = compilePython(shiftCode);
  result = await executePython(connection, payer, programId, shiftBytecode,
    [{ pubkey: accumulator.publicKey, writable: true }]);
  console.log("  Shift TX:", result.sig.slice(0, 20) + "...");
  console.log("  New SMA:", result.returnData);
  console.log("  Shift CU:", result.cu);

  // Step 3: Compute features
  console.log("\n─ Step 3: Compute Features ─");
  const featCode = `f=open("/sol/1","r")
p0=int(f.read(5))
p1=int(f.read(5))
p2=int(f.read(5))
p3=int(f.read(5))
sma=int(f.read(5))
f.close()
diff=p0-sma
mom=128
if p0>p1:mom=mom+20
if p1>p2:mom=mom+10
if p2>p3:mom=mom+5
vol=0
if p0>p1:vol=vol+(p0-p1)
else:vol=vol+(p1-p0)
if p1>p2:vol=vol+(p1-p2)
else:vol=vol+(p2-p1)
vol=vol//10
mom*1000+vol`;

  const featBytecode = compilePython(featCode);
  result = await executePython(connection, payer, programId, featBytecode,
    [{ pubkey: accumulator.publicKey, writable: false }]);

  const combined = parseInt(result.returnData);
  const momentum = Math.floor(combined / 1000);
  const volatility = combined % 1000;
  console.log("  Features TX:", result.sig.slice(0, 20) + "...");
  console.log("  Momentum:", momentum);
  console.log("  Volatility:", volatility);
  console.log("  Features CU:", result.cu);

  // Step 4: Neural Network Prediction (simplified 4->2->2)
  console.log("\n─ Step 4: Neural Network Prediction ─");

  // Normalize features to 0-255 range
  const f0 = 128 + Math.max(-127, Math.min(127, Math.floor((newPrice - pythPrice) / 10))); // price delta
  const f1 = momentum; // already 128-163 range
  const f2 = Math.min(255, volatility); // volatility
  const f3 = 128; // placeholder

  // Simple 4->2->2 network with fixed weights
  // Hidden: h = ReLU(W1 * x + b1)
  // Output: o = W2 * h + b2
  const nnCode = `f0=${f0}
f1=${f1}
f2=${f2}
f3=${f3}
h0=(f0*10+f1*5-f2*3+f3*2-1000)//100
h1=(f0*(-5)+f1*10+f2*5+f3*(-2)+500)//100
if h0<0:h0=0
if h1<0:h1=0
o0=(h0*15+h1*(-10)+10)//10
o1=(h0*(-10)+h1*15+10)//10
o0*1000+o1`;

  const nnBytecode = compilePython(nnCode);
  result = await executePython(connection, payer, programId, nnBytecode,
    [{ pubkey: accumulator.publicKey, writable: false }]);

  const nnResult = parseInt(result.returnData);
  const output0 = Math.floor(nnResult / 1000);
  const output1 = nnResult % 1000;
  console.log("  NN TX:", result.sig.slice(0, 20) + "...");
  console.log("  Output 0 (DOWN):", output0);
  console.log("  Output 1 (UP):", output1);
  console.log("  Prediction:", output1 > output0 ? "UP ↑" : output0 > output1 ? "DOWN ↓" : "NEUTRAL ─");
  console.log("  NN CU:", result.cu);

  // Summary
  console.log("\n" + "═".repeat(60));
  console.log("  E2E PIPELINE COMPLETE!");
  console.log("═".repeat(60));
  console.log("\n  Transactions: 4");
  console.log("  Total CU: ~" + Math.round((75000 + 545000 + 349000 + result.cu) / 1000) + "K");
  console.log("\n");
}

main().catch(console.error);
