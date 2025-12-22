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
  const tempPy = "/tmp/test_csv.py";
  fs.writeFileSync(tempPy, code);
  const tempBin = "/tmp/test_csv.bin";
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

    if (txInfo?.meta?.logMessages) {
      txInfo.meta.logMessages.forEach(function(log) {
        if (log.includes("NameError") || log.includes("TypeError") || log.includes("IndexError")) {
          console.log("  ERR: " + log.slice(0, 80));
        }
      });
    }

    const info = await connection.getAccountInfo(account.publicKey);
    if (info && info.data) {
      var end = 0;
      while (end < 64 && info.data[end] !== 0) end++;
      if (end > 0) console.log("Data: '" + info.data.slice(0, end).toString("utf8") + "'");
    }

    if (txInfo?.meta?.returnData?.data && txInfo.meta.returnData.data[0]) {
      console.log("Return: " + Buffer.from(txInfo.meta.returnData.data[0], "base64").toString("utf8"));
    }
    console.log("CU: " + (txInfo?.meta?.computeUnitsConsumed || "?"));

  } catch (e) {
    console.error("FAILED:", e.message.slice(0, 80));
  }
}

async function main() {
  console.log("=== CSV Parsing Tests ===");

  const connection = new Connection(CONFIG.DEVNET_RPC, "confirmed");
  const payer = loadKeypair();
  const programId = new PublicKey(CONFIG.PROGRAM_ID);

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

  // First write test data
  await test(connection, payer, programId, account,
    'f=open("/sol/1","w")\nf.write("14023,14000,13950,13900")\nf.close()\n1',
    "Write test CSV data");

  // Test 1: Find comma position manually
  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(30)\nf.close()\ni=0\nwhile d[i]!=44:i=i+1\ni',
    "Find first comma position");

  // Test 2: Parse first value using slice notation
  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(30)\nf.close()\ni=0\nwhile d[i]!=44:i=i+1\nint(d[0:i])',
    "Parse first value (slice)");

  // Test 3: Parse second value - find second comma
  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(30)\nf.close()\ni=0\nwhile d[i]!=44:i=i+1\nj=i+1\nwhile d[j]!=44:j=j+1\nint(d[i+1:j])',
    "Parse second value");

  // Test 4: Compute SMA
  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(30)\nf.close()\ni=0\nwhile d[i]!=44:i=i+1\np0=int(d[0:i])\nj=i+1\nwhile d[j]!=44:j=j+1\np1=int(d[i+1:j])\n(p0+p1)//2',
    "Compute average of 2 values");

  // Test 5: Read, modify, write back
  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(30)\nf.close()\ni=0\nwhile d[i]!=44:i=i+1\np0=int(d[0:i])\np0=p0+100\ng=open("/sol/1","w")\ng.write(str(p0)+","+d[i+1:])\ng.close()\np0',
    "Read-modify-write");

  // Test 6: Verify
  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(30)\nf.close()\nd',
    "Verify modified data");

  console.log("\n=== Done ===");
}

main().catch(console.error);
