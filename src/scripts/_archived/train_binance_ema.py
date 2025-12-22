#!/usr/bin/env python3
"""
Train on Binance data with EMA denoising applied to raw prices
"""

import numpy as np
import os


def exponential_smooth(prices, alpha=0.3):
    """EMA denoising."""
    smoothed = np.zeros(len(prices))
    smoothed[0] = prices[0]
    for i in range(1, len(prices)):
        smoothed[i] = alpha * prices[i] + (1 - alpha) * smoothed[i-1]
    return smoothed


def load_binance_raw(filepath):
    """Load raw prices and directions from Binance CSV."""
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

    return np.array(timestamps), np.array(prices), np.array(directions)


def calculate_features_ema(prices, idx, window=12):
    """Calculate features using EMA-smoothed prices."""
    if idx < window:
        return None

    window_data = prices[idx-window:idx+1]
    current = window_data[-1]

    # 1. SMA ratio
    sma = np.mean(window_data)
    sma_ratio = current / sma if sma > 0 else 1.0

    # 2. Momentum
    momentum = (current - window_data[0]) / window_data[0] if window_data[0] > 0 else 0

    # 3. Volatility (on smoothed data - should be lower)
    returns = np.diff(window_data) / window_data[:-1]
    volatility = np.std(returns) if len(returns) > 0 else 0

    # 4. Trend (linear slope)
    x = np.arange(len(window_data))
    slope = np.polyfit(x, window_data, 1)[0]
    trend = slope / current if current > 0 else 0

    # 5. RSI-like
    up_moves = np.sum(returns > 0)
    rsi_like = up_moves / len(returns) if len(returns) > 0 else 0.5

    # 6. Position in range
    local_min = np.min(window_data)
    local_max = np.max(window_data)
    position = (current - local_min) / (local_max - local_min) if local_max > local_min else 0.5

    # Normalize to [0, 1]
    features = [
        (sma_ratio - 0.98) / 0.04,    # [0.98, 1.02]
        (momentum + 0.02) / 0.04,      # [-0.02, 0.02]
        min(volatility * 100, 1.0),    # [0, 0.01]
        (trend + 0.001) / 0.002,       # [-0.001, 0.001]
        rsi_like,
        position
    ]
    return [max(0, min(1, f)) for f in features]


def load_binance_ema(filepath, ema_alpha=0.3):
    """Load Binance data with EMA denoising."""
    _, prices, directions = load_binance_raw(filepath)

    print(f"Raw prices: {len(prices)}")
    print(f"Applying EMA (alpha={ema_alpha})...")

    # Apply EMA
    smoothed = exponential_smooth(prices, alpha=ema_alpha)

    noise_reduction = np.std(prices - smoothed) / np.std(prices) * 100
    print(f"Noise reduction: {noise_reduction:.1f}%")

    # Calculate features
    X, y = [], []

    for i in range(12, len(smoothed)):
        if directions[i] == 0:
            continue

        features = calculate_features_ema(smoothed, i, window=12)
        if features is None:
            continue

        X.append(features)
        y.append(1 if directions[i] > 0 else 0)

    return np.array(X), np.array(y)


def sigmoid(x):
    return 1 / (1 + np.exp(-np.clip(x, -500, 500)))


