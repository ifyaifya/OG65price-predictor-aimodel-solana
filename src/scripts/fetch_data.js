/**
 * Fetch Market Data for Price Predictor
 * Collects real-time market data from various sources for training and inference.
 *
 * Sources:
 * - Pyth Network (price oracle)
 * - Jupiter API (aggregated prices)
 * - Birdeye API (historical trades)
 */

const https = require('https');

// Configuration
const CONFIG = {
  PYTH_API: 'https://hermes.pyth.network/api',
  JUPITER_API: 'https://price.jup.ag/v4',
  BIRDEYE_API: 'https://public-api.birdeye.so',

  // Popular token price feeds
  FEEDS: {
    SOL: 'H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG',
    BTC: 'GVXRSBjFk6e6J3NbVPXohDJetcTjaeeuykUpbQF8UoMU',
    ETH: 'JBu1AL4obBcCMqKBBxhpWCNUt136ijcuMZLFvTP7iWdB',
  }
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
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

/**
 * Get price from Pyth Network
 */
async function getPythPrice(feedId) {
  try {
    const url = `${CONFIG.PYTH_API}/latest_price_feeds?ids[]=${feedId}`;
    const data = await fetchJson(url);

    if (data && data[0]) {
      const price = data[0].price;
      return {
        price: parseFloat(price.price) * Math.pow(10, price.expo),
        confidence: parseFloat(price.conf) * Math.pow(10, price.expo),
        timestamp: price.publish_time,
      };
    }
  } catch (e) {
    console.error('Pyth fetch error:', e.message);
  }
  return null;
}

/**
 * Get price from Jupiter
 */
async function getJupiterPrice(tokenMint) {
  try {
    const url = `${CONFIG.JUPITER_API}/price?ids=${tokenMint}`;
    const data = await fetchJson(url);

    if (data && data.data && data.data[tokenMint]) {
      return {
        price: data.data[tokenMint].price,
        timestamp: Date.now(),
      };
    }
  } catch (e) {
    console.error('Jupiter fetch error:', e.message);
  }
  return null;
}

/**
 * Calculate VWAP from recent trades
 */
function calculateVWAP(trades) {
  if (!trades || trades.length === 0) return null;

  let totalVolume = 0;
  let totalVolumePrice = 0;

  for (const trade of trades) {
    const volume = trade.volume || trade.size || 1;
    const price = trade.price;
    totalVolume += volume;
    totalVolumePrice += volume * price;
  }

  return totalVolumePrice / totalVolume;
}

/**
 * Calculate volatility from price history
 */
function calculateVolatility(prices) {
  if (!prices || prices.length < 2) return 0;

  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i-1]) / prices[i-1]);
  }

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;

  return Math.sqrt(variance);
}

/**
 * Calculate momentum (price change over period)
 */
function calculateMomentum(prices) {
  if (!prices || prices.length < 2) return 0;

  const first = prices[0];
  const last = prices[prices.length - 1];

  return (last - first) / first;
}

/**
 * Normalize features to 0-255 range
 */
function normalizeFeatures(marketData) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.floor(v)));

  return {
    vwapRatio: clamp((marketData.vwap / marketData.price) * 128),
    volumeAccel: clamp(128 + (marketData.volumeChange || 0) * 64),
    orderbookImbal: clamp(128 + (marketData.bidAskRatio || 0) * 64),
    volatility: clamp((marketData.volatility || 0) * 2550),
    liquidity: clamp((marketData.liquidityRatio || 0.5) * 255),
    momentum: clamp(128 + (marketData.momentum || 0) * 127),
  };
}

/**
 * Collect market data for a token
 */
async function collectMarketData(feedId, historyMinutes = 5) {
  console.log(`Collecting market data for ${feedId}...`);

  // Get current price
  const pythData = await getPythPrice(feedId);
  if (!pythData) {
    console.error('Failed to get Pyth price');
    return null;
  }

  // Simulate historical data (in production, fetch from Birdeye API)
  const currentPrice = pythData.price;
  const priceHistory = [];
  for (let i = 0; i < historyMinutes * 12; i++) { // 5-second intervals
    const noise = (Math.random() - 0.5) * currentPrice * 0.001;
    priceHistory.push(currentPrice + noise);
  }

  // Calculate metrics
  const vwap = calculateVWAP(priceHistory.map(p => ({ price: p, volume: 1 })));
  const volatility = calculateVolatility(priceHistory);
  const momentum = calculateMomentum(priceHistory.slice(-12)); // Last minute

  const marketData = {
    price: currentPrice,
    vwap: vwap || currentPrice,
    volumeChange: (Math.random() - 0.5) * 0.2, // Simulated
    bidAskRatio: (Math.random() - 0.5) * 0.1,  // Simulated
    volatility,
    liquidityRatio: 0.5 + Math.random() * 0.3, // Simulated
    momentum,
    timestamp: Date.now(),
  };

  return {
    raw: marketData,
    normalized: normalizeFeatures(marketData),
  };
}

/**
 * Export data to CSV for training
 */
function exportToCSV(dataPoints, filename) {
  const fs = require('fs');

  const headers = 'vwap_ratio,volume_accel,orderbook_imbal,volatility,liquidity,momentum,direction\n';
  const rows = dataPoints.map(d =>
    `${d.features.vwapRatio},${d.features.volumeAccel},${d.features.orderbookImbal},${d.features.volatility},${d.features.liquidity},${d.features.momentum},${d.direction}`
  ).join('\n');

  fs.writeFileSync(filename, headers + rows);
  console.log(`Exported ${dataPoints.length} samples to ${filename}`);
}

/**
 * Main: Collect and display market data
 */
async function main() {
  console.log('='.repeat(50));
  console.log('Market Data Collection for Price Predictor');
  console.log('='.repeat(50));

  // Collect SOL data
  const solData = await collectMarketData(CONFIG.FEEDS.SOL);

  if (solData) {
    console.log('\nSOL Market Data:');
    console.log('-'.repeat(30));
    console.log(`Price: $${solData.raw.price.toFixed(4)}`);
    console.log(`VWAP: $${solData.raw.vwap.toFixed(4)}`);
    console.log(`Volatility: ${(solData.raw.volatility * 100).toFixed(2)}%`);
    console.log(`Momentum: ${(solData.raw.momentum * 100).toFixed(2)}%`);

    console.log('\nNormalized Features (0-255):');
    console.log('-'.repeat(30));
    for (const [key, value] of Object.entries(solData.normalized)) {
      console.log(`${key}: ${value}`);
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('Note: For production, integrate with Birdeye API');
  console.log('for real historical trade data.');
  console.log('='.repeat(50));
}

// Export functions for use as module
module.exports = {
  getPythPrice,
  getJupiterPrice,
  collectMarketData,
  normalizeFeatures,
  exportToCSV,
  CONFIG,
};

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}
