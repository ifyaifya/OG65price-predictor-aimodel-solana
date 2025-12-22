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

function compileFile(filePath) {
  const tempBin = "/tmp/test_compile.bin";
  execSync(COMPILER + " -f " + filePath + " -o " + tempBin, { stdio: "pipe" });
  return fs.readFileSync(tempBin);
}

function compileInline(code) {
  const tempPy = "/tmp/test_inline.py";
  fs.writeFileSync(tempPy, code);
  const tempBin = "/tmp/test_inline.bin";
  execSync(COMPILER + " -f " + tempPy + " -o " + tempBin, { stdio: "pipe" });
  return fs.readFileSync(tempBin);
}

async function executeAndCheck(connection, payer, programId, account, bytecode, desc) {
  console.log("\n=== " + desc + " ===");
  console.log("Bytecode size: " + bytecode.length + " bytes");

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

    const txInfo = await connection.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    console.log("TX SUCCESS - CU: " + (txInfo?.meta?.computeUnitsConsumed || "?"));

    // Show relevant logs
    if (txInfo?.meta?.logMessages) {
      txInfo.meta.logMessages.forEach(function(log) {
        if (log.includes("Error") || log.includes("return") || log.includes("NameError")) {
          console.log("  LOG: " + log);
        }
      });
    }

    // Read account data
    const info = await connection.getAccountInfo(account.publicKey);
    console.log("Account data[0:8]: [" + Array.from(info.data.slice(0, 8)).join(", ") + "]");
    return true;
  } catch (e) {
    console.error("TX FAILED:", e.message);
    if (e.transactionLogs) {
      e.transactionLogs.forEach(function(l) {
        if (l.includes("Error") || l.includes("NameError")) {
          console.log("  " + l);
        }
      });
    }
    return false;
  }
}

async function main() {
  console.log("=== File vs Inline Bytecode Test ===");

  const connection = new Connection(CONFIG.DEVNET_RPC, "confirmed");
  const payer = loadKeypair();
  const programId = new PublicKey(CONFIG.PROGRAM_ID);

  console.log("Payer: " + payer.publicKey.toBase58());

  // Create account
  const account = Keypair.generate();
  const lamports = await connection.getMinimumBalanceForRentExemption(128);
  console.log("Creating account...");

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
  console.log("Account: " + account.publicKey.toBase58());

  // Test 1: File-based script (test_bytes.py)
  const fileBytecode = compileFile("src/python/test_bytes.py");
  await executeAndCheck(connection, payer, programId, account, fileBytecode, "File-based: test_bytes.py");

  // Test 2: Inline script with same code
  const inlineCode = 'f=open("/sol/1","rb")\na=list(f.read())\nf.close()\na[0]=99\na[1]=100\ng=open("/sol/1","wb")\ng.write(bytes(a))\ng.close()\n99';
  const inlineBytecode = compileInline(inlineCode);
  await executeAndCheck(connection, payer, programId, account, inlineBytecode, "Inline: same code");

  // Test 3: Real script from project
  const realBytecode = compileFile("src/python/acc_sma.py");
  await executeAndCheck(connection, payer, programId, account, realBytecode, "Real: acc_sma.py");

  console.log("\n=== Done ===");
}

main().catch(console.error);
