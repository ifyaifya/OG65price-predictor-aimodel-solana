#!/usr/bin/env python3
"""
Train optimal model: 30 min lookahead, 0.5% threshold
Target: >55% test accuracy
"""

import numpy as np
import os

def exponential_smooth(prices, alpha=0.3):
    smoothed = np.zeros(len(prices))
    smoothed[0] = prices[0]
    for i in range(1, len(prices)):
        smoothed[i] = alpha * prices[i] + (1 - alpha) * smoothed[i-1]
    return smoothed

def load_binance_raw(filepath):
    timestamps, prices = [], []
    with open(filepath, 'r') as f:
        next(f)
        for line in f:
            parts = line.strip().split(',')
            if len(parts) >= 9:
                try:
                    timestamps.append(int(parts[0]))
                    prices.append(float(parts[1]))
                except:
                    continue
    return np.array(timestamps), np.array(prices)

def calculate_features(prices, idx, window=12):
    if idx < window:
        return None

    w = prices[idx-window:idx+1]
    current = w[-1]

    sma = np.mean(w)
    sma_ratio = current / sma if sma > 0 else 1.0

    momentum = (current - w[0]) / w[0] if w[0] > 0 else 0

    returns = np.diff(w) / w[:-1]
    volatility = np.std(returns) if len(returns) > 0 else 0

    x = np.arange(len(w))
    slope = np.polyfit(x, w, 1)[0]
    trend = slope / current if current > 0 else 0

    up_moves = np.sum(returns > 0)
    rsi_like = up_moves / len(returns) if len(returns) > 0 else 0.5

    local_min, local_max = np.min(w), np.max(w)
    position = (current - local_min) / (local_max - local_min) if local_max > local_min else 0.5

    features = [
        (sma_ratio - 0.98) / 0.04,
        (momentum + 0.02) / 0.04,
        min(volatility * 100, 1.0),
        (trend + 0.001) / 0.002,
        rsi_like,
        position
    ]
    return [max(0, min(1, f)) for f in features]

def load_data(filepath, lookahead=30, threshold=0.005, ema_alpha=0.3):
    """Load data with optimal configuration"""
    _, prices = load_binance_raw(filepath)
    smoothed = exponential_smooth(prices, alpha=ema_alpha)

    X, y = [], []
    for i in range(12, len(smoothed) - lookahead):
        current = smoothed[i]
        future = smoothed[i + lookahead]
        change = (future - current) / current

        if abs(change) < threshold:
            continue  # Skip neutral

        direction = 1 if change > 0 else 0
        features = calculate_features(smoothed, i)
        if features:
            X.append(features)
            y.append(direction)

    return np.array(X), np.array(y)

def sigmoid(x):
    return 1 / (1 + np.exp(-np.clip(x, -500, 500)))

class BinaryNN:
    def __init__(self, hidden=8):
        np.random.seed(42)
        self.W1 = np.random.randn(6, hidden) * np.sqrt(2.0 / 6)
        self.b1 = np.zeros(hidden)
        self.W2 = np.random.randn(hidden, 1) * np.sqrt(2.0 / hidden)
        self.b2 = np.zeros(1)

    def forward(self, x):
        self.z1 = np.dot(x, self.W1) + self.b1
        self.a1 = np.maximum(0, self.z1)
        self.z2 = np.dot(self.a1, self.W2) + self.b2
        return sigmoid(self.z2)

    def train(self, X, y, X_val, y_val, epochs=500, lr=0.01):
        best_val_acc = 0
        best_weights = None
        patience, no_improve = 50, 0

        for epoch in range(epochs):
            for i in np.random.permutation(len(X)):
                x = X[i] * 2 - 1
                target = y[i]
                pred = self.forward(x)[0]

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

            val_acc = np.mean(self.predict(X_val) == y_val)

            if val_acc > best_val_acc:
                best_val_acc = val_acc
                best_weights = (self.W1.copy(), self.b1.copy(), self.W2.copy(), self.b2.copy())
                no_improve = 0
            else:
                no_improve += 1
                if no_improve >= patience:
                    break

            if (epoch + 1) % 50 == 0:
                train_acc = np.mean(self.predict(X) == y)
                print(f"  Epoch {epoch+1}: Train={train_acc:.1%}, Val={val_acc:.1%}")

        if best_weights:
            self.W1, self.b1, self.W2, self.b2 = best_weights
        return best_val_acc

    def predict(self, X):
        return np.array([1 if self.forward(x * 2 - 1)[0] > 0.5 else 0 for x in X])

    def predict_proba(self, X):
        return np.array([self.forward(x * 2 - 1)[0] for x in X])

    def export(self, path):
        def q(w):
            s = 127 / max(abs(w.min()), abs(w.max()), 1e-6)
            return np.clip(np.round(w * s), -128, 127).astype(np.int8)

        with open(path, 'wb') as f:
            for w in [self.W1.flatten(), self.b1, self.W2.flatten(), self.b2]:
                f.write(bytes([int(x) & 0xFF for x in q(w)]))
        print(f"Exported to {path}")
        return q(self.W1.flatten()), q(self.b1), q(self.W2.flatten()), q(self.b2)

