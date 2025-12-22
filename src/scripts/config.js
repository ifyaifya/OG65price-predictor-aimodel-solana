/**
 * Configuration for Solana Python NN project
 */

const path = require("path");

module.exports = {
  // Solana network
  DEVNET_RPC: process.env.SOLANA_RPC || "https://api.devnet.solana.com",
  PROGRAM_ID: process.env.PROGRAM_ID || "AdvFUgScZPQmnkhCZ1ZFMN7c1rsanoE7TfYbikggUAxM",

  // PikaPython compiler path - set PIKA_COMPILE env var or update default
  COMPILER: process.env.PIKA_COMPILE || path.join(__dirname, "../../pika_compile"),

  // Execution modes
  MODE_SCRIPT: 0x00,
  MODE_COMPILE: 0x01,
  MODE_EXECUTE_BYTECODE: 0x02,
  MODE_WRITE_ACCOUNT: 0x03,

  // Compute budget
  DEFAULT_CU_LIMIT: 1400000,
  DEFAULT_HEAP_SIZE: 256 * 1024,
  WRITE_CU_LIMIT: 200000,

  // Chunked write settings
  CHUNK_SIZE: 900,
};
