#!/usr/bin/env python3
"""
Binary Price Predictor with Multi-Timeframe Features
Combines features from multiple time scales for better prediction.

Based on research:
- xLSTM-TS (arXiv:2408.12408) - 72.82% accuracy
- Multi-Scale Feature Engineering papers

Key insight: Combine short-term momentum with long-term trend.
"""

import numpy as np
import os


def exponential_smooth(prices, alpha=0.3):
    """Exponential smoothing for denoising."""
    prices = np.array(prices, dtype=float)
    smoothed = np.zeros_like(prices)
    smoothed[0] = prices[0]
    for i in range(1, len(prices)):
        smoothed[i] = alpha * prices[i] + (1 - alpha) * smoothed[i-1]
    return smoothed


def calculate_rsi(prices, period=14):
    """Calculate RSI (Relative Strength Index)."""
    if len(prices) < period + 1:
        return 50.0  # Neutral

    deltas = np.diff(prices)
    gains = np.maximum(deltas, 0)
    losses = np.abs(np.minimum(deltas, 0))

    avg_gain = np.mean(gains[-period:])
    avg_loss = np.mean(losses[-period:])

    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def calculate_macd(prices, fast=12, slow=26):
    """Calculate MACD signal."""
    if len(prices) < slow:
        return 0.0

    ema_fast = exponential_smooth(prices, alpha=2/(fast+1))[-1]
    ema_slow = exponential_smooth(prices, alpha=2/(slow+1))[-1]

    return (ema_fast - ema_slow) / ema_slow if ema_slow > 0 else 0


def calculate_bollinger_position(prices, period=20):
    """Calculate position within Bollinger Bands (0-1)."""
    if len(prices) < period:
        return 0.5

    window = prices[-period:]
    sma = np.mean(window)
    std = np.std(window)

    if std == 0:
        return 0.5

    current = prices[-1]
    upper = sma + 2 * std
    lower = sma - 2 * std

    position = (current - lower) / (upper - lower)
    return max(0, min(1, position))


def calculate_multitimeframe_features(all_prices, idx, denoised_prices):
    """
    Calculate features across multiple timeframes.

    Timeframes (assuming 1-minute intervals):
    - Short: 5 samples (5 min)
    - Medium: 15 samples (15 min)
    - Long: 30 samples (30 min)
    """

    if idx < 30:
        return None

    # Get windows at different timeframes
    short_window = denoised_prices[idx-5:idx+1]    # 5 min
    medium_window = denoised_prices[idx-15:idx+1]  # 15 min
    long_window = denoised_prices[idx-30:idx+1]    # 30 min

    current = denoised_prices[idx]

    features = []

    # === SHORT-TERM FEATURES (5 min) ===

    # 1. Short-term momentum
    momentum_short = (current - short_window[0]) / short_window[0] if short_window[0] > 0 else 0
    features.append(momentum_short)

    # 2. Short-term volatility
    returns_short = np.diff(short_window) / short_window[:-1]
    vol_short = np.std(returns_short) if len(returns_short) > 0 else 0
    features.append(vol_short)

    # 3. Short-term SMA ratio
    sma_short = np.mean(short_window)
    sma_ratio_short = current / sma_short if sma_short > 0 else 1
    features.append(sma_ratio_short)

    # === MEDIUM-TERM FEATURES (15 min) ===

    # 4. Medium-term momentum
    momentum_med = (current - medium_window[0]) / medium_window[0] if medium_window[0] > 0 else 0
    features.append(momentum_med)

    # 5. Medium-term trend (linear regression slope)
    x_vals = np.arange(len(medium_window))
    slope_med = np.polyfit(x_vals, medium_window, 1)[0]
    trend_med = slope_med / current if current > 0 else 0
    features.append(trend_med)

    # 6. RSI (15-period)
    rsi = calculate_rsi(medium_window, period=min(14, len(medium_window)-1))
    features.append(rsi / 100.0)  # Normalize to [0, 1]

    # === LONG-TERM FEATURES (30 min) ===

    # 7. Long-term momentum
    momentum_long = (current - long_window[0]) / long_window[0] if long_window[0] > 0 else 0
    features.append(momentum_long)

    # 8. Long-term SMA ratio
    sma_long = np.mean(long_window)
    sma_ratio_long = current / sma_long if sma_long > 0 else 1
    features.append(sma_ratio_long)

    # 9. Bollinger position
    bb_pos = calculate_bollinger_position(long_window, period=min(20, len(long_window)))
    features.append(bb_pos)

    # === CROSS-TIMEFRAME FEATURES ===

    # 10. Short vs Long momentum divergence
    divergence = momentum_short - momentum_long
    features.append(divergence)

    # 11. Trend alignment (are short and long trends aligned?)
    alignment = 1 if (momentum_short > 0 and momentum_long > 0) or \
                     (momentum_short < 0 and momentum_long < 0) else 0
    features.append(alignment)

    # 12. Acceleration (change in momentum)
    mid_idx = len(medium_window) // 2
    momentum_mid_first = (medium_window[mid_idx] - medium_window[0]) / medium_window[0] if medium_window[0] > 0 else 0
    acceleration = momentum_short - momentum_mid_first
    features.append(acceleration)

    return features


