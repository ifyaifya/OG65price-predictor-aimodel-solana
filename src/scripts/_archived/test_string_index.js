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
  const tempPy = "/tmp/test_idx.py";
  fs.writeFileSync(tempPy, code);
  const tempBin = "/tmp/test_idx.bin";
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
    if (txInfo?.meta?.logMessages) {
      txInfo.meta.logMessages.forEach(function(log) {
        if (log.includes("NameError") || log.includes("TypeError") || log.includes("IndexError")) {
          console.log("  ERR: " + log.slice(0, 80));
        }
      });
    }

    // Read account
    const info = await connection.getAccountInfo(account.publicKey);
    console.log("Data[0:8]: [" + Array.from(info.data.slice(0, 8)).join(", ") + "]");

    if (txInfo?.meta?.returnData?.data) {
      var ret = Buffer.from(txInfo.meta.returnData.data[0], "base64").toString("utf8");
      console.log("Return: " + ret);
    }

  } catch (e) {
    console.error("FAILED:", e.message.slice(0, 60));
  }
}

async function main() {
  console.log("=== String Indexing Tests ===");

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

  // Test 1: String length
  await test(connection, payer, programId, account,
    's="ABCD"\nlen(s)',
    "String length");

  // Test 2: String index access
  await test(connection, payer, programId, account,
    's="ABCD"\ns[0]',
    "String index s[0]");

  // Test 3: String index with variable
  await test(connection, payer, programId, account,
    's="ABCD"\ni=2\ns[i]',
    "String index with var");

  // Test 4: Write string char
  await test(connection, payer, programId, account,
    's="ABCD"\nf=open("/sol/1","w")\nf.write(s[1])\nf.close()\n1',
    "Write s[1]");

  // Test 5: Verify written char
  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(1)\nf.close()\nd',
    "Read back char");

  // Test 6: Simple small lookup (0-9 only)
  await test(connection, payer, programId, account,
    'D="0123456789"\nn=7\nf=open("/sol/1","w")\nf.write(D[n])\nf.close()\nn',
    "Small digit lookup");

  console.log("\n=== Done ===");
}

main().catch(console.error);
