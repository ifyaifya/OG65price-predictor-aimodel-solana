/**
 * Market Data Collector for Price Predictor Training
 * Collects real-time data from Pyth Network and labels with future price direction
 *
 * Usage:
 *   node collect_data.js [--duration 3600] [--interval 5] [--output data/sol_market.csv]
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  PYTH_HERMES_API: 'https://hermes.pyth.network/v2/updates/price',
  SOL_USD_FEED: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',

  // Collection settings
  DEFAULT_DURATION: 7200,  // 2 hours in seconds
  DEFAULT_INTERVAL: 10,    // seconds between samples
  LOOKAHEAD_SLOTS: 150,    // ~60 seconds on Solana (400ms/slot)
  LOOKAHEAD_SECONDS: 60,   // 1 minute for future price

  // Direction thresholds (increased for 1-min timeframe)
  UP_THRESHOLD: 0.002,     // 0.2% = bullish
  DOWN_THRESHOLD: -0.002,  // -0.2% = bearish
};

/**
 * Fetch JSON from URL
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Get current SOL/USD price from Pyth
 */
async function getPythPrice() {
  try {
    const url = `${CONFIG.PYTH_HERMES_API}/latest?ids[]=${CONFIG.SOL_USD_FEED}`;
    const data = await fetchJson(url);

    if (data && data.parsed && data.parsed[0] && data.parsed[0].price) {
      const priceData = data.parsed[0].price;
      const price = parseFloat(priceData.price) * Math.pow(10, priceData.expo);
      const confidence = parseFloat(priceData.conf) * Math.pow(10, priceData.expo);

      return {
        price,
        confidence,
        timestamp: Date.now(),
        publishTime: priceData.publish_time * 1000,
      };
    }
    return null;
  } catch (e) {
    console.error('Pyth API error:', e.message);
    return null;
  }
}

/**
 * Calculate features from price history
 */
function calculateFeatures(priceHistory) {
  if (priceHistory.length < 6) return null;  // Reduced from 12 for faster warmup

  const prices = priceHistory.map(p => p.price);
  const currentPrice = prices[prices.length - 1];

  // 1. VWAP Ratio (simplified - equal volume assumption)
  const vwap = prices.reduce((a, b) => a + b, 0) / prices.length;
  const vwapRatio = vwap / currentPrice;

  // 2. Volume Acceleration (using price volatility as proxy)
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i-1]) / prices[i-1]);
  }
  const half = Math.floor(returns.length / 2);
  const recentReturns = returns.slice(-half) || returns;
  const olderReturns = returns.slice(0, half) || returns;
  const recentVol = Math.sqrt(recentReturns.reduce((a, r) => a + r*r, 0) / recentReturns.length);
  const olderVol = Math.sqrt(olderReturns.reduce((a, r) => a + r*r, 0) / olderReturns.length) || recentVol;
  const volumeAccel = (recentVol - olderVol) / (olderVol || 1);

  // 3. Orderbook Imbalance (using price momentum as proxy)
  const lookback = Math.min(5, prices.length - 1);
  const momentum5 = (prices[prices.length - 1] - prices[prices.length - 1 - lookback]) / prices[prices.length - 1 - lookback];
  const orderbookImbal = momentum5;

  // 4. Volatility
  const volatility = Math.sqrt(returns.reduce((a, r) => a + r*r, 0) / returns.length);

  // 5. Liquidity (using confidence interval as proxy)
  const avgConfidence = priceHistory.reduce((a, p) => a + p.confidence, 0) / priceHistory.length;
  const liquidityRatio = 1 - Math.min(avgConfidence / currentPrice, 0.1) * 10; // Higher confidence = more liquid

  // 6. Momentum
  const momentum = (currentPrice - prices[0]) / prices[0];

  return {
    vwapRatio,
    volumeAccel,
    orderbookImbal,
    volatility,
    liquidityRatio,
    momentum,
    currentPrice,
  };
}

/**
 * Normalize features to INT8 range (0-255)
 */
function normalizeFeatures(features) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.floor(v)));

  return {
    vwap_ratio: clamp(features.vwapRatio * 128),           // 1.0 -> 128
    volume_accel: clamp(128 + features.volumeAccel * 256), // 0 -> 128
    orderbook_imbal: clamp(128 + features.orderbookImbal * 1280), // 0 -> 128
    volatility: clamp(features.volatility * 25500),        // 0.01 -> 255
    liquidity: clamp(features.liquidityRatio * 255),       // 1.0 -> 255
    momentum: clamp(128 + features.momentum * 1280),       // 0 -> 128
  };
}

/**
 * Determine direction label
 */
function getDirectionLabel(currentPrice, futurePrice) {
  const change = (futurePrice - currentPrice) / currentPrice;

  if (change > CONFIG.UP_THRESHOLD) return 1;    // Bullish
  if (change < CONFIG.DOWN_THRESHOLD) return -1; // Bearish
  return 0; // Neutral
}

/**
 * Main collection loop
 */
