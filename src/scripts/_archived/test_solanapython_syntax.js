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

function compileCode(code) {
  const tempPy = "/tmp/test_syntax.py";
  fs.writeFileSync(tempPy, code);
  const tempBin = "/tmp/test_syntax.bin";
  execSync(COMPILER + " -f " + tempPy + " -o " + tempBin, { stdio: "pipe" });
  return fs.readFileSync(tempBin);
}

async function test(connection, payer, programId, account, code, desc) {
  console.log("\n=== " + desc + " ===");
  console.log("Code:");
  code.split("\n").forEach(function(line) { console.log("  " + line); });

  var bytecode;
  try {
    bytecode = compileCode(code);
  } catch (e) {
    console.log("COMPILE ERROR: " + e.message);
    return false;
  }
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
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }))
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
        if (log.includes("Error") || log.includes("return") || log.includes("NameError") || log.includes("TypeError")) {
          console.log("  LOG: " + log);
        }
      });
    }

    // Check return data
    if (txInfo?.meta?.returnData?.data) {
      var ret = Buffer.from(txInfo.meta.returnData.data[0], "base64").toString("utf8");
      console.log("Return: " + ret);
    }

    // Read account data
    const info = await connection.getAccountInfo(account.publicKey);
    console.log("Account[0:8]: [" + Array.from(info.data.slice(0, 8)).join(", ") + "]");
    return true;
  } catch (e) {
    console.error("TX FAILED:", e.message.slice(0, 80));
    return false;
  }
}

async function main() {
  console.log("=== SolanaPython Syntax Tests ===\n");

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

  // Test 1: Simple return
  await test(connection, payer, programId, account, '42', "Simple return");

  // Test 2: bytearray write
  await test(connection, payer, programId, account,
    'f=open("/sol/1","wb")\nf.write(bytearray([11,22,33,44]))\nf.close()\n1',
    "bytearray write");

  // Test 3: struct.pack write
  await test(connection, payer, programId, account,
    'import struct\nf=open("/sol/1","wb")\nf.write(struct.pack("<I",[12345]))\nf.close()\n1',
    "struct.pack write u32");

  // Test 4: Read and index directly
  await test(connection, payer, programId, account,
    'f=open("/sol/1","rb")\nd=f.read()\nf.close()\nd[0]+d[1]*256',
    "Read and index (u16)");

  // Test 5: bytearray from read
  await test(connection, payer, programId, account,
    'f=open("/sol/1","rb")\nd=bytearray(f.read())\nf.close()\nd[0]',
    "bytearray from read");

  // Test 6: Modify bytearray and write back
  await test(connection, payer, programId, account,
    'f=open("/sol/1","rb")\nd=bytearray(f.read())\nf.close()\nd[0]=99\nd[1]=100\ng=open("/sol/1","wb")\ng.write(d)\ng.close()\n99',
    "Modify bytearray and write");

  // Test 7: Read final state
  await test(connection, payer, programId, account,
    'f=open("/sol/1","rb")\nd=f.read()\nf.close()\nd[0]',
    "Read final state");

  console.log("\n=== Done ===");
}

main().catch(console.error);
