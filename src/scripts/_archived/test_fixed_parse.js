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
  const tempPy = "/tmp/test_fixed.py";
  fs.writeFileSync(tempPy, code);
  const tempBin = "/tmp/test_fixed.bin";
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

    var hasError = false;
    if (txInfo && txInfo.meta && txInfo.meta.logMessages) {
      txInfo.meta.logMessages.forEach(function(log) {
        if (log.includes("Error") && !log.includes("bytecode")) {
          console.log("  ERR: " + log.slice(0, 100));
          hasError = true;
        }
      });
    }

    if (txInfo && txInfo.meta && txInfo.meta.returnData && txInfo.meta.returnData.data && txInfo.meta.returnData.data[0]) {
      console.log("Return: " + Buffer.from(txInfo.meta.returnData.data[0], "base64").toString("utf8"));
    }
    if (txInfo && txInfo.meta) {
      console.log("CU: " + txInfo.meta.computeUnitsConsumed);
    }

  } catch (e) {
    console.error("FAILED TX");
  }
}

async function main() {
  console.log("=== Fixed Position Parse Tests ===");

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

  // Use fixed-width format: each value is 8 chars padded with spaces
  // "  14023   14000   13950   13900"
  // Positions: 0-7, 8-15, 16-23, 24-31

  // Test 1: Write fixed format
  await test(connection, payer, programId, account,
    'p0=14023\np1=14000\np2=13950\np3=13900\ns0=str(p0)\ns1=str(p1)\ns2=str(p2)\ns3=str(p3)\nf=open("/sol/1","w")\nf.write(s0+","+s1+","+s2+","+s3)\nf.close()\np0',
    "Write 4 prices");

  // Test 2: Read raw
  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(30)\nf.close()\nd',
    "Read raw");

  // Test 3: Parse with fixed slice (first 5 chars)
  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(30)\nf.close()\nint(d[0:5])',
    "int(d[0:5])");

  // Test 4: Read individual bytes
  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(30)\nf.close()\nd[0]',
    "d[0]");

  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(30)\nf.close()\nd[5]',
    "d[5] (should be comma=44)");

  // Test 5: Parse using byte math instead of slice
  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(5)\nf.close()\n(d[0]-48)*10000+(d[1]-48)*1000+(d[2]-48)*100+(d[3]-48)*10+(d[4]-48)',
    "Parse 5-digit number with math");

  // Test 6: Compute SMA using direct byte access
  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(30)\nf.close()\np0=(d[0]-48)*10000+(d[1]-48)*1000+(d[2]-48)*100+(d[3]-48)*10+(d[4]-48)\np0',
    "Parse price p0");

  console.log("\n=== Done ===");
}

main().catch(console.error);
