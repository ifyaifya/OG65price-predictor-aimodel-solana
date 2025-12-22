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
  const tempPy = "/tmp/test_str.py";
  fs.writeFileSync(tempPy, code);
  const tempBin = "/tmp/test_str.bin";
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
        if (log.includes("NameError") || log.includes("TypeError")) {
          console.log("  ERR: " + log.slice(0, 80));
        }
      });
    }

    const info = await connection.getAccountInfo(account.publicKey);
    if (info && info.data) {
      var end = 0;
      while (end < 32 && info.data[end] !== 0) end++;
      console.log("Data: [" + Array.from(info.data.slice(0, 16)).join(",") + "]");
      if (end > 0) {
        console.log("Text: '" + info.data.slice(0, end).toString("utf8") + "'");
      }
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
  console.log("=== Bytecode str() Write Tests ===");

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

  // Test 1: str() returns string
  await test(connection, payer, programId, account,
    'str(12345)',
    "str(12345)");

  // Test 2: Write str(n)
  await test(connection, payer, programId, account,
    'n=67890\nf=open("/sol/1","w")\nf.write(str(n))\nf.close()\nn',
    "Write str(n)");

  // Test 3: Read back and parse with int()
  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(5)\nf.close()\nint(d)',
    "Read and int()");

  // Test 4: Write multiple values with separator
  await test(connection, payer, programId, account,
    'a=14023\nb=14000\nf=open("/sol/1","w")\nf.write(str(a)+","+str(b))\nf.close()\na',
    "Write CSV");

  // Test 5: Read and compute
  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(20)\nf.close()\nd',
    "Read back CSV");

  console.log("\n=== Done ===");
}

main().catch(console.error);
