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
  const tempPy = "/tmp/test_rw.py";
  fs.writeFileSync(tempPy, code);
  const tempBin = "/tmp/test_rw.bin";
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
    console.error("FAILED TX: " + e.message.slice(0, 60));
    return false;
  }
}

async function main() {
  console.log("=== Simple Read/Write Tests ===");

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
  console.log("Account: " + account.publicKey.toBase58());

  // Step 1: Write simple string
  var ok = await test(connection, payer, programId, account,
    'f=open("/sol/1","w")\nf.write("14023")\nf.close()\n1',
    "Write '14023'");
  if (!ok) return;

  // Step 2: Read it back
  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(5)\nf.close()\nd',
    "Read 5 bytes");

  // Step 3: Parse with int()
  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(5)\nf.close()\nint(d)',
    "int(read)");

  // Step 4: Access individual byte
  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(5)\nf.close()\nd[0]',
    "d[0]");

  // Step 5: Byte math
  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(5)\nf.close()\nd[0]-48',
    "d[0]-48 (should be 1)");

  // Step 6: Read-modify-write
  ok = await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(5)\nf.close()\nv=int(d)+100\ng=open("/sol/1","w")\ng.write(str(v))\ng.close()\nv',
    "Read, add 100, write back");
  if (!ok) return;

  // Step 7: Verify
  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(6)\nf.close()\nint(d)',
    "Verify new value");

  console.log("\n=== Done ===");
}

main().catch(console.error);
