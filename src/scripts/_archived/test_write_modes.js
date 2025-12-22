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

function loadKeypair() {
  const keypairPath = path.join(process.env.HOME, ".config", "solana", "id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath))));
}

function compilePython(code) {
  fs.writeFileSync("/tmp/test_mode.py", code);
  execSync(COMPILER + " -f /tmp/test_mode.py -o /tmp/test_mode.bin", { stdio: "pipe" });
  return fs.readFileSync("/tmp/test_mode.bin");
}

async function testWrite(connection, payer, programId, account, code, description) {
  console.log("\n--- " + description + " ---");
  console.log("Python: " + code.replace(/\n/g, " | "));

  const bytecode = compilePython(code);
  console.log("Bytecode: " + bytecode.length + " bytes");

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: account.publicKey, isSigner: false, isWritable: true },
    ],
    programId,
    data: Buffer.concat([Buffer.from([CONFIG.MODE_EXECUTE_BYTECODE]), bytecode]),
  });

  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }))
    .add(ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }))
    .add(ix);

  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
      skipPreflight: true,
      commitment: "confirmed"
    });

    // Get logs
    const txInfo = await connection.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    console.log("TX SUCCESS - CU: " + (txInfo?.meta?.computeUnitsConsumed || "?"));
    if (txInfo?.meta?.logMessages) {
      txInfo.meta.logMessages.forEach(function(log) {
        if (log.includes("Program log") || log.includes("return")) {
          console.log("  " + log);
        }
      });
    }

    // Read account data
    const info = await connection.getAccountInfo(account.publicKey);
    console.log("Account data[0:16]: [" + Array.from(info.data.slice(0, 16)).join(", ") + "]");
    return true;
  } catch (e) {
    console.error("TX FAILED:", e.message);
    if (e.transactionLogs) {
      e.transactionLogs.forEach(function(l) { console.log("  " + l); });
    }
    return false;
  }
}

async function main() {
  console.log("=== Write Mode Tests ===");

  const connection = new Connection(CONFIG.DEVNET_RPC, "confirmed");
  const payer = loadKeypair();
  const programId = new PublicKey(CONFIG.PROGRAM_ID);

  console.log("Payer: " + payer.publicKey.toBase58());

  // Create account
  const account = Keypair.generate();
  const lamports = await connection.getMinimumBalanceForRentExemption(128);
  console.log("Creating account: " + account.publicKey.toBase58());

  const createTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: account.publicKey,
      lamports,
      space: 128,
      programId,
    })
  );
  await sendAndConfirmTransaction(connection, createTx, [payer, account]);
  console.log("Account created");

  // Test different write modes

  // Test 1: wb mode
  await testWrite(connection, payer, programId, account,
    'f=open("/sol/1","wb")\nf.write(bytes([11,22,33,44]))\nf.close()\n1',
    "wb mode - simple write"
  );

  // Test 2: r+b mode with explicit seek
  await testWrite(connection, payer, programId, account,
    'f=open("/sol/1","r+b")\nf.seek(0)\nf.write(bytes([55,66,77,88]))\nf.close()\n1',
    "r+b mode with seek(0)"
  );

  // Test 3: Direct bytes assignment to data variable
  await testWrite(connection, payer, programId, account,
    'f=open("/sol/1","rb")\nd=list(f.read())\nf.close()\nd[0]=99\nd[1]=100\ng=open("/sol/1","wb")\ng.write(bytes(d))\ng.close()\n99',
    "read-modify-write pattern"
  );

  // Test 4: Just return to see if program runs
  await testWrite(connection, payer, programId, account,
    '42',
    "Simple return 42"
  );

  console.log("\n=== Done ===");
}

main().catch(console.error);
