#!/usr/bin/env python3
"""
Binary Price Predictor with Easy Attention
Based on arXiv:2308.12874 - No softmax, no Q/K matrices

Key insight: Attention can be simplified to direct linear weighting.
"""

import numpy as np
import os


def exponential_smooth(prices, alpha=0.3):
    """EMA denoising."""
    prices = np.array(prices, dtype=float)
    smoothed = np.zeros_like(prices)
    smoothed[0] = prices[0]
    for i in range(1, len(prices)):
        smoothed[i] = alpha * prices[i] + (1 - alpha) * smoothed[i-1]
    return smoothed


def load_data_simple(filepath):
    """Load with EMA + simple multi-timeframe (3 scales)."""

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

    # Simple multi-timeframe: 5, 10, 20 samples
    for i in range(20, len(denoised)):
        if directions[i] == 0:
            continue

        current = denoised[i]

        # Short-term (5 samples)
        w5 = denoised[i-5:i+1]
        momentum_5 = (current - w5[0]) / w5[0] if w5[0] > 0 else 0
        sma_5 = np.mean(w5)

        # Medium-term (10 samples)
        w10 = denoised[i-10:i+1]
        momentum_10 = (current - w10[0]) / w10[0] if w10[0] > 0 else 0
        sma_10 = np.mean(w10)

        # Long-term (20 samples)
        w20 = denoised[i-20:i+1]
        momentum_20 = (current - w20[0]) / w20[0] if w20[0] > 0 else 0
        sma_20 = np.mean(w20)

        # 6 features: 3 momentums + 3 SMA ratios
        features = [
            (momentum_5 + 0.01) / 0.02,      # [-0.01, 0.01] -> [0,1]
            (momentum_10 + 0.02) / 0.04,     # [-0.02, 0.02] -> [0,1]
            (momentum_20 + 0.03) / 0.06,     # [-0.03, 0.03] -> [0,1]
            (current/sma_5 - 0.99) / 0.02,   # [0.99, 1.01] -> [0,1]
            (current/sma_10 - 0.98) / 0.04,  # [0.98, 1.02] -> [0,1]
            (current/sma_20 - 0.97) / 0.06,  # [0.97, 1.03] -> [0,1]
        ]
        features = [max(0, min(1, f)) for f in features]

        X.append(features)
        y.append(1 if directions[i] > 0 else 0)

    return np.array(X), np.array(y)


def sigmoid(x):
    return 1 / (1 + np.exp(-np.clip(x, -500, 500)))


