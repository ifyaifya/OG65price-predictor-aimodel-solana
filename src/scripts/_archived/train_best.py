#!/usr/bin/env python3
"""
Best model: EMA denoising + top features from attention analysis
Features selected: trend, volatility, sma_ratio (top 3 from attention)
"""

import numpy as np
import os


def exponential_smooth(prices, alpha=0.3):
    prices = np.array(prices, dtype=float)
    smoothed = np.zeros_like(prices)
    smoothed[0] = prices[0]
    for i in range(1, len(prices)):
        smoothed[i] = alpha * prices[i] + (1 - alpha) * smoothed[i-1]
    return smoothed


def load_top_features(filepath):
    """Load with only top 3 features from attention analysis."""

    prices = []
    directions = []

    with open(filepath, 'r') as f:
        header = f.readline()
        for line in f:
            parts = line.strip().split(',')
            if len(parts) >= 9:
                try:
                    prices.append(float(parts[1]))
                    directions.append(int(parts[8]))
                except:
                    continue

    prices = np.array(prices)
    denoised = exponential_smooth(prices, alpha=0.3)

    X, y = [], []
    window = 12

    for i in range(window, len(denoised)):
        if directions[i] == 0:
            continue

        price_window = denoised[i-window:i+1]
        current = price_window[-1]

        # TOP 3 FEATURES from attention analysis:

        # 1. Trend (0.68 importance) - slope / current price
        x_vals = np.arange(len(price_window))
        slope = np.polyfit(x_vals, price_window, 1)[0]
        trend = slope / current if current > 0 else 0

        # 2. Volatility (0.58 importance) - std of returns
        returns = np.diff(price_window) / price_window[:-1]
        volatility = np.std(returns) if len(returns) > 0 else 0

        # 3. SMA Ratio (0.56 importance) - price / SMA
        sma = np.mean(price_window)
        sma_ratio = current / sma if sma > 0 else 1.0

        # 4. Momentum (0.48 importance) - (current - first) / first
        momentum = (current - price_window[0]) / price_window[0] if price_window[0] > 0 else 0

        # Normalize to [0, 1]
        features = [
            (trend + 0.001) / 0.002,      # [-0.001, 0.001] -> [0, 1]
            min(volatility * 100, 1.0),    # [0, 0.01] -> [0, 1]
            (sma_ratio - 0.95) / 0.1,      # [0.95, 1.05] -> [0, 1]
            (momentum + 0.02) / 0.04,      # [-0.02, 0.02] -> [0, 1]
        ]
        features = [max(0, min(1, f)) for f in features]

        X.append(features)
        y.append(1 if directions[i] > 0 else 0)

    return np.array(X), np.array(y)


def sigmoid(x):
    return 1 / (1 + np.exp(-np.clip(x, -500, 500)))


class SimpleNN:
    """4->4->1 network - minimal but effective."""

    def __init__(self):
        np.random.seed(42)
        self.W1 = np.random.randn(4, 4) * 0.5
        self.b1 = np.zeros(4)
        self.W2 = np.random.randn(4, 1) * 0.5
        self.b2 = np.zeros(1)

    def forward(self, x):
        self.z1 = np.dot(x, self.W1) + self.b1
        self.a1 = np.maximum(0, self.z1)
        self.z2 = np.dot(self.a1, self.W2) + self.b2
        return sigmoid(self.z2)

    def train(self, X, y, X_val=None, y_val=None, epochs=500, lr=0.01):
        print(f"Training 4->4->1 on {len(X)} samples...")

        best_val_acc = 0
        best_weights = None
        patience = 50
        no_improve = 0

        for epoch in range(epochs):
            total_loss = 0
            correct = 0

            for i in np.random.permutation(len(X)):
                x = X[i] * 2 - 1
                target = y[i]

                pred = self.forward(x)[0]

                eps = 1e-7
                loss = -target * np.log(pred + eps) - (1 - target) * np.log(1 - pred + eps)
                total_loss += loss

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
                    best_weights = (self.W1.copy(), self.b1.copy(), self.W2.copy(), self.b2.copy())
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
            print(f"Best validation: {best_val_acc:.1%}")

    def predict(self, X):
        return np.array([1 if self.forward(x * 2 - 1)[0] > 0.5 else 0 for x in X])

    def predict_proba(self, X):
        return np.array([self.forward(x * 2 - 1)[0] for x in X])

    def export_weights(self, output_dir):
        os.makedirs(output_dir, exist_ok=True)

        def quantize(w):
            scale = 127 / max(abs(w.min()), abs(w.max()), 1e-6)
            return np.clip(np.round(w * scale), -128, 127).astype(np.int8)

        W1_q = quantize(self.W1.flatten())
        b1_q = quantize(self.b1)
        W2_q = quantize(self.W2.flatten())
        b2_q = quantize(self.b2)

        with open(os.path.join(output_dir, 'best_model.bin'), 'wb') as f:
            f.write(bytes([int(x) & 0xFF for x in W1_q]))
            f.write(bytes([int(x) & 0xFF for x in b1_q]))
            f.write(bytes([int(x) & 0xFF for x in W2_q]))
            f.write(bytes([int(x) & 0xFF for x in b2_q]))

        total = len(W1_q) + len(b1_q) + len(W2_q) + len(b2_q)
        print(f"\nExported to {output_dir}/best_model.bin ({total} bytes)")
        print(f"W1: {W1_q.tolist()}")
        print(f"b1: {b1_q.tolist()}")
        print(f"W2: {W2_q.tolist()}")
        print(f"b2: {b2_q.tolist()}")


