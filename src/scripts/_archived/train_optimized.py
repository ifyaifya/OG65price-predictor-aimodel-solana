#!/usr/bin/env python3
"""
Optimized Binary Price Predictor
Combines best techniques: EMA denoising + best features + balanced training
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


def load_optimized_data(filepath):
    """
    Load data with EMA denoising and calculate optimized features.
    Focus on features that matter: momentum, trend alignment, volatility ratio
    """

    # Load all data
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

    if len(prices) < 50:
        raise ValueError("Not enough data")

    # Apply EMA denoising
    prices = np.array(prices)
    denoised = exponential_smooth(prices, alpha=0.25)

    # Calculate optimized features
    X, y = [], []
    window = 20

    for i in range(window, len(denoised)):
        if directions[i] == 0:  # Skip neutral
            continue

        current = denoised[i]
        window_data = denoised[i-window:i+1]

        # Feature 1: Normalized momentum (most predictive)
        momentum = (current - window_data[0]) / window_data[0]

        # Feature 2: SMA ratio
        sma = np.mean(window_data)
        sma_ratio = current / sma

        # Feature 3: Volatility (std of returns)
        returns = np.diff(window_data) / window_data[:-1]
        volatility = np.std(returns)

        # Feature 4: Trend direction (sign of linear slope)
        x_vals = np.arange(len(window_data))
        slope = np.polyfit(x_vals, window_data, 1)[0]
        trend = slope / current

        # Feature 5: RSI-like (proportion of up moves)
        up_moves = np.sum(returns > 0)
        rsi_like = up_moves / len(returns)

        # Feature 6: Position in range [0, 1]
        local_min = np.min(window_data)
        local_max = np.max(window_data)
        if local_max > local_min:
            position = (current - local_min) / (local_max - local_min)
        else:
            position = 0.5

        # Normalize to [0, 1]
        features = [
            (momentum + 0.02) / 0.04,      # [-0.02, 0.02] -> [0, 1]
            (sma_ratio - 0.98) / 0.04,     # [0.98, 1.02] -> [0, 1]
            min(volatility * 50, 1.0),     # [0, 0.02] -> [0, 1]
            (trend + 0.001) / 0.002,       # [-0.001, 0.001] -> [0, 1]
            rsi_like,                       # Already [0, 1]
            position                        # Already [0, 1]
        ]
        features = [max(0, min(1, f)) for f in features]

        X.append(features)
        y.append(1 if directions[i] > 0 else 0)

    return np.array(X), np.array(y)


def sigmoid(x):
    return 1 / (1 + np.exp(-np.clip(x, -500, 500)))


class OptimizedNN:
    """Simple 6->4->1 network (sweet spot for this task)."""

    def __init__(self):
        np.random.seed(42)
        self.W1 = np.random.randn(6, 4) * 0.5
        self.b1 = np.zeros(4)
        self.W2 = np.random.randn(4, 1) * 0.5
        self.b2 = np.zeros(1)

    def forward(self, x):
        self.z1 = np.dot(x, self.W1) + self.b1
        self.a1 = np.maximum(0, self.z1)  # ReLU
        self.z2 = np.dot(self.a1, self.W2) + self.b2
        return sigmoid(self.z2)

    def train_balanced(self, X, y, epochs=300, lr=0.01):
        """Train with class balancing."""
        print(f"Training with balanced sampling on {len(X)} samples...")

        # Separate by class
        idx_up = np.where(y == 1)[0]
        idx_down = np.where(y == 0)[0]

        min_class = min(len(idx_up), len(idx_down))
        print(f"UP: {len(idx_up)}, DOWN: {len(idx_down)}, Balanced: {min_class*2}")

        best_acc = 0
        best_weights = None

        for epoch in range(epochs):
            total_loss = 0
            correct = 0
            total = 0

            # Balanced sampling: equal number from each class
            np.random.shuffle(idx_up)
            np.random.shuffle(idx_down)

            # Interleave samples
            for i in range(min_class):
                for idx in [idx_up[i], idx_down[i]]:
                    x = X[idx] * 2 - 1
                    target = y[idx]

                    # Forward
                    pred = self.forward(x)[0]

                    # Loss
                    eps = 1e-7
                    loss = -target * np.log(pred + eps) - (1 - target) * np.log(1 - pred + eps)
                    total_loss += loss

                    if (pred > 0.5) == target:
                        correct += 1
                    total += 1

                    # Backward
                    d_z2 = pred - target
                    d_W2 = np.outer(self.a1, d_z2)
                    d_b2 = d_z2

                    d_a1 = d_z2 * self.W2.flatten()
                    d_z1 = d_a1 * (self.z1 > 0)
                    d_W1 = np.outer(x, d_z1)
                    d_b1 = d_z1

                    # Update
                    self.W2 -= lr * d_W2
                    self.b2 -= lr * d_b2
                    self.W1 -= lr * d_W1
                    self.b1 -= lr * d_b1

            acc = correct / total

            if acc > best_acc:
                best_acc = acc
                best_weights = (self.W1.copy(), self.b1.copy(),
                               self.W2.copy(), self.b2.copy())

            if (epoch + 1) % 50 == 0:
                print(f"Epoch {epoch+1}: Loss={total_loss/total:.4f}, Acc={acc:.1%}")

        if best_weights:
            self.W1, self.b1, self.W2, self.b2 = best_weights
            print(f"Best training accuracy: {best_acc:.1%}")

    def predict(self, X):
        preds = []
        for x in X:
            p = self.forward(x * 2 - 1)[0]
            preds.append(1 if p > 0.5 else 0)
        return np.array(preds)

    def predict_proba(self, X):
        probs = []
        for x in X:
            p = self.forward(x * 2 - 1)[0]
            probs.append(p)
        return np.array(probs)

    def export_weights(self, output_dir):
        """Export INT8 weights for on-chain."""
        os.makedirs(output_dir, exist_ok=True)

        def quantize(w):
            scale = 127 / max(abs(w.min()), abs(w.max()), 1e-6)
            return np.clip(np.round(w * scale), -128, 127).astype(np.int8)

        W1_q = quantize(self.W1.flatten())
        b1_q = quantize(self.b1)
        W2_q = quantize(self.W2.flatten())
        b2_q = quantize(self.b2)

        with open(os.path.join(output_dir, 'optimized_encoder.bin'), 'wb') as f:
            f.write(bytes([int(x) & 0xFF for x in W1_q]))
            f.write(bytes([int(x) & 0xFF for x in b1_q]))

        with open(os.path.join(output_dir, 'optimized_decoder.bin'), 'wb') as f:
            f.write(bytes([int(x) & 0xFF for x in W2_q]))
            f.write(bytes([int(x) & 0xFF for x in b2_q]))

        print(f"\nExported to {output_dir}")
        print(f"Encoder: {len(W1_q) + len(b1_q)} bytes (6x4 + 4 = 28)")
        print(f"Decoder: {len(W2_q) + len(b2_q)} bytes (4x1 + 1 = 5)")
        print(f"Total: 33 bytes")

        print(f"\nW1: {W1_q.tolist()}")
        print(f"b1: {b1_q.tolist()}")
        print(f"W2: {W2_q.tolist()}")
        print(f"b2: {b2_q.tolist()}")


def cross_validate(X, y, n_folds=5):
    """Perform k-fold cross validation."""
    fold_size = len(X) // n_folds
    accuracies = []

    print(f"\n{n_folds}-Fold Cross Validation:")

    for fold in range(n_folds):
        # Split
        test_start = fold * fold_size
        test_end = test_start + fold_size

        X_test = X[test_start:test_end]
        y_test = y[test_start:test_end]

        X_train = np.concatenate([X[:test_start], X[test_end:]])
        y_train = np.concatenate([y[:test_start], y[test_end:]])

        # Train
        model = OptimizedNN()
        model.train_balanced(X_train, y_train, epochs=200, lr=0.01)

        # Evaluate
        preds = model.predict(X_test)
        acc = np.mean(preds == y_test)
        accuracies.append(acc)

        print(f"  Fold {fold+1}: {acc:.1%}")

    mean_acc = np.mean(accuracies)
    std_acc = np.std(accuracies)
    print(f"\nCV Accuracy: {mean_acc:.1%} +/- {std_acc:.1%}")

    return mean_acc, std_acc


def main():
    print("=" * 60)
    print("Optimized Binary Price Predictor")
    print("EMA Denoising + 6 Features + Balanced Training + Cross-Val")
    print("=" * 60)

    data_path = os.path.join(os.path.dirname(__file__), '../../data/sol_market_data.csv')

    X, y = load_optimized_data(data_path)

    print(f"\nLoaded {len(X)} binary samples")
    print(f"UP: {np.sum(y==1)} ({np.mean(y)*100:.1f}%)")
    print(f"DOWN: {np.sum(y==0)} ({(1-np.mean(y))*100:.1f}%)")

    # Shuffle
    indices = np.random.permutation(len(X))
    X, y = X[indices], y[indices]

    # Cross-validation
    cv_mean, cv_std = cross_validate(X, y, n_folds=5)

    # Final model on 80/20 split
    print("\n" + "=" * 60)
    print("Training Final Model (80/20 split)")
    print("=" * 60)

    train_end = int(len(X) * 0.8)
    X_train, y_train = X[:train_end], y[:train_end]
    X_test, y_test = X[train_end:], y[train_end:]

    model = OptimizedNN()
    model.train_balanced(X_train, y_train, epochs=300, lr=0.01)

    # Evaluate
    train_preds = model.predict(X_train)
    test_preds = model.predict(X_test)

    train_acc = np.mean(train_preds == y_train)
    test_acc = np.mean(test_preds == y_test)

    print(f"\nTrain Accuracy: {train_acc:.1%}")
    print(f"Test Accuracy:  {test_acc:.1%}")

    # Detailed metrics
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

    # Confidence analysis
    probs = model.predict_proba(X_test)
    high_conf_mask = (probs > 0.6) | (probs < 0.4)
    if np.sum(high_conf_mask) > 0:
        high_conf_preds = (probs[high_conf_mask] > 0.5).astype(int)
        high_conf_acc = np.mean(high_conf_preds == y_test[high_conf_mask])
        print(f"\nHigh confidence (>60%) predictions: {np.sum(high_conf_mask)}")
        print(f"High confidence accuracy: {high_conf_acc:.1%}")

    # Export
    weights_dir = os.path.join(os.path.dirname(__file__), '../../weights')
    model.export_weights(weights_dir)

    print("\n" + "=" * 60)
    print(f"SUMMARY")
    print("=" * 60)
    print(f"Cross-Val Accuracy: {cv_mean:.1%} +/- {cv_std:.1%}")
    print(f"Test Accuracy:      {test_acc:.1%}")
    print(f"Model size:         33 bytes")
    print("=" * 60)


if __name__ == '__main__':
    main()
