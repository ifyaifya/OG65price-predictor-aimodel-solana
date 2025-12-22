#!/usr/bin/env python3
"""
Binary Price Predictor Training
Classifies UP (+1) vs DOWN (-1), ignoring neutral samples.
Simpler task = better accuracy.
"""

import numpy as np
import os

def load_binary_data(filepath):
    """Load data and filter to binary classification."""
    X, y = [], []

    with open(filepath, 'r') as f:
        header = f.readline()
        for line in f:
            parts = line.strip().split(',')
            if len(parts) >= 9:
                try:
                    features = [float(parts[i]) / 255.0 for i in range(2, 8)]
                    direction = int(parts[8])
                    # Only keep UP (+1) and DOWN (-1)
                    if direction != 0:
                        X.append(features)
                        y.append(1 if direction > 0 else 0)  # 1=UP, 0=DOWN
                except:
                    continue

    return np.array(X), np.array(y)

def sigmoid(x):
    return 1 / (1 + np.exp(-np.clip(x, -500, 500)))

class BinaryNN:
    """Simple 4->3->1 network for binary classification."""

    def __init__(self, input_size=4):
        np.random.seed(42)
        self.W1 = np.random.randn(input_size, 4) * 0.5
        self.b1 = np.zeros(4)
        self.W2 = np.random.randn(4, 1) * 0.5
        self.b2 = np.zeros(1)

    def forward(self, x):
        self.z1 = np.dot(x, self.W1) + self.b1
        self.a1 = np.maximum(0, self.z1)  # ReLU
        self.z2 = np.dot(self.a1, self.W2) + self.b2
        return sigmoid(self.z2)

    def train(self, X, y, epochs=500, lr=0.01):
        print(f"Training on {len(X)} samples...")

        for epoch in range(epochs):
            total_loss = 0
            correct = 0

            indices = np.random.permutation(len(X))
            for i in indices:
                x = X[i] * 2 - 1  # Normalize to [-1, 1]
                target = y[i]

                # Forward
                pred = self.forward(x)[0]

                # Loss (binary cross-entropy)
                eps = 1e-7
                loss = -target * np.log(pred + eps) - (1 - target) * np.log(1 - pred + eps)
                total_loss += loss

                if (pred > 0.5) == target:
                    correct += 1

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

            if (epoch + 1) % 50 == 0:
                acc = correct / len(X)
                print(f"Epoch {epoch+1}: Loss={total_loss/len(X):.4f}, Acc={acc:.1%}")

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
            scale = 127 / max(abs(w.min()), abs(w.max()))
            return np.clip(np.round(w * scale), -128, 127).astype(np.int8)

        W1_q = quantize(self.W1.flatten())
        b1_q = quantize(self.b1)
        W2_q = quantize(self.W2.flatten())
        b2_q = quantize(self.b2)

        # Save
        with open(os.path.join(output_dir, 'binary_encoder.bin'), 'wb') as f:
            f.write(bytes([int(x) & 0xFF for x in W1_q]))
            f.write(bytes([int(x) & 0xFF for x in b1_q]))

        with open(os.path.join(output_dir, 'binary_decoder.bin'), 'wb') as f:
            f.write(bytes([int(x) & 0xFF for x in W2_q]))
            f.write(bytes([int(x) & 0xFF for x in b2_q]))

        print(f"\nExported weights to {output_dir}")
        print(f"W1: {W1_q.tolist()}")
        print(f"b1: {b1_q.tolist()}")
        print(f"W2: {W2_q.tolist()}")
        print(f"b2: {b2_q.tolist()}")

def main():
    print("=" * 50)
    print("Binary Price Predictor Training")
    print("=" * 50)

    data_path = os.path.join(os.path.dirname(__file__), '../../data/sol_market_data.csv')
    X, y = load_binary_data(data_path)

    print(f"Loaded {len(X)} binary samples (UP/DOWN only)")
    print(f"UP: {np.sum(y==1)}, DOWN: {np.sum(y==0)}")

    # Split
    n = len(X)
    indices = np.random.permutation(n)
    X, y = X[indices], y[indices]

    train_end = int(n * 0.8)
    X_train, y_train = X[:train_end], y[:train_end]
    X_test, y_test = X[train_end:], y[train_end:]

    # Use only 4 most important features
    # 2=orderbook_imbal, 5=momentum seem most predictive
    X_train_4 = X_train[:, [2, 3, 4, 5]]  # orderbook, volatility, liquidity, momentum
    X_test_4 = X_test[:, [2, 3, 4, 5]]

    model = BinaryNN(input_size=4)
    model.train(X_train_4, y_train, epochs=300, lr=0.01)

    # Evaluate
    train_preds = model.predict(X_train_4)
    test_preds = model.predict(X_test_4)

    train_acc = np.mean(train_preds == y_train)
    test_acc = np.mean(test_preds == y_test)

    print(f"\nTrain Accuracy: {train_acc:.1%}")
    print(f"Test Accuracy: {test_acc:.1%}")

    # Export
    weights_dir = os.path.join(os.path.dirname(__file__), '../../weights')
    model.export_weights(weights_dir)

    print("\n" + "=" * 50)
    print(f"DONE - Test Accuracy: {test_acc:.1%}")
    print("=" * 50)

if __name__ == '__main__':
    main()
