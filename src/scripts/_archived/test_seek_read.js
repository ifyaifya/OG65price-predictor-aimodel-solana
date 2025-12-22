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
  PYTH_SOL_USD_DEVNET: "J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix",
};

const COMPILER = "/Users/true/Documents/Pipeline/CasterCorp/modelonSolana/solanapython-build/solana/tools/pika_compile";

function loadKeypair() {
  const keypairPath = path.join(process.env.HOME, ".config", "solana", "id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath))));
}

function compileCode(code) {
  const tempPy = "/tmp/test_seek.py";
  fs.writeFileSync(tempPy, code);
  const tempBin = "/tmp/test_seek.bin";
  execSync(COMPILER + " -f " + tempPy + " -o " + tempBin, { stdio: "pipe" });
  return fs.readFileSync(tempBin);
}

async function test(connection, payer, programId, accounts, code, desc) {
  console.log("\n--- " + desc + " ---");

  var bytecode;
  try {
    bytecode = compileCode(code);
  } catch (e) {
    console.log("COMPILE ERROR");
    return false;
  }
  console.log("Bytecode: " + bytecode.length + " bytes");

  var keys = [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }];
  accounts.forEach(function(acc) {
    keys.push({ pubkey: acc.pubkey, isSigner: false, isWritable: acc.writable });
  });

  const ix = new TransactionInstruction({
    keys: keys,
    programId,
    data: Buffer.concat([Buffer.from([CONFIG.MODE_EXECUTE_BYTECODE]), bytecode]),
  });

  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500000 }))
    .add(ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }))
    .add(ix);

  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
      skipPreflight: true,
      commitment: "confirmed"
    });

    const txInfo = await connection.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    var hasError = false;
    if (txInfo && txInfo.meta && txInfo.meta.logMessages) {
      txInfo.meta.logMessages.forEach(function(log) {
        if (log.includes("Error") && !log.includes("bytecode")) {
          console.log("  ERR: " + log.slice(0, 100));
          hasError = true;
        }
      });
    }

    if (!hasError && txInfo && txInfo.meta && txInfo.meta.returnData && txInfo.meta.returnData.data && txInfo.meta.returnData.data[0]) {
      console.log("Return: " + Buffer.from(txInfo.meta.returnData.data[0], "base64").toString("utf8"));
    }
    if (txInfo && txInfo.meta) {
      console.log("CU: " + txInfo.meta.computeUnitsConsumed);
    }
    return !hasError;

  } catch (e) {
    console.error("FAILED TX");
    return false;
  }
}

async function main() {
  console.log("=== Seek + Read Tests ===");

  const connection = new Connection(CONFIG.DEVNET_RPC, "confirmed");
  const payer = loadKeypair();
  const programId = new PublicKey(CONFIG.PROGRAM_ID);

  // Create test account
  const account = Keypair.generate();
  const lamports = await connection.getMinimumBalanceForRentExemption(256);
  console.log("Creating test account...");

  const createTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: account.publicKey,
      lamports,
      space: 256,
      programId,
    })
  );
  await sendAndConfirmTransaction(connection, createTx, [payer, account]);

  // Write data at various offsets
  await test(connection, payer, programId,
    [{ pubkey: account.publicKey, writable: true }],
    'f=open("/sol/1","w")\nf.write("ABCDEFGHIJ")\nf.close()\n1',
    "Write 10 chars");

  // Test seek + read
  await test(connection, payer, programId,
    [{ pubkey: account.publicKey, writable: false }],
    'f=open("/sol/1","r")\nf.seek(5)\nd=f.read(2)\nf.close()\nd',
    "seek(5) + read(2)");

  // Test struct.unpack on binary data
  await test(connection, payer, programId,
    [{ pubkey: account.publicKey, writable: true }],
    'f=open("/sol/1","w")\nf.write("\\x39\\x30\\x00\\x00")\nf.close()\n1',
    "Write binary 12345");

  await test(connection, payer, programId,
    [{ pubkey: account.publicKey, writable: false }],
    'import struct\nf=open("/sol/1","r")\nd=f.read(4)\nf.close()\nstruct.unpack("<I",d)',
    "struct.unpack u32");

  // Test with real Pyth account
  console.log("\n=== Reading Real Pyth Account ===");
  var pythPubkey = new PublicKey(CONFIG.PYTH_SOL_USD_DEVNET);

  await test(connection, payer, programId,
    [{ pubkey: pythPubkey, writable: false }],
    'f=open("/sol/1","r")\nf.seek(208)\nd=f.read(8)\nf.close()\nlen(d)',
    "Pyth: seek(208) + read(8) length");

  await test(connection, payer, programId,
    [{ pubkey: pythPubkey, writable: false }],
    'import struct\nf=open("/sol/1","r")\nf.seek(208)\nd=f.read(8)\nf.close()\nstruct.unpack("<Q",d)',
    "Pyth: struct.unpack u64");

  console.log("\n=== Done ===");
}

main().catch(console.error);
