/**
 * Price Direction Predictor SDK
 * On-chain neural network for predicting short-term price direction
 *
 * @license MIT
 */

const {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
} = require("@solana/web3.js");

class PricePredictor {
  /**
   * Create a new PricePredictor
   * @param {Connection} connection - Solana connection
   * @param {string} programId - SolanaPython program ID
   */
  constructor(connection, programId) {
    this.connection = connection;
    this.programId = new PublicKey(programId);
    this.MODE_EXECUTE_BYTECODE = 0x02;
  }

  /**
   * Normalize market data to INT8 features
   * @param {Object} marketData - Raw market data
   * @returns {Object} Normalized features (0-255)
   */
  normalizeFeatures(marketData) {
    return {
      // VWAP ratio (128 = neutral, < 128 = below VWAP, > 128 = above VWAP)
      vwapRatio: this.clamp(Math.floor((marketData.vwap / marketData.price) * 128)),

      // Volume acceleration (128 = stable, > 128 = increasing, < 128 = decreasing)
      volumeAccel: this.clamp(Math.floor(128 + marketData.volumeChange * 64)),

      // Orderbook imbalance (128 = balanced, > 128 = more bids, < 128 = more asks)
      orderbookImbal: this.clamp(Math.floor(128 + marketData.bidAskRatio * 64)),

      // Volatility (0-255 scale)
      volatility: this.clamp(Math.floor(marketData.volatility * 255)),

      // Liquidity depth ratio (0-255)
      liquidity: this.clamp(Math.floor(marketData.liquidityRatio * 255)),

      // Momentum (128 = neutral, > 128 = bullish, < 128 = bearish)
      momentum: this.clamp(Math.floor(128 + marketData.momentum * 127)),
    };
  }

  /**
   * Clamp value to 0-255 range
   */
  clamp(value) {
    return Math.max(0, Math.min(255, value));
  }

  /**
   * Write features to weight account
   * Features are stored at bytes 28-33 of the encoder weight account
   * @param {Object} features - Normalized features
   * @returns {Buffer} Feature bytes
   */
  encodeFeatures(features) {
    return Buffer.from([
      features.vwapRatio,
      features.volumeAccel,
      features.orderbookImbal,
      features.volatility,
      features.liquidity,
      features.momentum,
    ]);
  }

  /**
   * Build encoder transaction instruction
   * @param {Buffer} bytecode - Compiled encoder bytecode
   * @param {PublicKey} weightsAccount - Encoder weights account
   * @param {PublicKey} hiddenAccount - Hidden state account
   * @param {PublicKey} payer - Transaction payer
   * @returns {TransactionInstruction}
   */
  buildEncoderInstruction(bytecode, weightsAccount, hiddenAccount, payer) {
    const data = Buffer.alloc(1 + bytecode.length);
    data.writeUInt8(this.MODE_EXECUTE_BYTECODE, 0);
    bytecode.copy(data, 1);

    return new TransactionInstruction({
      keys: [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: weightsAccount, isSigner: false, isWritable: false },
        { pubkey: hiddenAccount, isSigner: false, isWritable: true },
      ],
      programId: this.programId,
      data,
    });
  }

  /**
   * Build decoder transaction instruction
   * @param {Buffer} bytecode - Compiled decoder bytecode
   * @param {PublicKey} weightsAccount - Decoder weights account
   * @param {PublicKey} hiddenAccount - Hidden state account
   * @param {PublicKey} payer - Transaction payer
   * @returns {TransactionInstruction}
   */
  buildDecoderInstruction(bytecode, weightsAccount, hiddenAccount, payer) {
    const data = Buffer.alloc(1 + bytecode.length);
    data.writeUInt8(this.MODE_EXECUTE_BYTECODE, 0);
    bytecode.copy(data, 1);

    return new TransactionInstruction({
      keys: [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: weightsAccount, isSigner: false, isWritable: false },
        { pubkey: hiddenAccount, isSigner: false, isWritable: false },
      ],
      programId: this.programId,
      data,
    });
  }

  /**
   * Parse prediction result from transaction return data
   * @param {Buffer} returnData - Transaction return data
   * @returns {Object} Prediction result
   */
  parseResult(returnData) {
    if (!returnData) return null;

    const value = returnData.readInt32LE(0);
    const direction = Math.floor(value / 1000);
    const confidence = Math.abs(value % 1000);

    return {
      direction: direction > 0 ? 1 : direction < 0 ? -1 : 0,
      rawDirection: direction,
      confidence,
      signal: this.getSignal(direction, confidence),
    };
  }

  /**
   * Get trading signal from prediction
   * @param {number} direction - Direction score
   * @param {number} confidence - Confidence score
   * @returns {string} Signal: 'strong_buy', 'buy', 'hold', 'sell', 'strong_sell'
   */
  getSignal(direction, confidence) {
    if (confidence < 100) return 'hold';

    if (direction > 50) return 'strong_buy';
    if (direction > 0) return 'buy';
    if (direction < -50) return 'strong_sell';
    if (direction < 0) return 'sell';
    return 'hold';
  }

  /**
   * Check if prediction is bullish
   * @param {Object} result - Prediction result
   * @returns {boolean}
   */
  isBullish(result) {
    return result.direction > 0 && result.confidence > 150;
  }

  /**
   * Check if prediction is bearish
   * @param {Object} result - Prediction result
   * @returns {boolean}
   */
  isBearish(result) {
    return result.direction < 0 && result.confidence > 150;
  }

  /**
   * Check if prediction is high confidence
   * @param {Object} result - Prediction result
   * @param {number} threshold - Confidence threshold (default: 180)
   * @returns {boolean}
   */
  isHighConfidence(result, threshold = 180) {
    return result.confidence > threshold;
  }
}

module.exports = { PricePredictor };
