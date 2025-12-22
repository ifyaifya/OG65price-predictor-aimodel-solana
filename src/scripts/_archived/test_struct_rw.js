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
  const tempPy = "/tmp/test_struct_rw.py";
  fs.writeFileSync(tempPy, code);
  const tempBin = "/tmp/test_struct_rw.bin";
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

    // Log relevant messages
    if (txInfo?.meta?.logMessages) {
      txInfo.meta.logMessages.forEach(function(log) {
        if (log.includes("NameError") || log.includes("TypeError") || log.includes("Error")) {
          console.log("  ERR: " + log.slice(0, 100));
        }
      });
    }

    const info = await connection.getAccountInfo(account.publicKey);
    console.log("Data[0:16]: [" + Array.from(info.data.slice(0, 16)).join(", ") + "]");

    if (txInfo?.meta?.returnData?.data) {
      var ret = Buffer.from(txInfo.meta.returnData.data[0], "base64").toString("utf8");
      console.log("Return: " + ret);
    }

  } catch (e) {
    console.error("FAILED:", e.message.slice(0, 80));
  }
}

async function main() {
  console.log("=== struct.pack Read/Write Tests ===");

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

  // Test 1: struct.pack write with text mode
  await test(connection, payer, programId, account,
    'import struct\nf=open("/sol/1","w")\nf.write(struct.pack("<I",[12345]))\nf.close()\n1',
    "struct.pack u32 write (text mode)");

  // Test 2: Read and unpack
  await test(connection, payer, programId, account,
    'import struct\nf=open("/sol/1","r")\nd=f.read(4)\nf.close()\nstruct.unpack("<I",d)[0]',
    "Read and struct.unpack u32");

  // Test 3: Write multiple values
  await test(connection, payer, programId, account,
    'import struct\nf=open("/sol/1","w")\nf.write(struct.pack("<I",[11111]))\nf.write(struct.pack("<I",[22222]))\nf.close()\n1',
    "Write multiple u32");

  // Test 4: Read-modify-write
  await test(connection, payer, programId, account,
    'import struct\nf=open("/sol/1","r")\nd=f.read(4)\nf.close()\nv=struct.unpack("<I",d)[0]\nv=v+1000\ng=open("/sol/1","w")\ng.write(struct.pack("<I",[v]))\ng.close()\nv',
    "Read-modify-write");

  // Test 5: Verify modified value
  await test(connection, payer, programId, account,
    'import struct\nf=open("/sol/1","r")\nd=f.read(4)\nf.close()\nstruct.unpack("<I",d)[0]',
    "Verify modified value");

  // Test 6: Write u64
  await test(connection, payer, programId, account,
    'import struct\nf=open("/sol/1","w")\nf.write(struct.pack("<Q",[9999999999]))\nf.close()\n1',
    "Write u64");

  // Test 7: Read u64
  await test(connection, payer, programId, account,
    'import struct\nf=open("/sol/1","r")\nd=f.read(8)\nf.close()\nstruct.unpack("<Q",d)[0]',
    "Read u64");

  console.log("\n=== Done ===");
}

main().catch(console.error);
