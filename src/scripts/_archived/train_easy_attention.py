#!/usr/bin/env python3
"""
Easy Attention on EMA-denoised features
Combines best of both: EMA denoising (56.3%) + Easy Attention feature weighting
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


def load_ema_data(filepath):
    """Same features as train_wavelet.py that got 56.3%"""

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

        # Feature 1: Price vs SMA ratio
        sma = np.mean(price_window)
        sma_ratio = current / sma if sma > 0 else 1.0

        # Feature 2: Momentum
        momentum = (current - price_window[0]) / price_window[0] if price_window[0] > 0 else 0

        # Feature 3: Volatility
        returns = np.diff(price_window) / price_window[:-1]
        volatility = np.std(returns) if len(returns) > 0 else 0

        # Feature 4: Trend (slope)
        x_vals = np.arange(len(price_window))
        slope = np.polyfit(x_vals, price_window, 1)[0]
        trend = slope / current if current > 0 else 0

        # Feature 5: RSI-like
        up_moves = np.sum(returns > 0)
        rsi_like = up_moves / len(returns) if len(returns) > 0 else 0.5

        # Feature 6: Position in range
        local_range = np.max(price_window) - np.min(price_window)
        if local_range > 0:
            position = (current - np.min(price_window)) / local_range
        else:
            position = 0.5

        # Normalize to [0, 1]
        features = [
            (sma_ratio - 0.95) / 0.1,
            (momentum + 0.02) / 0.04,
            min(volatility * 100, 1.0),
            (trend + 0.001) / 0.002,
            rsi_like,
            position
        ]
        features = [max(0, min(1, f)) for f in features]

        X.append(features)
        y.append(1 if directions[i] > 0 else 0)

    return np.array(X), np.array(y)


def sigmoid(x):
    return 1 / (1 + np.exp(-np.clip(x, -500, 500)))


class EasyAttentionNN:
    """
    Easy Attention: No softmax, no Q/K matrices.
    Just learned per-feature importance weights.

    Architecture: Input -> Attention Gate -> Linear -> ReLU -> Linear -> Sigmoid
    """

    def __init__(self, input_size=6, hidden_size=8):
        np.random.seed(42)

        # Attention gate (per-feature importance)
        self.W_gate = np.random.randn(input_size) * 0.5
        self.b_gate = np.zeros(input_size)

        # MLP layers
        self.W1 = np.random.randn(input_size, hidden_size) * np.sqrt(2.0 / input_size)
        self.b1 = np.zeros(hidden_size)
        self.W2 = np.random.randn(hidden_size, 1) * np.sqrt(2.0 / hidden_size)
        self.b2 = np.zeros(1)

    def forward(self, x):
        # Easy Attention gate
        gate_logits = self.W_gate * x + self.b_gate
        self.gate = sigmoid(gate_logits)
        self.gated_x = x * self.gate

        # MLP
        self.z1 = np.dot(self.gated_x, self.W1) + self.b1
        self.a1 = np.maximum(0, self.z1)
        self.z2 = np.dot(self.a1, self.W2) + self.b2

        return sigmoid(self.z2)

    def train(self, X, y, X_val=None, y_val=None, epochs=500, lr=0.01, l2_reg=0.001):
        print(f"Training Easy Attention on {len(X)} samples...")

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
                d_W1 = np.outer(self.gated_x, d_z1) + l2_reg * self.W1
                d_b1 = d_z1

                # Backprop through attention gate
                d_gated_x = np.dot(d_z1, self.W1.T)
                d_gate = d_gated_x * x
                d_gate_logits = d_gate * self.gate * (1 - self.gate)
                d_W_gate = d_gate_logits * x
                d_b_gate = d_gate_logits

                # Update
                self.W2 -= lr * d_W2
                self.b2 -= lr * d_b2
                self.W1 -= lr * d_W1
                self.b1 -= lr * d_b1
                self.W_gate -= lr * 0.1 * d_W_gate  # Slower learning for gate
                self.b_gate -= lr * 0.1 * d_b_gate

            train_acc = correct / len(X)

            # Validation
            if X_val is not None:
                val_preds = self.predict(X_val)
                val_acc = np.mean(val_preds == y_val)

                if val_acc > best_val_acc:
                    best_val_acc = val_acc
                    best_weights = (
                        self.W_gate.copy(), self.b_gate.copy(),
                        self.W1.copy(), self.b1.copy(),
                        self.W2.copy(), self.b2.copy()
                    )
                    no_improve = 0
                else:
                    no_improve += 1

                if no_improve >= patience:
                    print(f"Early stopping at epoch {epoch+1}")
                    break

                if (epoch + 1) % 50 == 0:
                    gate_weights = sigmoid(self.W_gate)
                    print(f"Epoch {epoch+1}: Loss={total_loss/len(X):.4f}, Train={train_acc:.1%}, Val={val_acc:.1%}")
                    print(f"  Gate: {['%.2f' % g for g in gate_weights]}")
            else:
                if (epoch + 1) % 50 == 0:
                    print(f"Epoch {epoch+1}: Loss={total_loss/len(X):.4f}, Acc={train_acc:.1%}")

        if best_weights:
            (self.W_gate, self.b_gate,
             self.W1, self.b1,
             self.W2, self.b2) = best_weights
            print(f"Best validation accuracy: {best_val_acc:.1%}")

        return best_val_acc if X_val is not None else train_acc

    def predict(self, X):
        return np.array([1 if self.forward(x * 2 - 1)[0] > 0.5 else 0 for x in X])

    def predict_proba(self, X):
        return np.array([self.forward(x * 2 - 1)[0] for x in X])

    def get_gate_weights(self):
        return sigmoid(self.W_gate)

    def export_weights(self, output_dir):
        os.makedirs(output_dir, exist_ok=True)

        def quantize(w):
            scale = 127 / max(abs(w.min()), abs(w.max()), 1e-6)
            return np.clip(np.round(w * scale), -128, 127).astype(np.int8)

        all_weights = np.concatenate([
            self.W_gate, self.b_gate,  # 12 bytes
            self.W1.flatten(), self.b1,  # 48 + 8 = 56 bytes
            self.W2.flatten(), self.b2   # 8 + 1 = 9 bytes
        ])

        quantized = quantize(all_weights)

        with open(os.path.join(output_dir, 'easy_attention.bin'), 'wb') as f:
            f.write(bytes([int(x) & 0xFF for x in quantized]))

        print(f"\nExported to {output_dir}/easy_attention.bin")
        print(f"Total: {len(quantized)} bytes")

        # Also export gate weights for analysis
        gate = self.get_gate_weights()
        feature_names = ['sma_ratio', 'momentum', 'volatility', 'trend', 'rsi', 'position']
        print("\nLearned Feature Importance:")
        for name, g in sorted(zip(feature_names, gate), key=lambda x: -x[1]):
            bar = '█' * int(g * 20)
            print(f"  {name:12s}: {g:.2f} {bar}")


def main():
    print("=" * 60)
    print("Easy Attention + EMA Denoising")
    print("=" * 60)

    data_path = os.path.join(os.path.dirname(__file__), '../../data/sol_market_data.csv')

    X, y = load_ema_data(data_path)

    print(f"\nLoaded {len(X)} samples")
    print(f"UP: {np.sum(y==1)}, DOWN: {np.sum(y==0)}")

    # Shuffle and split 60/20/20
    indices = np.random.permutation(len(X))
    X, y = X[indices], y[indices]

    n = len(X)
    train_end = int(n * 0.6)
    val_end = int(n * 0.8)

    X_train, y_train = X[:train_end], y[:train_end]
    X_val, y_val = X[train_end:val_end], y[train_end:val_end]
    X_test, y_test = X[val_end:], y[val_end:]

    print(f"Train: {len(X_train)}, Val: {len(X_val)}, Test: {len(X_test)}")

    # Train Easy Attention model
    model = EasyAttentionNN(input_size=6, hidden_size=8)
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

    # High confidence analysis
    probs = model.predict_proba(X_test)
    for threshold in [0.55, 0.60, 0.65, 0.70]:
        high_conf = (probs > threshold) | (probs < (1 - threshold))
        if np.sum(high_conf) > 10:
            hc_preds = (probs[high_conf] > 0.5).astype(int)
            hc_acc = np.mean(hc_preds == y_test[high_conf])
            print(f"Confidence >{threshold:.0%}: {np.sum(high_conf)} samples, {hc_acc:.1%} accuracy")

    # Export
    weights_dir = os.path.join(os.path.dirname(__file__), '../../weights')
    model.export_weights(weights_dir)

    print("\n" + "=" * 60)
    print(f"FINAL: Test Accuracy = {test_acc:.1%}")
    print("=" * 60)


if __name__ == '__main__':
    main()
