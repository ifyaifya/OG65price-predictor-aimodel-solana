const {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  SystemProgram,
  sendAndConfirmTransaction,
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
  const tempPy = "/tmp/test_write.py";
  fs.writeFileSync(tempPy, code);
  const tempBin = "/tmp/test_write.bin";
  execSync(COMPILER + " -f " + tempPy + " -o " + tempBin, { stdio: "pipe" });
  return fs.readFileSync(tempBin);
}

async function runTest(connection, payer, programId, account, code, desc) {
  console.log("\n--- " + desc + " ---");
  console.log("Code:", code.replace(/\n/g, " | "));

  var bytecode;
  try {
    bytecode = compileCode(code);
  } catch (e) {
    console.log("COMPILE ERROR");
    return null;
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
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }))
    .add(ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }))
    .add(ix);

  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  const simResult = await connection.simulateTransaction(tx);
  if (simResult.value.err) {
    console.log("SIM ERROR:", JSON.stringify(simResult.value.err));
    if (simResult.value.logs) {
      simResult.value.logs.slice(-3).forEach(function(log) {
        console.log("  " + log);
      });
    }
    return null;
  }

  var ret = null;
  if (simResult.value.returnData && simResult.value.returnData.data && simResult.value.returnData.data[0]) {
    ret = Buffer.from(simResult.value.returnData.data[0], "base64").toString("utf8");
    console.log("Return:", ret);
  }

  var cuLog = simResult.value.logs?.find(function(log) { return log.includes("consumed"); });
  if (cuLog) {
    var match = cuLog.match(/consumed (\d+) of/);
    if (match) console.log("CU:", match[1]);
  }

  // Actually send to persist
  await sendAndConfirmTransaction(connection, tx, [payer], {
    skipPreflight: true,
    commitment: "confirmed"
  });

  return ret;
}

async function main() {
  console.log("=== Write with str() Tests ===");

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
  console.log("Account:", account.publicKey.toBase58().slice(0, 20) + "...");

  // Test 1: Write single str
  await runTest(connection, payer, programId, account,
    'f=open("/sol/1","w")\nf.write(str(13981))\nf.close()\n1',
    "Write str(13981)");

  // Read back
  await runTest(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(5)\nf.close()\nd',
    "Read back");

  // Test 2: Write concatenated str
  await runTest(connection, payer, programId, account,
    'f=open("/sol/1","w")\nf.write(str(13981)+str(14000))\nf.close()\n1',
    "Write str(13981)+str(14000)");

  // Read back
  await runTest(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(10)\nf.close()\nd',
    "Read back 10 chars");

  // Test 3: Write 5 values
  await runTest(connection, payer, programId, account,
    'f=open("/sol/1","w")\nf.write(str(13981)+str(14000)+str(13950)+str(13900)+str(13957))\nf.close()\n1',
    "Write 5 values concatenated");

  // Read back
  await runTest(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(25)\nf.close()\nd',
    "Read back 25 chars");

  // Test 4: Read, compute, write
  await runTest(connection, payer, programId, account,
    'f=open("/sol/1","r")\np0=int(f.read(5))\np1=int(f.read(5))\np2=int(f.read(5))\np3=int(f.read(5))\nf.close()\nsma=(p0+p1+p2+p3)//4\ng=open("/sol/1","w")\ng.write(str(p0)+str(p1)+str(p2)+str(p3)+str(sma))\ng.close()\nsma',
    "Full read-compute-write (no zfill)");

  // Read back final
  await runTest(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(25)\nf.close()\nd',
    "Read final state");

  console.log("\n=== Done ===");
}

main().catch(console.error);