class EasyAttentionNN:
    """
    Network with Easy Attention mechanism.

    Architecture:
    Input (6) -> Easy Attention -> Linear (6->4) -> ReLU -> Linear (4->1) -> Sigmoid

    Easy Attention: attention_weights = sigmoid(W_a @ x)
                    attended = x * attention_weights  (element-wise)

    No softmax, no Q/K - just learned feature importance!
    """

    def __init__(self, input_size=6, hidden_size=4):
        np.random.seed(42)

        # Attention weights (learns feature importance)
        self.W_attn = np.random.randn(input_size) * 0.5
        self.b_attn = np.zeros(input_size)

        # Main network
        self.W1 = np.random.randn(input_size, hidden_size) * np.sqrt(2.0 / input_size)
        self.b1 = np.zeros(hidden_size)
        self.W2 = np.random.randn(hidden_size, 1) * np.sqrt(2.0 / hidden_size)
        self.b2 = np.zeros(1)

    def forward(self, x):
        # Easy Attention: element-wise feature weighting
        self.attn_logits = self.W_attn * x + self.b_attn
        self.attn_weights = sigmoid(self.attn_logits)
        self.attended = x * self.attn_weights  # Element-wise multiplication

        # MLP
        self.z1 = np.dot(self.attended, self.W1) + self.b1
        self.a1 = np.maximum(0, self.z1)  # ReLU
        self.z2 = np.dot(self.a1, self.W2) + self.b2

        return sigmoid(self.z2)

    def train(self, X, y, epochs=300, lr=0.01):
        print(f"Training Easy Attention on {len(X)} samples...")

        best_acc = 0
        best_weights = None

        for epoch in range(epochs):
            total_loss = 0
            correct = 0

            indices = np.random.permutation(len(X))

            for i in indices:
                x = X[i] * 2 - 1  # [-1, 1]
                target = y[i]

                # Forward
                pred = self.forward(x)[0]

                # Loss
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
                d_W1 = np.outer(self.attended, d_z1)
                d_b1 = d_z1

                # Backprop through attention
                d_attended = np.dot(d_z1, self.W1.T)
                d_attn_weights = d_attended * x
                d_attn_logits = d_attn_weights * self.attn_weights * (1 - self.attn_weights)
                d_W_attn = d_attn_logits * x
                d_b_attn = d_attn_logits

                # Update
                self.W2 -= lr * d_W2
                self.b2 -= lr * d_b2
                self.W1 -= lr * d_W1
                self.b1 -= lr * d_b1
                self.W_attn -= lr * d_W_attn
                self.b_attn -= lr * d_b_attn

            acc = correct / len(X)

            if acc > best_acc:
                best_acc = acc
                best_weights = (
                    self.W_attn.copy(), self.b_attn.copy(),
                    self.W1.copy(), self.b1.copy(),
                    self.W2.copy(), self.b2.copy()
                )

            if (epoch + 1) % 50 == 0:
                print(f"Epoch {epoch+1}: Loss={total_loss/len(X):.4f}, Acc={acc:.1%}")
                # Show attention weights
                attn_importance = sigmoid(self.W_attn)
                print(f"  Attention: {['%.2f' % w for w in attn_importance]}")

        if best_weights:
            (self.W_attn, self.b_attn,
             self.W1, self.b1,
             self.W2, self.b2) = best_weights
            print(f"Best accuracy: {best_acc:.1%}")

    def predict(self, X):
        return np.array([1 if self.forward(x * 2 - 1)[0] > 0.5 else 0 for x in X])

    def get_feature_importance(self):
        """Return learned feature importance from attention."""
        return sigmoid(self.W_attn)

    def export_weights(self, output_dir):
        os.makedirs(output_dir, exist_ok=True)

        def quantize(w):
            scale = 127 / max(abs(w.min()), abs(w.max()), 1e-6)
            return np.clip(np.round(w * scale), -128, 127).astype(np.int8)

        # Attention: 6 + 6 = 12 bytes
        W_attn_q = quantize(self.W_attn)
        b_attn_q = quantize(self.b_attn)

        # Layer 1: 6*4 + 4 = 28 bytes
        W1_q = quantize(self.W1.flatten())
        b1_q = quantize(self.b1)

        # Layer 2: 4*1 + 1 = 5 bytes
        W2_q = quantize(self.W2.flatten())
        b2_q = quantize(self.b2)

        with open(os.path.join(output_dir, 'attention_weights.bin'), 'wb') as f:
            f.write(bytes([int(x) & 0xFF for x in W_attn_q]))
            f.write(bytes([int(x) & 0xFF for x in b_attn_q]))
            f.write(bytes([int(x) & 0xFF for x in W1_q]))
            f.write(bytes([int(x) & 0xFF for x in b1_q]))
            f.write(bytes([int(x) & 0xFF for x in W2_q]))
            f.write(bytes([int(x) & 0xFF for x in b2_q]))

        print(f"\nExported to {output_dir}/attention_weights.bin")
        print(f"Total: {12 + 28 + 5} = 45 bytes")


