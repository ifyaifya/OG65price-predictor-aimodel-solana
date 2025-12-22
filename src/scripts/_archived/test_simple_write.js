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

async function main() {
  console.log("=== Simple Write Test ===\n");

  const connection = new Connection(CONFIG.DEVNET_RPC, "confirmed");
  const payer = loadKeypair();
  const programId = new PublicKey(CONFIG.PROGRAM_ID);

  console.log("Payer: " + payer.publicKey.toBase58());

  // Create account owned by program
  const account = Keypair.generate();
  const lamports = await connection.getMinimumBalanceForRentExemption(128);

  console.log("Creating account: " + account.publicKey.toBase58());

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
  console.log("Account created");

  // Very simple Python: just write 8 bytes
  const simplePy = "f=open(\"/sol/1\",\"wb\")\nf.write(bytes([1,2,3,4,5,6,7,8]))\nf.close()\n1";

  fs.writeFileSync("/tmp/simple_write.py", simplePy);
  execSync(COMPILER + " -f /tmp/simple_write.py -o /tmp/simple_write.bin", { stdio: "pipe" });
  const bytecode = fs.readFileSync("/tmp/simple_write.bin");
  console.log("Bytecode size: " + bytecode.length + " bytes");

  // Execute
  const ix = new TransactionInstruction({
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: account.publicKey, isSigner: false, isWritable: true },
    ],
    programId,
    data: Buffer.concat([Buffer.from([CONFIG.MODE_EXECUTE_BYTECODE]), bytecode]),
  });

  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }))
    .add(ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }))
    .add(ix);

  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
      skipPreflight: false,
      commitment: "confirmed"
    });
    console.log("TX: " + sig);

    // Read back
    const info = await connection.getAccountInfo(account.publicKey);
    console.log("Data: [" + Array.from(info.data.slice(0, 16)).join(", ") + "]");
    console.log("Write test PASSED");
  } catch (e) {
    console.error("Write test FAILED:", e.message);
    if (e.logs) {
      console.log("\nLogs:");
      e.logs.forEach(function(l) { console.log("  ", l); });
    }
    if (e.transactionLogs) {
      console.log("\nTransaction Logs:");
      e.transactionLogs.forEach(function(l) { console.log("  ", l); });
    }
  }
}

main().catch(console.error);
