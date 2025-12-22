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

    try {
      const info = await connection.getAccountInfo(account.publicKey);
      if (info && info.data) {
        // Find end of text (first null byte)
        var end = 0;
        while (end < info.data.length && info.data[end] !== 0) end++;
        var text = info.data.slice(0, end).toString("utf8");
        console.log("Data: '" + text + "'");
      }
    } catch (e2) {
      console.log("Could not read account");
    }

    if (txInfo?.meta?.returnData?.data && txInfo.meta.returnData.data[0]) {
      var ret = Buffer.from(txInfo.meta.returnData.data[0], "base64").toString("utf8");
      console.log("Return: " + ret);
    }

    console.log("CU: " + (txInfo?.meta?.computeUnitsConsumed || "?"));

  } catch (e) {
    console.error("FAILED:", e.message.slice(0, 80));
  }
}

async function main() {
  console.log("=== Text Storage Tests ===");

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

  // Test 1: Write multiple values separated by comma
  await testScript(connection, payer, programId, account,
    'p=14023\ns=14100\nv=5\nm=128\nf=open("/sol/1","w")\nf.write(str(p)+","+str(s)+","+str(v)+","+str(m))\nf.close()\np',
    "Write CSV format");

  // Test 2: Read and parse first value
  await testScript(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read()\nf.close()\ni=0\nwhile d[i]!=44:i=i+1\nint(d[0:i])',
    "Parse first value (manual)");

  // Test 3: Check if split() exists
  await testScript(connection, payer, programId, account,
    's="a,b,c"\ns.split(",")',
    "split() method");

  // Test 4: Simulated Pyth read + write
  await testScript(connection, payer, programId, account,
    'price=14023\nprev1=14000\nprev2=13950\nprev3=13900\nsma=(price+prev1+prev2+prev3)//4\nf=open("/sol/1","w")\nf.write(str(price)+","+str(prev1)+","+str(prev2)+","+str(prev3)+","+str(sma))\nf.close()\nsma',
    "Price + SMA calculation");

  // Test 5: Parse back and compute
  await testScript(connection, payer, programId, account,
    'f=open("/sol/1","r")\nd=f.read(50)\nf.close()\ni=0\nwhile d[i]!=44:i=i+1\np=int(d[0:i])\np+100',
    "Parse and compute");

  console.log("\n=== Done ===");
}

main().catch(console.error);
