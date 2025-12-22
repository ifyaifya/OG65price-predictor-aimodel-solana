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
  MODE_EXECUTE_BYTECODE: 0x02,
};

function loadKeypair() {
  const keypairPath = path.join(process.env.HOME, ".config", "solana", "id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath))));
}

async function testScript(connection, payer, programId, account, code, mode, desc) {
  console.log("\n--- " + desc + " (mode=" + mode + ") ---");
  console.log("Code: " + code.replace(/\n/g, " | "));

  var instrData;
  if (mode === CONFIG.MODE_EXECUTE_SCRIPT) {
    instrData = Buffer.concat([Buffer.from([mode]), Buffer.from(code, "utf8")]);
  } else {
    console.log("(bytecode mode not implemented in this test)");
    return;
  }

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

    // Show errors
    if (txInfo?.meta?.logMessages) {
      txInfo.meta.logMessages.forEach(function(log) {
        if (log.includes("Error") || log.includes("NameError")) {
          console.log("  ERR: " + log.slice(0, 80));
        }
      });
    }

    const info = await connection.getAccountInfo(account.publicKey);
    if (info && info.data) {
      console.log("Data[0:8]: [" + Array.from(info.data.slice(0, 8)).join(", ") + "]");
    }
    console.log("CU: " + (txInfo?.meta?.computeUnitsConsumed || "?"));

    if (txInfo?.meta?.returnData?.data && txInfo.meta.returnData.data[0]) {
      var ret = Buffer.from(txInfo.meta.returnData.data[0], "base64").toString("utf8");
      console.log("Return: " + ret);
    }

  } catch (e) {
    console.error("FAILED:", e.message.slice(0, 80));
  }
}

async function main() {
  console.log("=== Script Mode Tests ===");

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

  // Test with SCRIPT mode (0x00)
  await testScript(connection, payer, programId, account,
    'f=open("/sol/1","w")\nf.write("HELLO")\nf.close()\n1',
    CONFIG.MODE_EXECUTE_SCRIPT, "String write (SCRIPT)");

  // Test struct.pack with SCRIPT mode
  await testScript(connection, payer, programId, account,
    'import struct\nf=open("/sol/1","w")\nd=struct.pack("<I",[12345])\nf.write(d)\nf.close()\n1',
    CONFIG.MODE_EXECUTE_SCRIPT, "struct.pack write (SCRIPT)");

  // Test bytes literal
  await testScript(connection, payer, programId, account,
    'f=open("/sol/1","w")\nf.write(b"ABCD")\nf.close()\n1',
    CONFIG.MODE_EXECUTE_SCRIPT, "bytes literal write (SCRIPT)");

  // Test list and bytes functions
  await testScript(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=list(f.read())\nf.close()\nd[0]',
    CONFIG.MODE_EXECUTE_SCRIPT, "list() function (SCRIPT)");

  // Test bytearray modification
  await testScript(connection, payer, programId, account,
    'a=bytearray(8)\na[0]=65\na[1]=66\nf=open("/sol/1","w")\nf.write(a)\nf.close()\n1',
    CONFIG.MODE_EXECUTE_SCRIPT, "bytearray modify and write (SCRIPT)");

  console.log("\n=== Done ===");
}

main().catch(console.error);