def main():
    print("="*60)
    print("OPTIMAL MODEL: 30 min lookahead, 0.5% threshold")
    print("="*60)

    data_path = os.path.join(os.path.dirname(__file__), '../../data/binance_sol_1m.csv')

    X, y = load_data(data_path, lookahead=30, threshold=0.005)

    print(f"\nTotal samples: {len(X)}")
    print(f"UP: {np.sum(y==1)} ({np.mean(y)*100:.1f}%)")
    print(f"DOWN: {np.sum(y==0)} ({(1-np.mean(y))*100:.1f}%)")

    # Chronological split
    n = len(X)
    train_end = int(n * 0.6)
    val_end = int(n * 0.8)

    X_train, y_train = X[:train_end], y[:train_end]
    X_val, y_val = X[train_end:val_end], y[train_end:val_end]
    X_test, y_test = X[val_end:], y[val_end:]

    print(f"\nSplit: Train={len(X_train)}, Val={len(X_val)}, Test={len(X_test)}")

    print("\nTraining...")
    model = BinaryNN(hidden=8)
    best_val = model.train(X_train, y_train, X_val, y_val, epochs=500, lr=0.01)

    # Evaluate
    train_acc = np.mean(model.predict(X_train) == y_train)
    val_acc = np.mean(model.predict(X_val) == y_val)
    test_acc = np.mean(model.predict(X_test) == y_test)

    print(f"\n{'='*40}")
    print("RESULTS")
    print('='*40)
    print(f"Train Accuracy: {train_acc:.1%}")
    print(f"Val Accuracy:   {val_acc:.1%}")
    print(f"Test Accuracy:  {test_acc:.1%}")

    # Confusion matrix
    preds = model.predict(X_test)
    tp = np.sum((preds == 1) & (y_test == 1))
    tn = np.sum((preds == 0) & (y_test == 0))
    fp = np.sum((preds == 1) & (y_test == 0))
    fn = np.sum((preds == 0) & (y_test == 1))

    print(f"\nConfusion Matrix:")
    print(f"  TN={tn}, FP={fp}")
    print(f"  FN={fn}, TP={tp}")

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0
    print(f"\nPrecision: {precision:.1%}")
    print(f"Recall:    {recall:.1%}")

    # Export
    weights_path = os.path.join(os.path.dirname(__file__), '../../weights/optimal_model.bin')
    W1, b1, W2, b2 = model.export(weights_path)

    # Print weights for on-chain code
    print("\n" + "="*60)
    print("WEIGHTS FOR ON-CHAIN CODE")
    print("="*60)
    print(f"\nW1 (6x8) = {list(W1)}")
    print(f"\nb1 (8) = {list(b1)}")
    print(f"\nW2 (8) = {list(W2)}")
    print(f"\nb2 = {list(b2)}")

    print("\n" + "="*60)
    print(f"FINAL TEST ACCURACY: {test_acc:.1%}")
    print("="*60)

if __name__ == '__main__':
    main()