def normalize_features(features):
    """Normalize features to [0, 1] range."""
    # Feature normalization bounds (empirically determined)
    bounds = [
        (-0.02, 0.02),   # 0: momentum_short
        (0, 0.01),       # 1: vol_short
        (0.98, 1.02),    # 2: sma_ratio_short
        (-0.05, 0.05),   # 3: momentum_med
        (-0.001, 0.001), # 4: trend_med
        (0, 1),          # 5: RSI (already normalized)
        (-0.1, 0.1),     # 6: momentum_long
        (0.95, 1.05),    # 7: sma_ratio_long
        (0, 1),          # 8: bb_pos (already normalized)
        (-0.05, 0.05),   # 9: divergence
        (0, 1),          # 10: alignment (already binary)
        (-0.02, 0.02),   # 11: acceleration
    ]

    normalized = []
    for i, (feat, (low, high)) in enumerate(zip(features, bounds)):
        if high == low:
            norm = 0.5
        else:
            norm = (feat - low) / (high - low)
        normalized.append(max(0, min(1, norm)))

    return normalized


def load_multitimeframe_data(filepath):
    """Load data and calculate multi-timeframe features."""

    # Load all data
    timestamps = []
    prices = []
    directions = []

    with open(filepath, 'r') as f:
        header = f.readline()
        for line in f:
            parts = line.strip().split(',')
            if len(parts) >= 9:
                try:
                    timestamps.append(int(parts[0]))
                    prices.append(float(parts[1]))
                    directions.append(int(parts[8]))
                except:
                    continue

    if len(prices) < 50:
        raise ValueError("Not enough data")

    # Apply EMA denoising
    prices = np.array(prices)
    denoised = exponential_smooth(prices, alpha=0.3)

    print(f"Loaded {len(prices)} samples")
    print(f"Price range: ${prices.min():.2f} - ${prices.max():.2f}")
    print(f"EMA noise reduction: {np.std(prices - denoised) / np.std(prices) * 100:.1f}%")

    # Calculate features
    X, y = [], []

    for i in range(30, len(denoised)):
        features = calculate_multitimeframe_features(prices, i, denoised)

        if features is None:
            continue

        direction = directions[i]
        if direction == 0:  # Skip neutral
            continue

        normalized = normalize_features(features)
        X.append(normalized)
        y.append(1 if direction > 0 else 0)

    return np.array(X), np.array(y)


def sigmoid(x):
    return 1 / (1 + np.exp(-np.clip(x, -500, 500)))