async function collectData(options = {}) {
  const duration = options.duration || CONFIG.DEFAULT_DURATION;
  const interval = options.interval || CONFIG.DEFAULT_INTERVAL;
  const outputPath = options.output || path.join(__dirname, '..', '..', 'data', 'sol_market_data.csv');

  // Ensure data directory exists
  const dataDir = path.dirname(outputPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // CSV header
  const header = 'timestamp,price,vwap_ratio,volume_accel,orderbook_imbal,volatility,liquidity,momentum,direction\n';
  fs.writeFileSync(outputPath, header);

  console.log('='.repeat(60));
  console.log('Price Predictor Data Collector');
  console.log('='.repeat(60));
  console.log(`Feed: SOL/USD (Pyth Network)`);
  console.log(`Duration: ${duration}s`);
  console.log(`Interval: ${interval}s`);
  console.log(`Output: ${outputPath}`);
  console.log(`Lookahead: ${CONFIG.LOOKAHEAD_SECONDS}s (~${CONFIG.LOOKAHEAD_SLOTS} slots)`);
  console.log('='.repeat(60));

  const priceHistory = [];
  const pendingLabels = []; // Samples waiting for future price
  let samplesCollected = 0;
  let samplesLabeled = 0;

  const startTime = Date.now();
  const endTime = startTime + duration * 1000;

  console.log(`\nStarted at ${new Date().toISOString()}`);
  console.log('Press Ctrl+C to stop early\n');

  while (Date.now() < endTime) {
    try {
      const priceData = await getPythPrice();

      if (priceData) {
        priceHistory.push(priceData);

        // Keep last 120 seconds of data for feature calculation
        const cutoff = Date.now() - 120000;
        while (priceHistory.length > 0 && priceHistory[0].timestamp < cutoff) {
          priceHistory.shift();
        }

        // Calculate features if we have enough history (6 samples minimum)
        if (priceHistory.length >= 6) {
          const features = calculateFeatures(priceHistory);
          const normalized = normalizeFeatures(features);

          // Add to pending labels queue
          pendingLabels.push({
            timestamp: priceData.timestamp,
            price: priceData.price,
            features: normalized,
            labelTime: Date.now() + CONFIG.LOOKAHEAD_SECONDS * 1000,
          });

          samplesCollected++;
        }

        // Process pending labels
        const now = Date.now();
        while (pendingLabels.length > 0 && pendingLabels[0].labelTime <= now) {
          const sample = pendingLabels.shift();
          const direction = getDirectionLabel(sample.price, priceData.price);

          // Write to CSV
          const row = [
            sample.timestamp,
            sample.price.toFixed(4),
            sample.features.vwap_ratio,
            sample.features.volume_accel,
            sample.features.orderbook_imbal,
            sample.features.volatility,
            sample.features.liquidity,
            sample.features.momentum,
            direction,
          ].join(',') + '\n';

          fs.appendFileSync(outputPath, row);
          samplesLabeled++;
        }

        // Progress update
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const remaining = Math.floor((endTime - Date.now()) / 1000);
        process.stdout.write(`\rCollected: ${samplesCollected} | Labeled: ${samplesLabeled} | Elapsed: ${elapsed}s | Remaining: ${remaining}s   `);
      }

    } catch (e) {
      console.error('\nError:', e.message);
    }

    // Wait for next interval
    await new Promise(r => setTimeout(r, interval * 1000));
  }

  // Process remaining pending labels
  console.log('\n\nProcessing remaining samples...');
  await new Promise(r => setTimeout(r, CONFIG.LOOKAHEAD_SECONDS * 1000 + 1000));

  const finalPrice = await getPythPrice();
  if (finalPrice) {
    while (pendingLabels.length > 0) {
      const sample = pendingLabels.shift();
      const direction = getDirectionLabel(sample.price, finalPrice.price);

      const row = [
        sample.timestamp,
        sample.price.toFixed(4),
        sample.features.vwap_ratio,
        sample.features.volume_accel,
        sample.features.orderbook_imbal,
        sample.features.volatility,
        sample.features.liquidity,
        sample.features.momentum,
        direction,
      ].join(',') + '\n';

      fs.appendFileSync(outputPath, row);
      samplesLabeled++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('COLLECTION COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total samples: ${samplesLabeled}`);
  console.log(`Output file: ${outputPath}`);
  console.log(`File size: ${(fs.statSync(outputPath).size / 1024).toFixed(2)} KB`);

  // Analyze direction distribution
  const data = fs.readFileSync(outputPath, 'utf8').split('\n').slice(1).filter(l => l.trim());
  const directions = { '-1': 0, '0': 0, '1': 0 };
  data.forEach(line => {
    const dir = line.split(',').pop();
    if (directions[dir] !== undefined) directions[dir]++;
  });

  console.log(`\nDirection distribution:`);
  console.log(`  Bearish (-1): ${directions['-1']} (${(directions['-1']/samplesLabeled*100).toFixed(1)}%)`);
  console.log(`  Neutral (0):  ${directions['0']} (${(directions['0']/samplesLabeled*100).toFixed(1)}%)`);
  console.log(`  Bullish (+1): ${directions['1']} (${(directions['1']/samplesLabeled*100).toFixed(1)}%)`);
  console.log('='.repeat(60));
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--duration' && args[i+1]) {
      options.duration = parseInt(args[++i]);
    } else if (args[i] === '--interval' && args[i+1]) {
      options.interval = parseFloat(args[++i]);
    } else if (args[i] === '--output' && args[i+1]) {
      options.output = args[++i];
    } else if (args[i] === '--help') {
      console.log('Usage: node collect_data.js [options]');
      console.log('\nOptions:');
      console.log('  --duration <seconds>  Collection duration (default: 3600)');
      console.log('  --interval <seconds>  Sampling interval (default: 5)');
      console.log('  --output <path>       Output CSV file path');
      console.log('  --help                Show this help');
      process.exit(0);
    }
  }

  return options;
}

// Run
if (require.main === module) {
  const options = parseArgs();
  collectData(options).catch(console.error);
}

module.exports = { collectData, getPythPrice, calculateFeatures, normalizeFeatures };
