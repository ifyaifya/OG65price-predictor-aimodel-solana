#!/usr/bin/env python3
"""
Train on Binance historical data (much cleaner than real-time Pyth)
"""

import numpy as np
import os


def load_binance_data(filepath):
    """Load Binance data - already has good features calculated."""
    X, y = [], []

    with open(filepath, 'r') as f:
        header = f.readline()
        for line in f:
            parts = line.strip().split(',')
            if len(parts) >= 9:
                try:
                    # Features are already normalized to 0-255
                    features = [float(parts[i]) / 255.0 for i in range(2, 8)]
                    direction = int(parts[8])

                    if direction != 0:  # Binary only
                        X.append(features)
                        y.append(1 if direction > 0 else 0)
                except:
                    continue

    return np.array(X), np.array(y)


def sigmoid(x):
    return 1 / (1 + np.exp(-np.clip(x, -500, 500)))


class BinaryNN:
    """6->8->1 network with EMA-style smoothing."""

    def __init__(self):
        np.random.seed(42)
        self.W1 = np.random.randn(6, 8) * np.sqrt(2.0 / 6)
        self.b1 = np.zeros(8)
        self.W2 = np.random.randn(8, 1) * np.sqrt(2.0 / 8)
        self.b2 = np.zeros(1)

    def forward(self, x):
        self.z1 = np.dot(x, self.W1) + self.b1
        self.a1 = np.maximum(0, self.z1)  # ReLU
        self.z2 = np.dot(self.a1, self.W2) + self.b2
        return sigmoid(self.z2)

    def train(self, X, y, X_val=None, y_val=None, epochs=500, lr=0.01, l2_reg=0.001):
        print(f"Training on {len(X)} samples...")

        best_val_acc = 0
        best_weights = None
        patience = 50
        no_improve = 0

        for epoch in range(epochs):
            total_loss = 0
            correct = 0

            for i in np.random.permutation(len(X)):
                x = X[i] * 2 - 1  # [-1, 1]
                target = y[i]

                pred = self.forward(x)[0]

                eps = 1e-7
                loss = -target * np.log(pred + eps) - (1 - target) * np.log(1 - pred + eps)
                loss += l2_reg * (np.sum(self.W1**2) + np.sum(self.W2**2))
                total_loss += loss

                if (pred > 0.5) == target:
                    correct += 1

                # Backward
                d_z2 = pred - target
                d_W2 = np.outer(self.a1, d_z2) + l2_reg * self.W2
                d_b2 = d_z2

                d_a1 = d_z2 * self.W2.flatten()
                d_z1 = d_a1 * (self.z1 > 0)
                d_W1 = np.outer(x, d_z1) + l2_reg * self.W1
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
            else:
                if (epoch + 1) % 50 == 0:
                    print(f"Epoch {epoch+1}: Acc={train_acc:.1%}")

        if best_weights:
            self.W1, self.b1, self.W2, self.b2 = best_weights
            print(f"Restored best weights (val_acc={best_val_acc:.1%})")

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

        with open(os.path.join(output_dir, 'binance_model.bin'), 'wb') as f:
            f.write(bytes([int(x) & 0xFF for x in W1_q]))
            f.write(bytes([int(x) & 0xFF for x in b1_q]))
            f.write(bytes([int(x) & 0xFF for x in W2_q]))
            f.write(bytes([int(x) & 0xFF for x in b2_q]))

        print(f"\nExported to {output_dir}/binance_model.bin")
        print(f"Size: {len(W1_q) + len(b1_q) + len(W2_q) + len(b2_q)} bytes")


def main():
    print("=" * 60)
    print("Training on Binance Historical Data")
    print("7 days, 5-min lookahead, 0.15% threshold")
    print("=" * 60)

    data_path = os.path.join(os.path.dirname(__file__), '../../data/binance_sol_1m.csv')

    X, y = load_binance_data(data_path)

    print(f"\nLoaded {len(X)} binary samples")
    print(f"UP: {np.sum(y==1)} ({np.mean(y)*100:.1f}%)")
    print(f"DOWN: {np.sum(y==0)} ({(1-np.mean(y))*100:.1f}%)")

    # Shuffle and split 60/20/20
    np.random.seed(42)
    indices = np.random.permutation(len(X))
    X, y = X[indices], y[indices]

    n = len(X)
    train_end = int(n * 0.6)
    val_end = int(n * 0.8)

    X_train, y_train = X[:train_end], y[:train_end]
    X_val, y_val = X[train_end:val_end], y[train_end:val_end]
    X_test, y_test = X[val_end:], y[val_end:]

    print(f"Train: {len(X_train)}, Val: {len(X_val)}, Test: {len(X_test)}")

    # Train
    model = BinaryNN()
    model.train(X_train, y_train, X_val, y_val, epochs=500, lr=0.01, l2_reg=0.001)

    # Evaluate
    train_preds = model.predict(X_train)
    val_preds = model.predict(X_val)
    test_preds = model.predict(X_test)

    train_acc = np.mean(train_preds == y_train)
    val_acc = np.mean(val_preds == y_val)
    test_acc = np.mean(test_preds == y_test)

    print(f"\n{'='*40}")
    print("RESULTS")
    print('='*40)
    print(f"Train Accuracy: {train_acc:.1%}")
    print(f"Val Accuracy:   {val_acc:.1%}")
    print(f"Test Accuracy:  {test_acc:.1%}")

    # Confusion matrix
    tp = np.sum((test_preds == 1) & (y_test == 1))
    tn = np.sum((test_preds == 0) & (y_test == 0))
    fp = np.sum((test_preds == 1) & (y_test == 0))
    fn = np.sum((test_preds == 0) & (y_test == 1))

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0

    print(f"\nPrecision (UP): {precision:.1%}")
    print(f"Recall (UP):    {recall:.1%}")

    # High confidence
    probs = model.predict_proba(X_test)
    for thresh in [0.55, 0.60, 0.65, 0.70]:
        mask = (probs > thresh) | (probs < (1-thresh))
        if np.sum(mask) > 10:
            hc_preds = (probs[mask] > 0.5).astype(int)
            hc_acc = np.mean(hc_preds == y_test[mask])
            print(f"Confidence >{thresh:.0%}: {np.sum(mask)} samples, {hc_acc:.1%} accuracy")

    # Export
    weights_dir = os.path.join(os.path.dirname(__file__), '../../weights')
    model.export_weights(weights_dir)

    print("\n" + "=" * 60)
    print(f"FINAL: Test Accuracy = {test_acc:.1%}")
    print("=" * 60)


if __name__ == '__main__':
    main()
