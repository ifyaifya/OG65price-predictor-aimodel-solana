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
  const tempPy = "/tmp/test_dyn.py";
  fs.writeFileSync(tempPy, code);
  const tempBin = "/tmp/test_dyn.bin";
  execSync(COMPILER + " -f " + tempPy + " -o " + tempBin, { stdio: "pipe" });
  return fs.readFileSync(tempBin);
}

async function test(connection, payer, programId, account, code, desc) {
  console.log("\n--- " + desc + " ---");

  var bytecode;
  try {
    bytecode = compileCode(code);
  } catch (e) {
    console.log("COMPILE ERROR");
    return;
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

    // Check for errors
    var hasError = false;
    if (txInfo?.meta?.logMessages) {
      txInfo.meta.logMessages.forEach(function(log) {
        if (log.includes("NameError") || log.includes("TypeError")) {
          console.log("  ERR: " + log.slice(0, 80));
          hasError = true;
        }
      });
    }

    // Read account data
    const info = await connection.getAccountInfo(account.publicKey);
    console.log("Data[0:16]: [" + Array.from(info.data.slice(0, 16)).join(", ") + "]");

    if (txInfo?.meta?.returnData?.data) {
      var ret = Buffer.from(txInfo.meta.returnData.data[0], "base64").toString("utf8");
      console.log("Return: " + ret);
    }

    return !hasError;

  } catch (e) {
    console.error("FAILED:", e.message.slice(0, 60));
    return false;
  }
}

async function main() {
  console.log("=== Dynamic Write Tests ===");

  const connection = new Connection(CONFIG.DEVNET_RPC, "confirmed");
  const payer = loadKeypair();
  const programId = new PublicKey(CONFIG.PROGRAM_ID);

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

  // Build a lookup table of all single-byte strings
  // C = "\x00\x01\x02..." (256 chars)
  // Then C[n] gives the char for byte n

  // Test 1: Create char lookup and use it
  var charTableCode = 'C="';
  for (var i = 0; i < 256; i++) {
    if (i === 0) charTableCode += "\\x00";
    else if (i === 10) charTableCode += "\\x0a";
    else if (i === 13) charTableCode += "\\x0d";
    else if (i === 34) charTableCode += "\\x22"; // "
    else if (i === 92) charTableCode += "\\x5c"; // \
    else if (i >= 32 && i < 127) charTableCode += String.fromCharCode(i);
    else charTableCode += "\\x" + i.toString(16).padStart(2, "0");
  }
  charTableCode += '"';

  await test(connection, payer, programId, account,
    charTableCode + '\nf=open("/sol/1","w")\nf.write(C[11]+C[22]+C[33]+C[44])\nf.close()\n1',
    "Char lookup table");

  // Test 2: Dynamic u32 write using lookup table
  await test(connection, payer, programId, account,
    charTableCode + '\nv=12345\nf=open("/sol/1","w")\nf.write(C[v&255]+C[(v>>8)&255]+C[(v>>16)&255]+C[(v>>24)&255])\nf.close()\nv',
    "Dynamic u32 write");

  // Test 3: Read back to verify
  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(4)\nf.close()\nd[0]+d[1]*256+d[2]*65536+d[3]*16777216',
    "Read u32 back");

  // Test 4: Read-modify-write pattern
  await test(connection, payer, programId, account,
    charTableCode + '\nf=open("/sol/1","r")\nd=f.read(4)\nf.close()\nv=d[0]+d[1]*256\nv=v+1\ng=open("/sol/1","w")\ng.write(C[v&255]+C[(v>>8)&255])\ng.close()\nv',
    "Read-modify-write u16");

  console.log("\n=== Done ===");
}

main().catch(console.error);
