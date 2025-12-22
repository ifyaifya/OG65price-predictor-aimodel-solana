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
  const tempPy = "/tmp/test_debug.py";
  fs.writeFileSync(tempPy, code);
  const tempBin = "/tmp/test_debug.bin";
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

    // Log all program logs for debugging
    if (txInfo?.meta?.logMessages) {
      txInfo.meta.logMessages.forEach(function(log) {
        if (log.includes("Program log:") && !log.includes("bytecode")) {
          console.log("  " + log.replace("Program log: ", ""));
        }
      });
    }

    const info = await connection.getAccountInfo(account.publicKey);
    console.log("Data[0:8]: [" + Array.from(info.data.slice(0, 8)).join(", ") + "]");

    if (txInfo?.meta?.returnData?.data) {
      var ret = Buffer.from(txInfo.meta.returnData.data[0], "base64").toString("utf8");
      console.log("Return: " + ret);
    }

  } catch (e) {
    console.error("FAILED:", e.message.slice(0, 80));
  }
}

async function main() {
  console.log("=== struct Debug Tests ===");

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

  // Test 1: What type is struct.pack result?
  await test(connection, payer, programId, account,
    'import struct\ntype(struct.pack("<I",[65]))',
    "struct.pack type");

  // Test 2: len of struct.pack
  await test(connection, payer, programId, account,
    'import struct\nlen(struct.pack("<I",[65]))',
    "struct.pack len");

  // Test 3: Concat with string then write
  await test(connection, payer, programId, account,
    'import struct\nf=open("/sol/1","w")\nd=struct.pack("<B",[65])\nf.write(""+d)\nf.close()\n1',
    "Concat with empty string");

  // Test 4: Direct write of byte literal for comparison
  await test(connection, payer, programId, account,
    'f=open("/sol/1","w")\nf.write("A")\nf.close()\n1',
    "Direct string A (65)");

  // Test 5: Check b"" bytes literal type
  await test(connection, payer, programId, account,
    'type(b"hello")',
    "b literal type");

  // Test 6: Write bytes literal
  await test(connection, payer, programId, account,
    'f=open("/sol/1","w")\nf.write(b"XYZ")\nf.close()\n1',
    "Write b literal");

  // Test 7: struct.pack concat with b""
  await test(connection, payer, programId, account,
    'import struct\nd=b""+struct.pack("<I",[12345])\nlen(d)',
    "b+struct.pack len");

  // Test 8: Write b"" + struct.pack
  await test(connection, payer, programId, account,
    'import struct\nf=open("/sol/1","w")\nf.write(b""+struct.pack("<I",[12345]))\nf.close()\n1',
    "Write b+struct.pack");

  console.log("\n=== Done ===");
}

main().catch(console.error);
