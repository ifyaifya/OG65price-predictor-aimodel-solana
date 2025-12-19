/**
 * Live Price Prediction Demo
 * Demonstrates the on-chain price predictor with simulated market data
 */

const { PricePredictor } = require('../sdk/price-predictor');

// Simulated market data generator
function generateMarketData() {
  const basePrice = 100;
  const trend = Math.sin(Date.now() / 10000) * 0.1; // Slow oscillation

  return {
    price: basePrice + Math.random() * 2 - 1,
    vwap: basePrice + trend * 5,
    volumeChange: (Math.random() - 0.5) * 0.5,
    bidAskRatio: (Math.random() - 0.5) * 0.3,
    volatility: Math.random() * 0.1,
    liquidityRatio: 0.5 + Math.random() * 0.5,
    momentum: trend + (Math.random() - 0.5) * 0.1,
  };
}

// Display prediction with color
function displayPrediction(prediction, features) {
  const colors = {
    strong_buy: '\x1b[32m',  // Green
    buy: '\x1b[92m',         // Light green
    hold: '\x1b[33m',        // Yellow
    sell: '\x1b[91m',        // Light red
    strong_sell: '\x1b[31m', // Red
    reset: '\x1b[0m',
  };

  const color = colors[prediction.signal] || colors.reset;

  console.log('\n' + '='.repeat(50));
  console.log(`${color}PREDICTION: ${prediction.signal.toUpperCase()}${colors.reset}`);
  console.log('='.repeat(50));
  console.log(`Direction: ${prediction.rawDirection}`);
  console.log(`Confidence: ${prediction.confidence}`);
  console.log('');
  console.log('Features:');
  console.log(`  VWAP ratio:     ${features.vwapRatio} (128=neutral)`);
  console.log(`  Volume accel:   ${features.volumeAccel} (128=stable)`);
  console.log(`  Orderbook:      ${features.orderbookImbal} (128=balanced)`);
  console.log(`  Volatility:     ${features.volatility}`);
  console.log(`  Liquidity:      ${features.liquidity}`);
  console.log(`  Momentum:       ${features.momentum} (128=neutral)`);
}

// Main demo loop
async function main() {
  console.log('Price Predictor Demo (Simulated)');
  console.log('================================\n');
  console.log('Note: This demo uses simulated data.');
  console.log('For real predictions, connect to on-chain model.\n');

  const predictor = new PricePredictor(null, 'demo');

  // Simulate predictions every 2 seconds
  setInterval(() => {
    const marketData = generateMarketData();
    const features = predictor.normalizeFeatures(marketData);

    // Simulate prediction based on features
    // (In production, this would come from on-chain execution)
    const mockDirection = (features.momentum - 128) + (features.vwapRatio - 128) * 0.5;
    const mockConfidence = 100 + Math.abs(mockDirection) * 2 + Math.random() * 50;

    const prediction = {
      direction: mockDirection > 0 ? 1 : mockDirection < 0 ? -1 : 0,
      rawDirection: Math.floor(mockDirection),
      confidence: Math.floor(mockConfidence),
      signal: predictor.getSignal(Math.floor(mockDirection), Math.floor(mockConfidence)),
    };

    displayPrediction(prediction, features);
  }, 2000);
}

main().catch(console.error);
