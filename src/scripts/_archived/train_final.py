#!/usr/bin/env python3
"""
Final training with 30 days of Binance data
Robust validation with large test set
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
    timestamps, prices, directions = [], [], []
    with open(filepath, 'r') as f:
        next(f)
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


def load_data(filepath, ema_alpha=0.3):
    _, prices, directions = load_binance_raw(filepath)
    smoothed = exponential_smooth(prices, alpha=ema_alpha)

    X, y = [], []
    for i in range(12, len(smoothed)):
        if directions[i] == 0:
            continue
        features = calculate_features(smoothed, i)
        if features:
            X.append(features)
            y.append(1 if directions[i] > 0 else 0)

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

            val_acc = np.mean(self.predict(X_val) == y_val)

            if val_acc > best_val_acc:
                best_val_acc = val_acc
                best_weights = (self.W1.copy(), self.b1.copy(), self.W2.copy(), self.b2.copy())
                no_improve = 0
            else:
                no_improve += 1
                if no_improve >= patience:
                    break

            if (epoch + 1) % 100 == 0:
                print(f"  Epoch {epoch+1}: Train={correct/len(X):.1%}, Val={val_acc:.1%}")

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


def analyze_confidence(model, X_test, y_test):
    """Analyze accuracy at different confidence thresholds."""
    probs = model.predict_proba(X_test)

    print("\n" + "="*60)
    print("CONFIDENCE ANALYSIS")
    print("="*60)
    print(f"{'Threshold':<12} {'Samples':<10} {'Accuracy':<10} {'Win Rate'}")
    print("-"*50)

    for thresh in [0.50, 0.52, 0.55, 0.58, 0.60, 0.65, 0.70, 0.75]:
        mask = (probs > thresh) | (probs < (1-thresh))
        n = np.sum(mask)
        if n > 0:
            preds = (probs[mask] > 0.5).astype(int)
            acc = np.mean(preds == y_test[mask])
            print(f">{thresh:.0%}          {n:<10} {acc:.1%}       {acc:.1%}")

    return probs


def main():
    print("="*60)
    print("FINAL MODEL - 30 Days Binance Data")
    print("="*60)

    data_path = os.path.join(os.path.dirname(__file__), '../../data/binance_sol_1m.csv')

    X, y = load_data(data_path, ema_alpha=0.3)

    print(f"\nTotal samples: {len(X)}")
    print(f"UP: {np.sum(y==1)} ({np.mean(y)*100:.1f}%)")
    print(f"DOWN: {np.sum(y==0)} ({(1-np.mean(y))*100:.1f}%)")

    # Chronological split (important for time series!)
    # Train on first 60%, validate on next 20%, test on last 20%
    n = len(X)
    train_end = int(n * 0.6)
    val_end = int(n * 0.8)

    X_train, y_train = X[:train_end], y[:train_end]
    X_val, y_val = X[train_end:val_end], y[train_end:val_end]
    X_test, y_test = X[val_end:], y[val_end:]

    print(f"\nChronological split:")
    print(f"  Train: {len(X_train)} (first 60%)")
    print(f"  Val:   {len(X_val)} (next 20%)")
    print(f"  Test:  {len(X_test)} (last 20%) <- UNSEEN FUTURE DATA")

    # Train
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

    # Confusion matrix on test
    preds = model.predict(X_test)
    tp = np.sum((preds == 1) & (y_test == 1))
    tn = np.sum((preds == 0) & (y_test == 0))
    fp = np.sum((preds == 1) & (y_test == 0))
    fn = np.sum((preds == 0) & (y_test == 1))

    print(f"\nConfusion Matrix (Test):")
    print(f"              Pred DOWN  Pred UP")
    print(f"  Actual DOWN:  {tn:5d}    {fp:5d}")
    print(f"  Actual UP:    {fn:5d}    {tp:5d}")

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0
    print(f"\nPrecision: {precision:.1%}")
    print(f"Recall:    {recall:.1%}")

    # Confidence analysis
    probs = analyze_confidence(model, X_test, y_test)

    # Simulate trading with confidence filter
    print("\n" + "="*60)
    print("TRADING SIMULATION (Test Period)")
    print("="*60)

    for conf_thresh in [0.55, 0.60, 0.65]:
        mask = (probs > conf_thresh) | (probs < (1-conf_thresh))
        n_trades = np.sum(mask)
        if n_trades > 0:
            trade_preds = (probs[mask] > 0.5).astype(int)
            trade_actual = y_test[mask]
            wins = np.sum(trade_preds == trade_actual)
            win_rate = wins / n_trades

            # Assuming 0.1% profit per correct trade, 0.1% loss per wrong
            pnl = wins * 0.001 - (n_trades - wins) * 0.001

            print(f"\nConfidence >{conf_thresh:.0%}:")
            print(f"  Trades: {n_trades}")
            print(f"  Wins:   {wins} ({win_rate:.1%})")
            print(f"  Losses: {n_trades - wins}")
            print(f"  Est. PnL: {pnl*100:.2f}% (assuming 0.1% per trade)")

    # Export
    weights_path = os.path.join(os.path.dirname(__file__), '../../weights/final_model.bin')
    model.export(weights_path)

    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    print(f"Test Accuracy (all trades):     {test_acc:.1%}")

    # Best high-confidence result
    mask_60 = (probs > 0.60) | (probs < 0.40)
    if np.sum(mask_60) > 0:
        acc_60 = np.mean((probs[mask_60] > 0.5).astype(int) == y_test[mask_60])
        print(f"Test Accuracy (conf >60%):      {acc_60:.1%} ({np.sum(mask_60)} trades)")

    print("="*60)


if __name__ == '__main__':
    main()