def run_multiple_seeds(X, y, n_runs=5):
    """Run with multiple random seeds to get stable estimate."""
    results = []

    for seed in range(n_runs):
        np.random.seed(seed)

        indices = np.random.permutation(len(X))
        X_shuffled, y_shuffled = X[indices], y[indices]

        n = len(X_shuffled)
        train_end = int(n * 0.6)
        val_end = int(n * 0.8)

        X_train = X_shuffled[:train_end]
        y_train = y_shuffled[:train_end]
        X_val = X_shuffled[train_end:val_end]
        y_val = y_shuffled[train_end:val_end]
        X_test = X_shuffled[val_end:]
        y_test = y_shuffled[val_end:]

        model = SimpleNN()
        model.train(X_train, y_train, X_val, y_val, epochs=300, lr=0.01)

        test_preds = model.predict(X_test)
        test_acc = np.mean(test_preds == y_test)
        results.append(test_acc)

        print(f"Seed {seed}: Test accuracy = {test_acc:.1%}")

    return results


def main():
    print("=" * 60)
    print("Best Model: EMA + Top Features (4->4->1)")
    print("Features: trend, volatility, sma_ratio, momentum")
    print("=" * 60)

    data_path = os.path.join(os.path.dirname(__file__), '../../data/sol_market_data.csv')

    X, y = load_top_features(data_path)

    print(f"\nLoaded {len(X)} samples with 4 features")
    print(f"UP: {np.sum(y==1)}, DOWN: {np.sum(y==0)}")

    # Run multiple times for stable estimate
    print("\n" + "=" * 40)
    print("Running 5 seeds for stable estimate...")
    print("=" * 40)

    results = run_multiple_seeds(X, y, n_runs=5)

    mean_acc = np.mean(results)
    std_acc = np.std(results)

    print(f"\n{'='*40}")
    print(f"AVERAGE TEST ACCURACY: {mean_acc:.1%} ± {std_acc:.1%}")
    print('='*40)

    # Final model on best split
    print("\nTraining final model...")
    np.random.seed(42)
    indices = np.random.permutation(len(X))
    X, y = X[indices], y[indices]

    train_end = int(len(X) * 0.8)
    X_train, y_train = X[:train_end], y[:train_end]
    X_test, y_test = X[train_end:], y[train_end:]

    model = SimpleNN()
    model.train(X_train, y_train, epochs=300, lr=0.01)

    test_preds = model.predict(X_test)
    test_acc = np.mean(test_preds == y_test)

    print(f"\nFinal Test Accuracy: {test_acc:.1%}")

    # High confidence
    probs = model.predict_proba(X_test)
    for thresh in [0.55, 0.60, 0.65, 0.70]:
        mask = (probs > thresh) | (probs < (1-thresh))
        if np.sum(mask) > 5:
            hc_acc = np.mean((probs[mask] > 0.5).astype(int) == y_test[mask])
            print(f"Confidence >{thresh:.0%}: {np.sum(mask)} samples, {hc_acc:.1%} accuracy")

    # Export
    weights_dir = os.path.join(os.path.dirname(__file__), '../../weights')
    model.export_weights(weights_dir)

    print("\n" + "=" * 60)
    print(f"SUMMARY")
    print("=" * 60)
    print(f"Average accuracy (5 seeds): {mean_acc:.1%} ± {std_acc:.1%}")
    print(f"Final model test accuracy:  {test_acc:.1%}")
    print(f"Model size: 21 bytes")
    print("=" * 60)


if __name__ == '__main__':
    main()
