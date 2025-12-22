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
  const tempPy = "/tmp/test_write.py";
  fs.writeFileSync(tempPy, code);
  const tempBin = "/tmp/test_write.bin";
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
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }))
    .add(ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }))
    .add(ix);

  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
      skipPreflight: true,
      commitment: "confirmed"
    });

    await new Promise(function(r) { setTimeout(r, 500); });

    // Read account data
    const info = await connection.getAccountInfo(account.publicKey);
    console.log("Account[0:16]: [" + Array.from(info.data.slice(0, 16)).join(", ") + "]");

    // Check for known patterns
    var dataStr = "";
    for (var i = 0; i < Math.min(16, info.data.length); i++) {
      if (info.data[i] >= 32 && info.data[i] < 127) {
        dataStr += String.fromCharCode(info.data[i]);
      } else if (info.data[i] > 0) {
        dataStr += ".";
      }
    }
    if (dataStr.length > 0) console.log("As text: '" + dataStr + "'");

  } catch (e) {
    console.error("FAILED:", e.message.slice(0, 60));
  }
}

async function main() {
  console.log("=== Write Methods Test ===");

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

  // Test 1: Text mode write (like VFS tests)
  await test(connection, payer, programId, account,
    'f=open("/sol/1","w")\nf.write("HELLO")\nf.close()\n1',
    "Text mode write (w)");

  // Test 2: Binary mode with bytearray
  await test(connection, payer, programId, account,
    'f=open("/sol/1","wb")\nf.write(bytearray([65,66,67,68]))\nf.close()\n1',
    "Binary bytearray write (wb)");

  // Test 3: struct.pack with correct syntax
  await test(connection, payer, programId, account,
    'import struct\nf=open("/sol/1","wb")\nd=struct.pack("<I",[0x44434241])\nf.write(d)\nf.close()\n1',
    "struct.pack u32 write");

  // Test 4: b"" bytes literal
  await test(connection, payer, programId, account,
    'f=open("/sol/1","wb")\nf.write(b"EFGH")\nf.close()\n1',
    "Bytes literal write");

  // Test 5: Multiple struct.pack calls
  await test(connection, payer, programId, account,
    'import struct\nf=open("/sol/1","wb")\nf.write(struct.pack("<I",[11]))\nf.write(struct.pack("<I",[22]))\nf.close()\n1',
    "Multiple struct.pack writes");

  // Test 6: Read what we wrote
  await test(connection, payer, programId, account,
    'f=open("/sol/1","rb")\nd=f.read()\nf.close()\nd[0]+d[1]*256+d[2]*65536+d[3]*16777216',
    "Read u32");

  console.log("\n=== Done ===");
}

main().catch(console.error);
