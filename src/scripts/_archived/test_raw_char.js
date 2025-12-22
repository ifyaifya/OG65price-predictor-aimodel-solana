const { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, sendAndConfirmTransaction, ComputeBudgetProgram, SystemProgram } = require("@solana/web3.js");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const DEVNET_RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = "AdvFUgScZPQmnkhCZ1ZFMN7c1rsanoE7TfYbikggUAxM";
const COMPILER = "/Users/true/Documents/Pipeline/CasterCorp/modelonSolana/solanapython-build/solana/tools/pika_compile";

function loadKeypair() {
  const keypairPath = path.join(process.env.HOME, ".config", "solana", "id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath))));
}

async function main() {
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const payer = loadKeypair();
  const programId = new PublicKey(PROGRAM_ID);

  const testAcc = Keypair.generate();
  const lamports = await connection.getMinimumBalanceForRentExemption(128);

  const createTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: testAcc.publicKey,
      lamports,
      space: 128,
      programId,
    })
  );
  await sendAndConfirmTransaction(connection, createTx, [payer, testAcc]);
  console.log("Created test account:", testAcc.publicKey.toBase58());

  // Use pre-compiled bytecode with raw \x0f character
  const bytecode = fs.readFileSync("/tmp/test_raw_char.bin");
  console.log("Bytecode size:", bytecode.length);

  const keys = [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: testAcc.publicKey, isSigner: false, isWritable: true },
  ];

  const ix = new TransactionInstruction({
    keys,
    programId,
    data: Buffer.concat([Buffer.from([0x02]), bytecode]),
  });

  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500000 }))
    .add(ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }))
    .add(ix);

  const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
    skipPreflight: true,
    commitment: "confirmed",
  });
  console.log("Write TX:", sig);

  const accInfo = await connection.getAccountInfo(testAcc.publicKey);
  console.log("Account data (first 16 bytes hex):", Buffer.from(accInfo.data).slice(0, 16).toString('hex'));
  console.log("First 4 bytes:", Array.from(accInfo.data.slice(0, 4)));
  console.log("Expected: [15, 112, 121, 111] = 0x0f p y o");
}

main().catch(console.error);
