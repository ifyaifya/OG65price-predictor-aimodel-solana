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
  const tempPy = "/tmp/test_loop.py";
  fs.writeFileSync(tempPy, code);
  const tempBin = "/tmp/test_loop.bin";
  execSync(COMPILER + " -f " + tempPy + " -o " + tempBin, { stdio: "pipe" });
  return fs.readFileSync(tempBin);
}

async function test(connection, payer, programId, account, code, desc) {
  console.log("\n--- " + desc + " ---");

  var bytecode;
  try {
    bytecode = compileCode(code);
  } catch (e) {
    console.log("COMPILE ERROR: " + e.message);
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
        if (log.includes("Error")) {
          console.log("  ERR: " + log.slice(0, 100));
        }
      });
    }

    if (txInfo?.meta?.returnData?.data && txInfo.meta.returnData.data[0]) {
      console.log("Return: " + Buffer.from(txInfo.meta.returnData.data[0], "base64").toString("utf8"));
    }
    console.log("CU: " + (txInfo?.meta?.computeUnitsConsumed || "?"));
    return true;

  } catch (e) {
    console.error("FAILED:", e.message.slice(0, 80));
  }
}

async function main() {
  console.log("=== Loop Tests ===");

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

  // Test 1: Simple while loop
  await test(connection, payer, programId, account,
    'i=0\nwhile i<5:i=i+1\ni',
    "Simple while i<5");

  // Test 2: for loop
  await test(connection, payer, programId, account,
    's=0\nfor i in range(5):s=s+i\ns',
    "for i in range(5)");

  // Test 3: Compare with 44 (comma)
  await test(connection, payer, programId, account,
    'c=44\nc==44',
    "Compare with 44");

  // Test 4: Read byte and compare
  await test(connection, payer, programId, account,
    'f=open("/sol/1","w")\nf.write("A,B")\nf.close()\n1',
    "Write A,B first");

  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(3)\nf.close()\nd[1]',
    "Read d[1] (should be 44)");

  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(3)\nf.close()\nd[1]==44',
    "d[1]==44 comparison");

  // Test 5: Slice syntax
  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(3)\nf.close()\nd[0:1]',
    "d[0:1] slice");

  // Test 6: int of slice
  await test(connection, payer, programId, account,
    'f=open("/sol/1","w")\nf.write("123,456")\nf.close()\n1',
    "Write 123,456");

  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(7)\nf.close()\nint(d[0:3])',
    "int(d[0:3])");

  console.log("\n=== Done ===");
}

main().catch(console.error);
