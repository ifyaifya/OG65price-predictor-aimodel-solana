const { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, sendAndConfirmTransaction, ComputeBudgetProgram, SystemProgram } = require("@solana/web3.js");
const fs = require("fs");
const path = require("path");

const DEVNET_RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = "AdvFUgScZPQmnkhCZ1ZFMN7c1rsanoE7TfYbikggUAxM";

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
  console.log("Created:", testAcc.publicKey.toBase58());

  const bytecode = fs.readFileSync("/tmp/test_binascii.bin");
  const ix = new TransactionInstruction({
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: testAcc.publicKey, isSigner: false, isWritable: true },
    ],
    programId,
    data: Buffer.concat([Buffer.from([0x02]), bytecode]),
  });

  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500000 }))
    .add(ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }))
    .add(ix);

  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [payer], { skipPreflight: true, commitment: "confirmed" });
    const txInfo = await connection.getTransaction(sig, { commitment: "confirmed" });
    console.log("Logs:", txInfo?.meta?.logMessages?.filter(l => l.includes("Program log")));
    console.log("Return:", txInfo?.meta?.returnData?.data?.[0] ? Buffer.from(txInfo.meta.returnData.data[0], 'base64').toString() : "none");
    
    const accInfo = await connection.getAccountInfo(testAcc.publicKey);
    console.log("Account first 16 bytes:", Array.from(accInfo.data.slice(0, 16)));
    console.log("As text:", Buffer.from(accInfo.data.slice(0, 16)).toString());
  } catch(e) {
    const txInfo = await connection.getTransaction(e.signature, { commitment: "confirmed" });
    console.log("Error logs:", txInfo?.meta?.logMessages);
  }
}
main().catch(console.error);
