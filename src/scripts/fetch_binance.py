#!/usr/bin/env python3
"""
Fetch historical OHLCV data from Binance API
Much better than real-time collection - clean 1-minute candles with volume
"""

import urllib.request
import json
import csv
import time
import os
from datetime import datetime, timedelta

# Binance API (no auth needed for klines)
BINANCE_API = "https://api.binance.com/api/v3/klines"

def fetch_klines(symbol="SOLUSDT", interval="1m", limit=1000, start_time=None):
    """Fetch OHLCV data from Binance."""
    url = f"{BINANCE_API}?symbol={symbol}&interval={interval}&limit={limit}"
    if start_time:
        url += f"&startTime={start_time}"

    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            data = json.loads(response.read().decode())
            return data
    except Exception as e:
        print(f"Error fetching: {e}")
        return None


def process_klines(klines, lookahead_minutes=1):
    """
    Process klines into training data with direction labels.

    Each kline: [open_time, open, high, low, close, volume, close_time, ...]

    Direction: compare current close with close N minutes later
    """
    samples = []

    for i in range(len(klines) - lookahead_minutes):
        current = klines[i]
        future = klines[i + lookahead_minutes]

        timestamp = int(current[0])
        open_price = float(current[1])
        high = float(current[2])
        low = float(current[3])
        close = float(current[4])
        volume = float(current[5])

        future_close = float(future[4])

        # Calculate direction
        change = (future_close - close) / close

        if change > 0.002:    # +0.2%
            direction = 1
        elif change < -0.002:  # -0.2%
            direction = -1
        else:
            direction = 0

        # Calculate features
        # 1. Price position in candle range
        candle_range = high - low
        if candle_range > 0:
            position = (close - low) / candle_range
        else:
            position = 0.5

        # 2. Candle body ratio (close - open) / range
        if candle_range > 0:
            body_ratio = (close - open_price) / candle_range
        else:
            body_ratio = 0

        # 3. Upper wick ratio
        upper_wick = high - max(open_price, close)
        if candle_range > 0:
            upper_wick_ratio = upper_wick / candle_range
        else:
            upper_wick_ratio = 0

        # 4. Lower wick ratio
        lower_wick = min(open_price, close) - low
        if candle_range > 0:
            lower_wick_ratio = lower_wick / candle_range
        else:
            lower_wick_ratio = 0

        # 5. Volume (will normalize later)
        vol_feature = volume

        # 6. Momentum from open
        momentum = (close - open_price) / open_price if open_price > 0 else 0

        samples.append({
            'timestamp': timestamp,
            'close': close,
            'position': position,
            'body_ratio': body_ratio,
            'upper_wick': upper_wick_ratio,
            'lower_wick': lower_wick_ratio,
            'volume': vol_feature,
            'momentum': momentum,
            'direction': direction
        })

    return samples