class SimpleMultiTimeframeNN:
    """
    Simplified multi-timeframe: just 6 features, small network.
    """

    def __init__(self):
        np.random.seed(42)
        self.W1 = np.random.randn(6, 4) * 0.5
        self.b1 = np.zeros(4)
        self.W2 = np.random.randn(4, 1) * 0.5
        self.b2 = np.zeros(1)

    def forward(self, x):
        self.z1 = np.dot(x, self.W1) + self.b1
        self.a1 = np.maximum(0, self.z1)
        self.z2 = np.dot(self.a1, self.W2) + self.b2
        return sigmoid(self.z2)

    def train(self, X, y, epochs=300, lr=0.01):
        print(f"Training Simple MTF on {len(X)} samples...")

        best_acc = 0
        best_weights = None

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

            acc = correct / len(X)

            if acc > best_acc:
                best_acc = acc
                best_weights = (self.W1.copy(), self.b1.copy(), self.W2.copy(), self.b2.copy())

            if (epoch + 1) % 50 == 0:
                print(f"Epoch {epoch+1}: Loss={total_loss/len(X):.4f}, Acc={acc:.1%}")

        if best_weights:
            self.W1, self.b1, self.W2, self.b2 = best_weights
            print(f"Best accuracy: {best_acc:.1%}")

    def predict(self, X):
        return np.array([1 if self.forward(x * 2 - 1)[0] > 0.5 else 0 for x in X])


def main():
    print("=" * 60)
    print("Easy Attention + Simple Multi-Timeframe")
    print("=" * 60)

    data_path = os.path.join(os.path.dirname(__file__), '../../data/sol_market_data.csv')

    X, y = load_data_simple(data_path)

    print(f"\nLoaded {len(X)} samples with 6 features")
    print(f"Features: momentum_5, momentum_10, momentum_20, sma_ratio_5, sma_ratio_10, sma_ratio_20")
    print(f"UP: {np.sum(y==1)}, DOWN: {np.sum(y==0)}")

    # Shuffle and split
    indices = np.random.permutation(len(X))
    X, y = X[indices], y[indices]

    train_end = int(len(X) * 0.8)
    X_train, y_train = X[:train_end], y[:train_end]
    X_test, y_test = X[train_end:], y[train_end:]

    # Test 1: Simple Multi-Timeframe
    print("\n" + "=" * 40)
    print("Model 1: Simple Multi-Timeframe (6->4->1)")
    print("=" * 40)

    model1 = SimpleMultiTimeframeNN()
    model1.train(X_train, y_train, epochs=300, lr=0.01)

    test_preds1 = model1.predict(X_test)
    test_acc1 = np.mean(test_preds1 == y_test)
    print(f"Test Accuracy: {test_acc1:.1%}")

    # Test 2: Easy Attention
    print("\n" + "=" * 40)
    print("Model 2: Easy Attention (6->attn->4->1)")
    print("=" * 40)

    model2 = EasyAttentionNN(input_size=6, hidden_size=4)
    model2.train(X_train, y_train, epochs=300, lr=0.01)

    test_preds2 = model2.predict(X_test)
    test_acc2 = np.mean(test_preds2 == y_test)
    print(f"Test Accuracy: {test_acc2:.1%}")

    # Feature importance
    importance = model2.get_feature_importance()
    feature_names = ['mom_5', 'mom_10', 'mom_20', 'sma_5', 'sma_10', 'sma_20']
    print("\nLearned Feature Importance:")
    for name, imp in sorted(zip(feature_names, importance), key=lambda x: -x[1]):
        bar = '█' * int(imp * 20)
        print(f"  {name:8s}: {imp:.2f} {bar}")

    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Simple MTF (6->4->1):    {test_acc1:.1%}")
    print(f"Easy Attention:          {test_acc2:.1%}")

    # Export best model
    best_model = model2 if test_acc2 >= test_acc1 else None
    if best_model and test_acc2 > 0.55:
        weights_dir = os.path.join(os.path.dirname(__file__), '../../weights')
        best_model.export_weights(weights_dir)

    print("=" * 60)


if __name__ == '__main__':
    main()
