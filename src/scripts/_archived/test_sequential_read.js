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
  const tempPy = "/tmp/test_seq.py";
  fs.writeFileSync(tempPy, code);
  const tempBin = "/tmp/test_seq.bin";
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
    return false;
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
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }))
    .add(ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }))
    .add(ix);

  // Simulate first to get logs
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  const simResult = await connection.simulateTransaction(tx);

  if (simResult.value.err) {
    console.log("SIM ERROR:", JSON.stringify(simResult.value.err));
    console.log("LOGS:");
    if (simResult.value.logs) {
      simResult.value.logs.forEach(function(log) {
        console.log("  " + log);
      });
    }
    return false;
  }

  // Show return data from simulation
  if (simResult.value.returnData && simResult.value.returnData.data && simResult.value.returnData.data[0]) {
    console.log("Return: " + Buffer.from(simResult.value.returnData.data[0], "base64").toString("utf8"));
  }

  // Get CU from logs
  var cuLog = simResult.value.logs?.find(function(log) { return log.includes("consumed"); });
  if (cuLog) {
    var match = cuLog.match(/consumed (\d+) of/);
    if (match) console.log("CU: " + match[1]);
  }

  return true;
}

async function main() {
  console.log("=== Sequential Read Tests ===");

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

  // Write fixed-width: "1402314000139501390013968"
  var ok = await test(connection, payer, programId, account,
    'f=open("/sol/1","w")\nf.write("1402314000139501390013968")\nf.close()\n1',
    "Write data");
  if (!ok) return;

  // Sequential reads
  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\np0=int(f.read(5))\nf.close()\np0',
    "Read first 5 chars as int");

  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\np0=int(f.read(5))\np1=int(f.read(5))\nf.close()\np1',
    "Read 2nd value");

  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\np0=int(f.read(5))\np1=int(f.read(5))\np2=int(f.read(5))\np3=int(f.read(5))\nf.close()\n(p0+p1+p2+p3)//4',
    "Read 4 and compute SMA");

  // Full accumulator simulation
  await test(connection, payer, programId, account,
    'f=open("/sol/1","r")\np0=int(f.read(5))\np1=int(f.read(5))\np2=int(f.read(5))\np3=int(f.read(5))\nsma=int(f.read(5))\nf.close()\nnew_sma=(p0+p1+p2+p3)//4\ng=open("/sol/1","w")\ng.write(str(p0)+str(p1)+str(p2)+str(p3)+str(new_sma))\ng.close()\nnew_sma',
    "Full read-compute-write");

  console.log("\n=== Done ===");
}

main().catch(console.error);
