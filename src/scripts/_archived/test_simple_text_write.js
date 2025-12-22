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

  // Create test account
  const testAcc = Keypair.generate();
  const space = 128;
  const lamports = await connection.getMinimumBalanceForRentExemption(space);

  const createTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: testAcc.publicKey,
      lamports,
      space,
      programId,
    })
  );
  await sendAndConfirmTransaction(connection, createTx, [payer, testAcc]);
  console.log("Created test account:", testAcc.publicKey.toBase58());

  // Write text data using VFS - same pattern as E2E pipeline
  const code = `f=open("/sol/1","w")\nf.write("HELLO12345")\nf.close()\n1`;
  fs.writeFileSync("/tmp/test_code.py", code);
  execSync(`${COMPILER} -f /tmp/test_code.py -o /tmp/test_code.bin`);
  const bytecode = fs.readFileSync("/tmp/test_code.bin");
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

  // Get transaction logs
  const txInfo = await connection.getTransaction(sig, { commitment: "confirmed" });
  console.log("Logs:", txInfo?.meta?.logMessages?.slice(-5));

  // Check account data
  const accInfo = await connection.getAccountInfo(testAcc.publicKey);
  console.log("Account data (first 32 bytes hex):", Buffer.from(accInfo.data).slice(0, 32).toString('hex'));
  console.log("As text:", Buffer.from(accInfo.data).slice(0, 16).toString());
}

main().catch(console.error);