class MultiTimeframeNN:
    """12->16->8->1 network for multi-timeframe classification."""

    def __init__(self, input_size=12):
        np.random.seed(42)
        # He initialization for ReLU
        self.W1 = np.random.randn(input_size, 16) * np.sqrt(2.0 / input_size)
        self.b1 = np.zeros(16)
        self.W2 = np.random.randn(16, 8) * np.sqrt(2.0 / 16)
        self.b2 = np.zeros(8)
        self.W3 = np.random.randn(8, 1) * np.sqrt(2.0 / 8)
        self.b3 = np.zeros(1)

    def forward(self, x):
        self.z1 = np.dot(x, self.W1) + self.b1
        self.a1 = np.maximum(0, self.z1)  # ReLU

        self.z2 = np.dot(self.a1, self.W2) + self.b2
        self.a2 = np.maximum(0, self.z2)  # ReLU

        self.z3 = np.dot(self.a2, self.W3) + self.b3
        return sigmoid(self.z3)

    def train(self, X, y, X_val=None, y_val=None, epochs=500, lr=0.005, l2_reg=0.001):
        print(f"Training 12->16->8->1 network on {len(X)} samples...")

        best_val_acc = 0
        best_weights = None
        patience = 30
        no_improve = 0

        for epoch in range(epochs):
            total_loss = 0
            correct = 0

            # Shuffle
            indices = np.random.permutation(len(X))

            for i in indices:
                x = X[i] * 2 - 1  # Normalize to [-1, 1]
                target = y[i]

                # Forward
                pred = self.forward(x)[0]

                # Binary cross-entropy with L2
                eps = 1e-7
                loss = -target * np.log(pred + eps) - (1 - target) * np.log(1 - pred + eps)
                loss += l2_reg * (np.sum(self.W1**2) + np.sum(self.W2**2) + np.sum(self.W3**2))
                total_loss += loss

                if (pred > 0.5) == target:
                    correct += 1

                # Backward pass
                # Layer 3
                d_z3 = pred - target
                d_W3 = np.outer(self.a2, d_z3) + l2_reg * self.W3
                d_b3 = d_z3

                # Layer 2
                d_a2 = d_z3 * self.W3.flatten()
                d_z2 = d_a2 * (self.z2 > 0)
                d_W2 = np.outer(self.a1, d_z2) + l2_reg * self.W2
                d_b2 = d_z2

                # Layer 1
                d_a1 = np.dot(d_z2, self.W2.T)
                d_z1 = d_a1 * (self.z1 > 0)
                d_W1 = np.outer(x, d_z1) + l2_reg * self.W1
                d_b1 = d_z1

                # Update
                self.W3 -= lr * d_W3
                self.b3 -= lr * d_b3
                self.W2 -= lr * d_W2
                self.b2 -= lr * d_b2
                self.W1 -= lr * d_W1
                self.b1 -= lr * d_b1

            train_acc = correct / len(X)

            # Validation
            if X_val is not None:
                val_preds = self.predict(X_val)
                val_acc = np.mean(val_preds == y_val)

                if val_acc > best_val_acc:
                    best_val_acc = val_acc
                    best_weights = (
                        self.W1.copy(), self.b1.copy(),
                        self.W2.copy(), self.b2.copy(),
                        self.W3.copy(), self.b3.copy()
                    )
                    no_improve = 0
                else:
                    no_improve += 1

                if no_improve >= patience:
                    print(f"Early stopping at epoch {epoch+1}")
                    break

                if (epoch + 1) % 50 == 0:
                    print(f"Epoch {epoch+1}: Loss={total_loss/len(X):.4f}, Train={train_acc:.1%}, Val={val_acc:.1%}")
            else:
                if (epoch + 1) % 50 == 0:
                    print(f"Epoch {epoch+1}: Loss={total_loss/len(X):.4f}, Acc={train_acc:.1%}")

        if best_weights:
            self.W1, self.b1, self.W2, self.b2, self.W3, self.b3 = best_weights
            print(f"Restored best weights (val_acc={best_val_acc:.1%})")

    def predict(self, X):
        preds = []
        for x in X:
            p = self.forward(x * 2 - 1)[0]
            preds.append(1 if p > 0.5 else 0)
        return np.array(preds)

    def export_weights(self, output_dir):
        """Export INT8 weights."""
        os.makedirs(output_dir, exist_ok=True)

        def quantize(w):
            scale = 127 / max(abs(w.min()), abs(w.max()), 1e-6)
            return np.clip(np.round(w * scale), -128, 127).astype(np.int8)

        W1_q = quantize(self.W1.flatten())
        b1_q = quantize(self.b1)
        W2_q = quantize(self.W2.flatten())
        b2_q = quantize(self.b2)
        W3_q = quantize(self.W3.flatten())
        b3_q = quantize(self.b3)

        # Layer 1: 12*16 + 16 = 208 bytes
        with open(os.path.join(output_dir, 'mtf_layer1.bin'), 'wb') as f:
            f.write(bytes([int(x) & 0xFF for x in W1_q]))
            f.write(bytes([int(x) & 0xFF for x in b1_q]))

        # Layer 2: 16*8 + 8 = 136 bytes
        with open(os.path.join(output_dir, 'mtf_layer2.bin'), 'wb') as f:
            f.write(bytes([int(x) & 0xFF for x in W2_q]))
            f.write(bytes([int(x) & 0xFF for x in b2_q]))

        # Layer 3: 8*1 + 1 = 9 bytes
        with open(os.path.join(output_dir, 'mtf_layer3.bin'), 'wb') as f:
            f.write(bytes([int(x) & 0xFF for x in W3_q]))
            f.write(bytes([int(x) & 0xFF for x in b3_q]))

        print(f"\nExported weights to {output_dir}")
        print(f"Layer 1: {len(W1_q) + len(b1_q)} bytes")
        print(f"Layer 2: {len(W2_q) + len(b2_q)} bytes")
        print(f"Layer 3: {len(W3_q) + len(b3_q)} bytes")
        print(f"Total: {len(W1_q) + len(b1_q) + len(W2_q) + len(b2_q) + len(W3_q) + len(b3_q)} bytes")


