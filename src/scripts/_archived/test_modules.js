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
        if (log.includes("Error") || log.includes("NameError")) {
          console.log("  ERR: " + log.slice(0, 100));
        }
      });
    }

    const info = await connection.getAccountInfo(account.publicKey);
    if (info && info.data) {
      console.log("Data[0:16]: [" + Array.from(info.data.slice(0, 16)).join(", ") + "]");
      // Also show as text
      var text = "";
      for (var i = 0; i < 16 && info.data[i] > 0; i++) {
        if (info.data[i] >= 32 && info.data[i] < 127) text += String.fromCharCode(info.data[i]);
        else text += ".";
      }
      if (text) console.log("As text: '" + text + "'");
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
  console.log("=== Module Tests ===");

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

  // Test 1: json.dumps number - writes as string "12345"
  await testScript(connection, payer, programId, account,
    'import json\nn=12345\nf=open("/sol/1","w")\nf.write(json.dumps(n))\nf.close()\nn',
    "json.dumps number");

  // Test 2: Verify what was written
  await testScript(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(10)\nf.close()\nd',
    "Read json string");

  // Test 3: json.loads to parse
  await testScript(connection, payer, programId, account,
    'import json\nf=open("/sol/1","r")\nd=f.read(5)\nf.close()\njson.loads(d)',
    "json.loads");

  // Test 4: str() function
  await testScript(connection, payer, programId, account,
    'n=12345\nstr(n)',
    "str() function");

  // Test 5: Write str(n)
  await testScript(connection, payer, programId, account,
    'n=67890\nf=open("/sol/1","w")\nf.write(str(n))\nf.close()\nn',
    "Write str(n)");

  // Test 6: int() function
  await testScript(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(5)\nf.close()\nint(d)',
    "int() to parse");

  // Test 7: hex() function
  await testScript(connection, payer, programId, account,
    'n=255\nhex(n)',
    "hex() function");

  console.log("\n=== Done ===");
}

main().catch(console.error);