class BinaryNN:
    def __init__(self):
        np.random.seed(42)
        self.W1 = np.random.randn(6, 8) * np.sqrt(2.0 / 6)
        self.b1 = np.zeros(8)
        self.W2 = np.random.randn(8, 1) * np.sqrt(2.0 / 8)
        self.b2 = np.zeros(1)

    def forward(self, x):
        self.z1 = np.dot(x, self.W1) + self.b1
        self.a1 = np.maximum(0, self.z1)
        self.z2 = np.dot(self.a1, self.W2) + self.b2
        return sigmoid(self.z2)

    def train(self, X, y, X_val=None, y_val=None, epochs=500, lr=0.01):
        print(f"Training on {len(X)} samples...")

        best_val_acc = 0
        best_weights = None
        patience = 50
        no_improve = 0

        for epoch in range(epochs):
            correct = 0

            for i in np.random.permutation(len(X)):
                x = X[i] * 2 - 1
                target = y[i]

                pred = self.forward(x)[0]

                if (pred > 0.5) == target:
                    correct += 1

                d_z2 = pred - target
                d_W2 = np.outer(self.a1, d_z2)
                d_b2 = d_z2

                d_a1 = d_z2 * self.W2.flatten()
                d_z1 = d_a1 * (self.z1 > 0)
                d_W1 = np.outer(x, d_z1)
                d_b1 = d_z1

                self.W2 -= lr * d_W2
                self.b2 -= lr * d_b2
                self.W1 -= lr * d_W1
                self.b1 -= lr * d_b1

            train_acc = correct / len(X)

            if X_val is not None:
                val_preds = self.predict(X_val)
                val_acc = np.mean(val_preds == y_val)

                if val_acc > best_val_acc:
                    best_val_acc = val_acc
                    best_weights = (self.W1.copy(), self.b1.copy(),
                                   self.W2.copy(), self.b2.copy())
                    no_improve = 0
                else:
                    no_improve += 1

                if no_improve >= patience:
                    print(f"Early stopping at epoch {epoch+1}")
                    break

                if (epoch + 1) % 50 == 0:
                    print(f"Epoch {epoch+1}: Train={train_acc:.1%}, Val={val_acc:.1%}")

        if best_weights:
            self.W1, self.b1, self.W2, self.b2 = best_weights
            print(f"Best val: {best_val_acc:.1%}")

    def predict(self, X):
        return np.array([1 if self.forward(x * 2 - 1)[0] > 0.5 else 0 for x in X])

    def predict_proba(self, X):
        return np.array([self.forward(x * 2 - 1)[0] for x in X])


def main():
    print("=" * 60)
    print("Training on Binance Data + EMA Denoising")
    print("=" * 60)

    data_path = os.path.join(os.path.dirname(__file__), '../../data/binance_sol_1m.csv')

    # Test different EMA alphas
    alphas = [0.2, 0.3, 0.4, 0.5]
    results = {}

    for alpha in alphas:
        print(f"\n{'='*40}")
        print(f"EMA Alpha = {alpha}")
        print('='*40)

        X, y = load_binance_ema(data_path, ema_alpha=alpha)

        print(f"Samples: {len(X)}")
        print(f"UP: {np.sum(y==1)}, DOWN: {np.sum(y==0)}")

        # Split
        np.random.seed(42)
        indices = np.random.permutation(len(X))
        X, y = X[indices], y[indices]

        n = len(X)
        train_end = int(n * 0.6)
        val_end = int(n * 0.8)

        X_train, y_train = X[:train_end], y[:train_end]
        X_val, y_val = X[train_end:val_end], y[train_end:val_end]
        X_test, y_test = X[val_end:], y[val_end:]

        # Train
        model = BinaryNN()
        model.train(X_train, y_train, X_val, y_val, epochs=300, lr=0.01)

        # Test
        test_preds = model.predict(X_test)
        test_acc = np.mean(test_preds == y_test)

        print(f"Test Accuracy: {test_acc:.1%}")

        # High confidence
        probs = model.predict_proba(X_test)
        mask = (probs > 0.6) | (probs < 0.4)
        if np.sum(mask) > 10:
            hc_acc = np.mean((probs[mask] > 0.5).astype(int) == y_test[mask])
            print(f"High Conf (>60%): {np.sum(mask)} samples, {hc_acc:.1%}")

        results[alpha] = test_acc

    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    for alpha, acc in sorted(results.items(), key=lambda x: -x[1]):
        print(f"Alpha {alpha}: {acc:.1%}")

    best_alpha = max(results, key=results.get)
    print(f"\nBest: Alpha={best_alpha} with {results[best_alpha]:.1%}")
    print("=" * 60)


if __name__ == '__main__':
    main()
