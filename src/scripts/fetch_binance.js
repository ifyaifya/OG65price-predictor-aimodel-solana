/**
 * Fetch historical OHLCV data from Binance API
 * Fast and efficient - gets 7 days of 1-minute candles
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const BINANCE_API = 'https://api.binance.com/api/v3/klines';

function fetchKlines(symbol, interval, limit, startTime) {
  return new Promise((resolve, reject) => {
    let url = `${BINANCE_API}?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    if (startTime) url += `&startTime=${startTime}`;

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

async function fetchAllData(symbol = 'SOLUSDT', days = 7) {
  console.log(`Fetching ${days} days of ${symbol} 1m data...`);

  const now = Date.now();
  const startTime = now - (days * 24 * 60 * 60 * 1000);

  const allKlines = [];
  let currentStart = startTime;

  while (currentStart < now) {
    process.stdout.write(`\rFetching... ${new Date(currentStart).toISOString().split('T')[0]} `);

    try {
      const klines = await fetchKlines(symbol, '1m', 1000, currentStart);
      if (klines && klines.length > 0) {
        allKlines.push(...klines);
        currentStart = klines[klines.length - 1][0] + 60000;
      } else {
        break;
      }
    } catch (e) {
      console.error('\nError:', e.message);
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    await new Promise(r => setTimeout(r, 100)); // Rate limit
  }

  console.log(`\nFetched ${allKlines.length} candles`);
  return allKlines;
}

function processKlines(klines, lookaheadMinutes = 1) {
  const samples = [];

  for (let i = 12; i < klines.length - lookaheadMinutes; i++) {
    const current = klines[i];
    const future = klines[i + lookaheadMinutes];

    // Get window for features
    const window = klines.slice(i - 12, i + 1);

    const timestamp = current[0];
    const open = parseFloat(current[1]);
    const high = parseFloat(current[2]);
    const low = parseFloat(current[3]);
    const close = parseFloat(current[4]);
    const volume = parseFloat(current[5]);

    const futureClose = parseFloat(future[4]);

    // Direction (0.3% threshold for 15-min lookahead)
    const change = (futureClose - close) / close;
    let direction;
    if (change > 0.003) direction = 1;      // UP (0.3%)
    else if (change < -0.003) direction = -1; // DOWN (-0.3%)
    else direction = 0;                       // NEUTRAL

    // Features
    const closes = window.map(k => parseFloat(k[4]));
    const sma = closes.reduce((a, b) => a + b, 0) / closes.length;

    // 1. SMA ratio
    const smaRatio = close / sma;

    // 2. Momentum
    const momentum = (close - closes[0]) / closes[0];

    // 3. Volatility
    const returns = [];
    for (let j = 1; j < closes.length; j++) {
      returns.push((closes[j] - closes[j-1]) / closes[j-1]);
    }
    const volatility = Math.sqrt(returns.reduce((a, r) => a + r*r, 0) / returns.length);

    // 4. Trend (slope)
    const firstHalf = closes.slice(0, 6).reduce((a, b) => a + b, 0) / 6;
    const secondHalf = closes.slice(6).reduce((a, b) => a + b, 0) / (closes.length - 6);
    const trend = (secondHalf - firstHalf) / firstHalf;

    // 5. RSI-like
    const upMoves = returns.filter(r => r > 0).length;
    const rsiLike = upMoves / returns.length;

    // 6. Position in range
    const localMin = Math.min(...closes);
    const localMax = Math.max(...closes);
    const position = localMax > localMin ? (close - localMin) / (localMax - localMin) : 0.5;

    // Normalize to 0-255
    const norm = (val, lo, hi) => Math.max(0, Math.min(255, Math.floor((val - lo) / (hi - lo) * 255)));

    samples.push({
      timestamp,
      price: close.toFixed(4),
      sma_ratio: norm(smaRatio, 0.98, 1.02),
      volatility: norm(volatility, 0, 0.01),
      momentum: norm(momentum, -0.02, 0.02),
      trend: norm(trend, -0.005, 0.005),
      rsi_like: norm(rsiLike, 0, 1),
      position: norm(position, 0, 1),
      direction
    });
  }

  return samples;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Binance Historical Data Fetcher');
  console.log('='.repeat(60));

  // Fetch 30 days of data for robust testing
  const klines = await fetchAllData('SOLUSDT', 30);

  // Remove duplicates
  const seen = new Set();
  const uniqueKlines = klines.filter(k => {
    if (seen.has(k[0])) return false;
    seen.add(k[0]);
    return true;
  });

  console.log(`Unique candles: ${uniqueKlines.length}`);

  // Process with 15-minute lookahead (more signal)
  console.log('\nProcessing with 15-minute lookahead...');
  const samples = processKlines(uniqueKlines, 15);

  // Stats
  const directions = { '-1': 0, '0': 0, '1': 0 };
  samples.forEach(s => directions[s.direction.toString()]++);

  console.log(`\nDirection distribution:`);
  console.log(`  DOWN (-1): ${directions['-1']} (${(directions['-1']/samples.length*100).toFixed(1)}%)`);
  console.log(`  NEUTRAL (0): ${directions['0']} (${(directions['0']/samples.length*100).toFixed(1)}%)`);
  console.log(`  UP (+1): ${directions['1']} (${(directions['1']/samples.length*100).toFixed(1)}%)`);

  const binarySamples = directions['-1'] + directions['1'];
  console.log(`\nBinary samples (UP+DOWN): ${binarySamples}`);

  // Save to CSV
  const outputPath = path.join(__dirname, '../../data/binance_sol_1m.csv');
  const header = 'timestamp,price,sma_ratio,volatility,momentum,trend,rsi_like,position,direction\n';
  const rows = samples.map(s =>
    `${s.timestamp},${s.price},${s.sma_ratio},${s.volatility},${s.momentum},${s.trend},${s.rsi_like},${s.position},${s.direction}`
  ).join('\n');

  fs.writeFileSync(outputPath, header + rows);

  console.log(`\nSaved ${samples.length} samples to ${outputPath}`);
  console.log(`File size: ${(fs.statSync(outputPath).size / 1024).toFixed(2)} KB`);
  console.log('='.repeat(60));
}

main().catch(console.error);
