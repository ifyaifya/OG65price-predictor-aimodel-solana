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
  const tempPy = "/tmp/test_chr.py";
  fs.writeFileSync(tempPy, code);
  const tempBin = "/tmp/test_chr.bin";
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

    // Check for errors in logs
    if (txInfo?.meta?.logMessages) {
      txInfo.meta.logMessages.forEach(function(log) {
        if (log.includes("Error") || log.includes("NameError")) {
          console.log("  ERROR: " + log);
        }
      });
    }

    // Read account data
    const info = await connection.getAccountInfo(account.publicKey);
    console.log("Account[0:16]: [" + Array.from(info.data.slice(0, 16)).join(", ") + "]");

    // Return data
    if (txInfo?.meta?.returnData?.data) {
      var ret = Buffer.from(txInfo.meta.returnData.data[0], "base64").toString("utf8");
      console.log("Return: " + ret);
    }

  } catch (e) {
    console.error("FAILED:", e.message.slice(0, 80));
  }
}

async function main() {
  console.log("=== chr() Write Test ===");

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
  console.log("Account: " + account.publicKey.toBase58());

  // Test 1: chr() with string concat
  await test(connection, payer, programId, account,
    'f=open("/sol/1","w")\nf.write(chr(11)+chr(22)+chr(33)+chr(44))\nf.close()\n1',
    "chr() concat");

  // Test 2: String with escape codes
  await test(connection, payer, programId, account,
    'f=open("/sol/1","w")\nf.write("\\x0b\\x16\\x21\\x2c")\nf.close()\n1',
    "Escape codes");

  // Test 3: Read to verify
  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(4)\nf.close()\nord(d[0])+ord(d[1])*256',
    "Read and ord()");

  // Test 4: Write u32 using chr
  await test(connection, payer, programId, account,
    'v=12345\nf=open("/sol/1","w")\nf.write(chr(v&255)+chr((v>>8)&255)+chr((v>>16)&255)+chr((v>>24)&255))\nf.close()\nv',
    "Write u32 via chr()");

  // Test 5: Verify u32 read
  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(4)\nf.close()\nord(d[0])+ord(d[1])*256+ord(d[2])*65536+ord(d[3])*16777216',
    "Read u32 back");

  // Test 6: Read-modify-write pattern
  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read()\nf.close()\nb0=ord(d[0])\nb1=ord(d[1])\ng=open("/sol/1","w")\ng.write(chr(b0+1)+chr(b1+1))\ng.close()\nb0+1',
    "Read-modify-write");

  console.log("\n=== Done ===");
}

main().catch(console.error);