def add_rolling_features(samples, window=12):
    """Add rolling window features like SMA, volatility, etc."""

    enhanced = []

    for i in range(window, len(samples)):
        s = samples[i].copy()

        # Get window
        window_data = samples[i-window:i+1]
        closes = [x['close'] for x in window_data]

        # SMA ratio
        sma = sum(closes) / len(closes)
        s['sma_ratio'] = s['close'] / sma if sma > 0 else 1.0

        # Volatility (std of returns)
        returns = []
        for j in range(1, len(closes)):
            if closes[j-1] > 0:
                returns.append((closes[j] - closes[j-1]) / closes[j-1])
        if returns:
            s['volatility'] = (sum(r*r for r in returns) / len(returns)) ** 0.5
        else:
            s['volatility'] = 0

        # Trend (linear slope approximation)
        first_half = sum(closes[:len(closes)//2]) / (len(closes)//2)
        second_half = sum(closes[len(closes)//2:]) / (len(closes) - len(closes)//2)
        s['trend'] = (second_half - first_half) / first_half if first_half > 0 else 0

        # RSI-like (ratio of up moves)
        up_moves = sum(1 for r in returns if r > 0)
        s['rsi_like'] = up_moves / len(returns) if returns else 0.5

        enhanced.append(s)

    return enhanced


def normalize_and_save(samples, output_path):
    """Normalize features and save to CSV."""

    # Calculate volume stats for normalization
    volumes = [s['volume'] for s in samples]
    vol_mean = sum(volumes) / len(volumes)
    vol_std = (sum((v - vol_mean)**2 for v in volumes) / len(volumes)) ** 0.5

    with open(output_path, 'w', newline='') as f:
        writer = csv.writer(f)

        # Header
        writer.writerow([
            'timestamp', 'price',
            'sma_ratio', 'volatility', 'momentum', 'trend', 'rsi_like', 'volume_norm',
            'direction'
        ])

        for s in samples:
            # Normalize to 0-255 for compatibility
            def norm(val, low, high):
                return max(0, min(255, int((val - low) / (high - low) * 255)))

            row = [
                s['timestamp'],
                f"{s['close']:.4f}",
                norm(s['sma_ratio'], 0.98, 1.02),       # SMA ratio
                norm(s['volatility'], 0, 0.02),          # Volatility
                norm(s['momentum'], -0.01, 0.01),        # Momentum
                norm(s['trend'], -0.005, 0.005),         # Trend
                norm(s['rsi_like'], 0, 1),               # RSI-like
                norm((s['volume'] - vol_mean) / (vol_std + 1e-8), -2, 2),  # Volume Z-score
                s['direction']
            ]
            writer.writerow(row)

    return len(samples)


def main():
    print("=" * 60)
    print("Binance Historical Data Fetcher")
    print("=" * 60)

    symbol = "SOLUSDT"
    interval = "1m"  # 1 minute candles
    lookahead = 1    # 1 minute lookahead for direction

    # Fetch last 7 days of data (7 * 24 * 60 = 10080 candles)
    # Binance limit is 1000 per request, so we need multiple requests
    all_klines = []

    # Calculate start time (7 days ago)
    now = int(time.time() * 1000)
    seven_days_ago = now - (7 * 24 * 60 * 60 * 1000)

    current_start = seven_days_ago

    print(f"\nFetching {symbol} {interval} data...")
    print(f"From: {datetime.fromtimestamp(seven_days_ago/1000)}")
    print(f"To: {datetime.fromtimestamp(now/1000)}")

    while current_start < now:
        print(f"  Fetching from {datetime.fromtimestamp(current_start/1000)}...", end=" ")

        klines = fetch_klines(symbol, interval, limit=1000, start_time=current_start)

        if klines:
            print(f"got {len(klines)} candles")
            all_klines.extend(klines)
            # Move to after last candle
            current_start = int(klines[-1][0]) + 60000  # +1 minute
        else:
            print("failed, retrying...")
            time.sleep(1)
            continue

        time.sleep(0.2)  # Rate limit

    print(f"\nTotal candles fetched: {len(all_klines)}")

    # Remove duplicates (by timestamp)
    seen = set()
    unique_klines = []
    for k in all_klines:
        if k[0] not in seen:
            seen.add(k[0])
            unique_klines.append(k)

    print(f"Unique candles: {len(unique_klines)}")

    # Process into samples
    print(f"\nProcessing with {lookahead} minute lookahead...")
    samples = process_klines(unique_klines, lookahead_minutes=lookahead)
    print(f"Raw samples: {len(samples)}")

    # Add rolling features
    print("Adding rolling window features...")
    enhanced = add_rolling_features(samples, window=12)
    print(f"Enhanced samples: {len(enhanced)}")

    # Analyze direction distribution
    directions = {-1: 0, 0: 0, 1: 0}
    for s in enhanced:
        directions[s['direction']] += 1

    print(f"\nDirection distribution:")
    print(f"  DOWN (-1): {directions[-1]} ({directions[-1]/len(enhanced)*100:.1f}%)")
    print(f"  NEUTRAL (0): {directions[0]} ({directions[0]/len(enhanced)*100:.1f}%)")
    print(f"  UP (+1): {directions[1]} ({directions[1]/len(enhanced)*100:.1f}%)")

    binary_samples = directions[-1] + directions[1]
    print(f"\nBinary samples (UP+DOWN): {binary_samples}")

    # Save
    output_path = os.path.join(os.path.dirname(__file__), '../../data/binance_sol_1m.csv')
    count = normalize_and_save(enhanced, output_path)

    print(f"\nSaved {count} samples to {output_path}")
    print("=" * 60)


if __name__ == '__main__':
    main()