def main():
    print("=" * 60)
    print("Multi-Timeframe Price Predictor")
    print("12 Features: Short (5min) + Medium (15min) + Long (30min)")
    print("=" * 60)

    data_path = os.path.join(os.path.dirname(__file__), '../../data/sol_market_data.csv')

    X, y = load_multitimeframe_data(data_path)

    print(f"\n{len(X)} binary samples with 12 features")
    print(f"UP: {np.sum(y==1)}, DOWN: {np.sum(y==0)}")

    # Split: 60% train, 20% validation, 20% test
    n = len(X)
    indices = np.random.permutation(n)
    X, y = X[indices], y[indices]

    train_end = int(n * 0.6)
    val_end = int(n * 0.8)

    X_train, y_train = X[:train_end], y[:train_end]
    X_val, y_val = X[train_end:val_end], y[train_end:val_end]
    X_test, y_test = X[val_end:], y[val_end:]

    print(f"Train: {len(X_train)}, Val: {len(X_val)}, Test: {len(X_test)}")

    # Train
    model = MultiTimeframeNN(input_size=12)
    model.train(X_train, y_train, X_val, y_val, epochs=500, lr=0.005, l2_reg=0.001)

    # Final evaluation
    train_preds = model.predict(X_train)
    val_preds = model.predict(X_val)
    test_preds = model.predict(X_test)

    train_acc = np.mean(train_preds == y_train)
    val_acc = np.mean(val_preds == y_val)
    test_acc = np.mean(test_preds == y_test)

    print(f"\n{'='*40}")
    print("FINAL RESULTS")
    print('='*40)
    print(f"Train Accuracy: {train_acc:.1%}")
    print(f"Val Accuracy:   {val_acc:.1%}")
    print(f"Test Accuracy:  {test_acc:.1%}")

    # Detailed metrics on test set
    tp = np.sum((test_preds == 1) & (y_test == 1))
    tn = np.sum((test_preds == 0) & (y_test == 0))
    fp = np.sum((test_preds == 1) & (y_test == 0))
    fn = np.sum((test_preds == 0) & (y_test == 1))

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

    print(f"\nPrecision (UP): {precision:.1%}")
    print(f"Recall (UP):    {recall:.1%}")
    print(f"F1 Score:       {f1:.1%}")

    print(f"\nConfusion Matrix:")
    print(f"  Pred DOWN | Pred UP")
    print(f"DOWN:  {tn:4d} | {fp:4d}")
    print(f"UP:    {fn:4d} | {tp:4d}")

    # Export weights
    weights_dir = os.path.join(os.path.dirname(__file__), '../../weights')
    model.export_weights(weights_dir)

    print("\n" + "=" * 60)
    print(f"DONE - Test Accuracy: {test_acc:.1%}")
    print("=" * 60)


if __name__ == '__main__':
    main()
