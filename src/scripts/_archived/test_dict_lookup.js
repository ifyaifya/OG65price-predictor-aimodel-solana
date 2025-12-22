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
const fs = require("fs");
const path = require("path");

const CONFIG = {
  DEVNET_RPC: "https://api.devnet.solana.com",
  PROGRAM_ID: "AdvFUgScZPQmnkhCZ1ZFMN7c1rsanoE7TfYbikggUAxM",
  MODE_EXECUTE_SCRIPT: 0x00,
};

function loadKeypair() {
  const keypairPath = path.join(process.env.HOME, ".config", "solana", "id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath))));
}

async function testScript(connection, payer, programId, account, code, desc) {
  console.log("\n--- " + desc + " ---");

  var instrData = Buffer.concat([Buffer.from([CONFIG.MODE_EXECUTE_SCRIPT]), Buffer.from(code, "utf8")]);

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: account.publicKey, isSigner: false, isWritable: true },
    ],
    programId,
    data: instrData,
  });

  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }))
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
        if (log.includes("Error") || log.includes("NameError") || log.includes("TypeError") || log.includes("KeyError")) {
          console.log("  ERR: " + log.slice(0, 100));
        }
      });
    }

    const info = await connection.getAccountInfo(account.publicKey);
    if (info && info.data) {
      console.log("Data[0:8]: [" + Array.from(info.data.slice(0, 8)).join(", ") + "]");
    }

    if (txInfo?.meta?.returnData?.data && txInfo.meta.returnData.data[0]) {
      var ret = Buffer.from(txInfo.meta.returnData.data[0], "base64").toString("utf8");
      console.log("Return: " + ret);
    }

  } catch (e) {
    console.error("FAILED:", e.message.slice(0, 80));
  }
}

async function main() {
  console.log("=== Dict Lookup Tests ===");

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

  // Test 1: Simple dict creation and access
  await testScript(connection, payer, programId, account,
    'd={0:"A",1:"B",2:"C"}\nd[1]',
    "Dict access d[1]");

  // Test 2: Dict with computed key
  await testScript(connection, payer, programId, account,
    'd={0:"A",1:"B",2:"C"}\nn=1+1\nd[n]',
    "Dict with computed key");

  // Test 3: Write dict value
  await testScript(connection, payer, programId, account,
    'd={65:"A",66:"B",67:"C"}\nf=open("/sol/1","w")\nf.write(d[65]+d[66])\nf.close()\n1',
    "Write dict values");

  // Test 4: Small char lookup table (0-9)
  await testScript(connection, payer, programId, account,
    'C={0:"\\x00",1:"\\x01",2:"\\x02",3:"\\x03",4:"\\x04",5:"\\x05",6:"\\x06",7:"\\x07",8:"\\x08",9:"\\x09"}\nn=5\nf=open("/sol/1","w")\nf.write(C[n])\nf.close()\nn',
    "Char lookup table (0-9)");

  // Test 5: Verify written byte
  await testScript(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(1)\nf.close()\nd[0]',
    "Read back byte");

  console.log("\n=== Done ===");
}

main().catch(console.error);
