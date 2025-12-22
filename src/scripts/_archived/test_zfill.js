const {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
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
  const tempPy = "/tmp/test_zfill.py";
  fs.writeFileSync(tempPy, code);
  const tempBin = "/tmp/test_zfill.bin";
  execSync(COMPILER + " -f " + tempPy + " -o " + tempBin, { stdio: "pipe" });
  return fs.readFileSync(tempBin);
}

async function test(connection, payer, programId, code, desc) {
  console.log("\n--- " + desc + " ---");
  console.log("Code: " + code.replace(/\n/g, " | "));

  var bytecode;
  try {
    bytecode = compileCode(code);
  } catch (e) {
    console.log("COMPILE ERROR");
    return;
  }
  console.log("Bytecode: " + bytecode.length + " bytes");

  const ix = new TransactionInstruction({
    keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
    programId,
    data: Buffer.concat([Buffer.from([CONFIG.MODE_EXECUTE_BYTECODE]), bytecode]),
  });

  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }))
    .add(ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }))
    .add(ix);

  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  const simResult = await connection.simulateTransaction(tx);
  if (simResult.value.err) {
    console.log("SIM ERROR:", JSON.stringify(simResult.value.err));
    if (simResult.value.logs) {
      simResult.value.logs.slice(-5).forEach(function(log) {
        console.log("  " + log);
      });
    }
    return;
  }

  if (simResult.value.returnData && simResult.value.returnData.data && simResult.value.returnData.data[0]) {
    console.log("Return: " + Buffer.from(simResult.value.returnData.data[0], "base64").toString("utf8"));
  }

  var cuLog = simResult.value.logs?.find(function(log) { return log.includes("consumed"); });
  if (cuLog) {
    var match = cuLog.match(/consumed (\d+) of/);
    if (match) console.log("CU: " + match[1]);
  }
}

async function main() {
  console.log("=== zfill / String Tests ===");

  const connection = new Connection(CONFIG.DEVNET_RPC, "confirmed");
  const payer = loadKeypair();
  const programId = new PublicKey(CONFIG.PROGRAM_ID);

  // Test basic str()
  await test(connection, payer, programId, 'str(123)', "str(123)");

  // Test string concatenation
  await test(connection, payer, programId, '"a"+"b"', "concat a+b");

  // Test str concat
  await test(connection, payer, programId, 'str(1)+str(2)', "str(1)+str(2)");

  // Test zfill
  await test(connection, payer, programId, 'str(123).zfill(5)', "zfill(5)");

  // Test format alternative
  await test(connection, payer, programId, 'n=123\nstr(10000+n)[1:]', "format via slice");

  // Test multiple concat
  await test(connection, payer, programId, 'str(1)+str(2)+str(3)', "triple concat");

  // Test padded format
  await test(connection, payer, programId, 'n=99\ns=str(n)\nwhile len(s)<5:s="0"+s\ns', "manual padding");

  console.log("\n=== Done ===");
}

main().catch(console.error);
