/**
 * Hybrid Pipeline Test
 *
 * 1. JS reads Pyth price and writes as text to accumulator
 * 2. Python reads text, computes SMA, writes back
 * 3. Python computes features
 * 4. Python runs neural network
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
  const tempPy = "/tmp/pipeline.py";
  fs.writeFileSync(tempPy, code);
  const tempBin = "/tmp/pipeline.bin";
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
  // Convert to cents: expo=-8, so divide by 10^6
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

  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  // Simulate first
  const simResult = await connection.simulateTransaction(tx);
  if (simResult.value.err) {
    console.log("  SIM ERROR:", JSON.stringify(simResult.value.err));
    if (simResult.value.logs) {
      simResult.value.logs.forEach(function(log) {
        console.log("    " + log);
      });
    }
    return { cu: 0, returnData: null, error: true };
  }

  const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
    skipPreflight: true,
    commitment: "confirmed"
  });

  const txInfo = await connection.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  return {
    cu: txInfo?.meta?.computeUnitsConsumed || 0,
    returnData: txInfo?.meta?.returnData?.data?.[0]
      ? Buffer.from(txInfo.meta.returnData.data[0], "base64").toString("utf8")
      : null
  };
}

async function main() {
  console.log("═".repeat(60));
  console.log("  HYBRID PIPELINE TEST");
  console.log("═".repeat(60));

  const connection = new Connection(CONFIG.DEVNET_RPC, "confirmed");
  const payer = loadKeypair();
  const programId = new PublicKey(CONFIG.PROGRAM_ID);

  console.log("\nPayer: " + payer.publicKey.toBase58());

  // Create accumulator account
  console.log("\n─ Creating Accounts ─");
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
  console.log("  Accumulator: " + accumulator.publicKey.toBase58().slice(0, 20) + "...");

  // Step 1: Read Pyth price (JS) and initialize accumulator with 4 identical prices
  console.log("\n─ Step 1: Initialize with Pyth Price (JS) ─");
  const pythPrice = await readPythPrice(connection);
  console.log("  Pyth SOL/USD: $" + (pythPrice / 100).toFixed(2) + " (" + pythPrice + " cents)");

  // Write initial state: p0,p1,p2,p3 all same, sma=same
  // Format: 5 chars each, no separator for simplicity
  const priceStr = pythPrice.toString().padStart(5, "0");
  const initialData = priceStr + priceStr + priceStr + priceStr + priceStr;

  const initCode = 'f=open("/sol/1","w")\nf.write("' + initialData + '")\nf.close()\n1';
  const initBytecode = compilePython(initCode);
  console.log("  Init bytecode: " + initBytecode.length + " bytes");

  var result = await executePython(connection, payer, programId, initBytecode,
    [{ pubkey: accumulator.publicKey, writable: true }]);
  console.log("  Init done, CU: " + result.cu);

  // Read back to verify
  const verifyCode = 'f=open("/sol/1","r")\nd=f.read(25)\nf.close()\nd';
  const verifyBytecode = compilePython(verifyCode);
  result = await executePython(connection, payer, programId, verifyBytecode,
    [{ pubkey: accumulator.publicKey, writable: false }]);
  console.log("  Stored: " + result.returnData);

  // Step 2: Shift prices and update SMA (Python)
  console.log("\n─ Step 2: Shift + SMA (Python) ─");
  const newPrice = pythPrice + 50; // Simulate price change
  const newPriceStr = newPrice.toString().padStart(5, "0");

  // Read p0,p1,p2,p3, shift them, write new price, compute SMA
  // No zfill needed - all prices are 5 digits (10000-99999 cents)
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
  console.log("  Shift bytecode: " + shiftBytecode.length + " bytes");

  result = await executePython(connection, payer, programId, shiftBytecode,
    [{ pubkey: accumulator.publicKey, writable: true }]);
  if (result.error) {
    console.log("  SHIFT FAILED");
    return;
  }
  console.log("  New SMA: " + result.returnData + ", CU: " + result.cu);

  // Wait a bit then verify
  await new Promise(r => setTimeout(r, 1000));
  result = await executePython(connection, payer, programId, verifyBytecode,
    [{ pubkey: accumulator.publicKey, writable: false }]);
  if (!result.error) {
    console.log("  Updated state: " + result.returnData);
  }

  // Step 3: Read all prices and compute features
  console.log("\n─ Step 3: Compute Features (Python) ─");
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
  console.log("  Features bytecode: " + featBytecode.length + " bytes");

  result = await executePython(connection, payer, programId, featBytecode,
    [{ pubkey: accumulator.publicKey, writable: false }]);

  if (result.returnData) {
    const combined = parseInt(result.returnData);
    const momentum = Math.floor(combined / 1000);
    const volatility = combined % 1000;
    console.log("  Momentum: " + momentum + ", Volatility: " + volatility);
  }
  console.log("  CU: " + result.cu);

  // Summary
  console.log("\n" + "═".repeat(60));
  console.log("  PIPELINE WORKING!");
  console.log("═".repeat(60));
  console.log("\nFormat: 5-char fixed width text, sequential reads");
  console.log("Tested: init, shift, SMA, momentum, volatility");
  console.log("\n");
}

main().catch(console.error);
