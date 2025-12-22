#!/usr/bin/env python3
"""
Binary Price Predictor with Wavelet Denoising
Based on xLSTM-TS paper (arXiv:2408.12408) - 72.82% accuracy on stock trend prediction

Key insight: Micro-fluctuations are noise. Wavelet transform extracts underlying trend.
"""

import numpy as np
import os

# Simple wavelet denoising (without pywt dependency)
def haar_wavelet_denoise(prices, level=2):
    """
    Simplified Haar wavelet denoising.
    Haar is the simplest wavelet - can implement without pywt.
    """
    signal = np.array(prices, dtype=float)
    n = len(signal)

    # Pad to power of 2
    pad_len = 2 ** int(np.ceil(np.log2(n)))
    padded = np.pad(signal, (0, pad_len - n), mode='edge')

    # Haar wavelet decomposition
    coeffs = []
    current = padded.copy()

    for _ in range(level):
        # Downsample: average (approximation) and difference (detail)
        approx = (current[::2] + current[1::2]) / 2
        detail = (current[::2] - current[1::2]) / 2
        coeffs.append(detail)
        current = approx
    coeffs.append(current)  # Final approximation

    # Threshold detail coefficients (soft thresholding)
    for i in range(len(coeffs) - 1):  # Don't threshold approximation
        threshold = np.std(coeffs[i]) * 0.5
        coeffs[i] = np.sign(coeffs[i]) * np.maximum(np.abs(coeffs[i]) - threshold, 0)

    # Reconstruct
    reconstructed = coeffs[-1]
    for detail in reversed(coeffs[:-1]):
        # Upsample and add detail
        upsampled = np.repeat(reconstructed, 2)[:len(detail)*2]
        detail_up = np.repeat(detail, 2)[:len(detail)*2]
        reconstructed = upsampled + np.concatenate([detail_up[::2], -detail_up[1::2]])
        # Fix: proper reconstruction
        reconstructed = np.zeros(len(detail) * 2)
        for j in range(len(detail)):
            reconstructed[2*j] = upsampled[j] + detail[j]
            reconstructed[2*j + 1] = upsampled[j] - detail[j] if 2*j+1 < len(reconstructed) else 0

    return reconstructed[:n]


def moving_average_denoise(prices, window=5):
    """
    Simple moving average smoothing - more robust than wavelet.
    """
    prices = np.array(prices, dtype=float)
    smoothed = np.convolve(prices, np.ones(window)/window, mode='same')
    # Fix edges
    for i in range(window//2):
        smoothed[i] = np.mean(prices[:i+window//2+1])
        smoothed[-(i+1)] = np.mean(prices[-(i+window//2+1):])
    return smoothed


def exponential_smooth(prices, alpha=0.3):
    """
    Exponential smoothing - gives more weight to recent values.
    """
    prices = np.array(prices, dtype=float)
    smoothed = np.zeros_like(prices)
    smoothed[0] = prices[0]
    for i in range(1, len(prices)):
        smoothed[i] = alpha * prices[i] + (1 - alpha) * smoothed[i-1]
    return smoothed


def load_and_denoise_data(filepath, denoise_method='ema'):
    """Load data and apply denoising to prices before feature calculation."""

    # First pass: collect all prices
    all_prices = []
    all_rows = []

    with open(filepath, 'r') as f:
        header = f.readline()
        for line in f:
            parts = line.strip().split(',')
            if len(parts) >= 9:
                try:
                    price = float(parts[1])
                    all_prices.append(price)
                    all_rows.append(parts)
                except:
                    continue

    if len(all_prices) < 20:
        raise ValueError("Not enough data for denoising")

    # Apply denoising
    prices = np.array(all_prices)

    if denoise_method == 'wavelet':
        denoised = haar_wavelet_denoise(prices, level=2)
    elif denoise_method == 'ma':
        denoised = moving_average_denoise(prices, window=5)
    elif denoise_method == 'ema':
        denoised = exponential_smooth(prices, alpha=0.3)
    else:
        denoised = prices  # No denoising

    # Recalculate features with denoised prices
    X, y = [], []
    window = 12  # Lookback window for feature calculation

    for i in range(window, len(denoised)):
        price_window = denoised[i-window:i+1]
        current = price_window[-1]

        # Feature 1: Price vs SMA ratio
        sma = np.mean(price_window)
        sma_ratio = current / sma if sma > 0 else 1.0

        # Feature 2: Momentum (normalized)
        momentum = (current - price_window[0]) / price_window[0] if price_window[0] > 0 else 0

        # Feature 3: Volatility (std of returns)
        returns = np.diff(price_window) / price_window[:-1]
        volatility = np.std(returns) if len(returns) > 0 else 0

        # Feature 4: Trend strength (linear regression slope)
        x_vals = np.arange(len(price_window))
        slope = np.polyfit(x_vals, price_window, 1)[0]
        trend = slope / current if current > 0 else 0

        # Feature 5: RSI-like (ratio of up moves to total moves)
        up_moves = np.sum(returns > 0)
        total_moves = len(returns)
        rsi_like = up_moves / total_moves if total_moves > 0 else 0.5

        # Feature 6: Distance from local min/max
        local_range = np.max(price_window) - np.min(price_window)
        if local_range > 0:
            position = (current - np.min(price_window)) / local_range
        else:
            position = 0.5

        features = [sma_ratio, momentum, volatility, trend, rsi_like, position]

        # Get direction from original data
        direction = int(all_rows[i][8])

        if direction != 0:  # Binary only
            # Normalize features to [0, 1]
            norm_features = [
                (sma_ratio - 0.95) / 0.1,  # Assume SMA ratio in [0.95, 1.05]
                (momentum + 0.02) / 0.04,   # Assume momentum in [-0.02, 0.02]
                min(volatility * 100, 1.0), # Scale volatility
                (trend + 0.001) / 0.002,    # Assume trend in [-0.001, 0.001]
                rsi_like,                    # Already in [0, 1]
                position                     # Already in [0, 1]
            ]
            norm_features = [max(0, min(1, f)) for f in norm_features]

            X.append(norm_features)
            y.append(1 if direction > 0 else 0)

    return np.array(X), np.array(y), prices, denoised


def sigmoid(x):
    return 1 / (1 + np.exp(-np.clip(x, -500, 500)))


class BinaryNN:
    """Enhanced 6->8->1 network for binary classification."""

    def __init__(self, input_size=6, hidden_size=8):
        np.random.seed(42)
        # Xavier initialization
        self.W1 = np.random.randn(input_size, hidden_size) * np.sqrt(2.0 / input_size)
        self.b1 = np.zeros(hidden_size)
        self.W2 = np.random.randn(hidden_size, 1) * np.sqrt(2.0 / hidden_size)
        self.b2 = np.zeros(1)

    def forward(self, x):
        self.z1 = np.dot(x, self.W1) + self.b1
        self.a1 = np.maximum(0, self.z1)  # ReLU
        self.z2 = np.dot(self.a1, self.W2) + self.b2
        return sigmoid(self.z2)

    def train(self, X, y, epochs=500, lr=0.01, l2_reg=0.001):
        print(f"Training on {len(X)} samples with L2 regularization...")

        best_acc = 0
        best_weights = None
        patience = 50
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

                # Loss with L2 regularization
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

                # Update with momentum
                self.W2 -= lr * d_W2
                self.b2 -= lr * d_b2
                self.W1 -= lr * d_W1
                self.b1 -= lr * d_b1

            acc = correct / len(X)

            # Early stopping
            if acc > best_acc:
                best_acc = acc
                best_weights = (self.W1.copy(), self.b1.copy(),
                               self.W2.copy(), self.b2.copy())
                no_improve = 0
            else:
                no_improve += 1

            if no_improve >= patience:
                print(f"Early stopping at epoch {epoch+1}")
                break

            if (epoch + 1) % 50 == 0:
                print(f"Epoch {epoch+1}: Loss={total_loss/len(X):.4f}, Acc={acc:.1%}")

        # Restore best weights
        if best_weights:
            self.W1, self.b1, self.W2, self.b2 = best_weights
            print(f"Restored best weights (acc={best_acc:.1%})")

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
        """Export INT8 weights for on-chain use."""
        os.makedirs(output_dir, exist_ok=True)

        def quantize(w):
            scale = 127 / max(abs(w.min()), abs(w.max()))
            return np.clip(np.round(w * scale), -128, 127).astype(np.int8)

        W1_q = quantize(self.W1.flatten())
        b1_q = quantize(self.b1)
        W2_q = quantize(self.W2.flatten())
        b2_q = quantize(self.b2)

        with open(os.path.join(output_dir, 'wavelet_encoder.bin'), 'wb') as f:
            f.write(bytes([int(x) & 0xFF for x in W1_q]))
            f.write(bytes([int(x) & 0xFF for x in b1_q]))

        with open(os.path.join(output_dir, 'wavelet_decoder.bin'), 'wb') as f:
            f.write(bytes([int(x) & 0xFF for x in W2_q]))
            f.write(bytes([int(x) & 0xFF for x in b2_q]))

        print(f"\nExported weights to {output_dir}")
        print(f"Encoder: {len(W1_q) + len(b1_q)} bytes")
        print(f"Decoder: {len(W2_q) + len(b2_q)} bytes")


def main():
    print("=" * 60)
    print("Binary Price Predictor with Wavelet/EMA Denoising")
    print("Based on xLSTM-TS (arXiv:2408.12408)")
    print("=" * 60)

    data_path = os.path.join(os.path.dirname(__file__), '../../data/sol_market_data.csv')

    # Test different denoising methods
    methods = ['none', 'ma', 'ema']
    results = {}

    for method in methods:
        print(f"\n{'='*40}")
        print(f"Testing with denoising: {method.upper()}")
        print('='*40)

        try:
            X, y, original, denoised = load_and_denoise_data(data_path, denoise_method=method)
        except Exception as e:
            print(f"Error: {e}")
            continue

        print(f"Loaded {len(X)} binary samples")
        print(f"UP: {np.sum(y==1)}, DOWN: {np.sum(y==0)}")

        # Check denoising effect
        if method != 'none':
            noise_reduction = np.std(original - denoised) / np.std(original) * 100
            print(f"Noise reduction: {noise_reduction:.1f}%")

        # Split data
        n = len(X)
        indices = np.random.permutation(n)
        X, y = X[indices], y[indices]

        train_end = int(n * 0.8)
        X_train, y_train = X[:train_end], y[:train_end]
        X_test, y_test = X[train_end:], y[train_end:]

        # Train
        model = BinaryNN(input_size=6, hidden_size=8)
        model.train(X_train, y_train, epochs=300, lr=0.01, l2_reg=0.001)

        # Evaluate
        train_preds = model.predict(X_train)
        test_preds = model.predict(X_test)

        train_acc = np.mean(train_preds == y_train)
        test_acc = np.mean(test_preds == y_test)

        results[method] = {
            'train_acc': train_acc,
            'test_acc': test_acc
        }

        print(f"\nTrain Accuracy: {train_acc:.1%}")
        print(f"Test Accuracy: {test_acc:.1%}")

        # Confusion matrix
        tp = np.sum((test_preds == 1) & (y_test == 1))
        tn = np.sum((test_preds == 0) & (y_test == 0))
        fp = np.sum((test_preds == 1) & (y_test == 0))
        fn = np.sum((test_preds == 0) & (y_test == 1))

        precision = tp / (tp + fp) if (tp + fp) > 0 else 0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0

        print(f"Precision (UP): {precision:.1%}")
        print(f"Recall (UP): {recall:.1%}")

    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)

    for method, res in results.items():
        print(f"{method.upper():10s}: Train={res['train_acc']:.1%}, Test={res['test_acc']:.1%}")

    # Find best method
    if results:
        best = max(results.items(), key=lambda x: x[1]['test_acc'])
        print(f"\nBest method: {best[0].upper()} with {best[1]['test_acc']:.1%} test accuracy")

        # Train final model with best method
        print(f"\n{'='*60}")
        print(f"Training final model with {best[0].upper()} denoising...")
        print('='*60)

        X, y, _, _ = load_and_denoise_data(data_path, denoise_method=best[0])
        n = len(X)
        indices = np.random.permutation(n)
        X, y = X[indices], y[indices]

        train_end = int(n * 0.8)
        X_train, y_train = X[:train_end], y[:train_end]

        final_model = BinaryNN(input_size=6, hidden_size=8)
        final_model.train(X_train, y_train, epochs=500, lr=0.01, l2_reg=0.0005)

        # Export weights
        weights_dir = os.path.join(os.path.dirname(__file__), '../../weights')
        final_model.export_weights(weights_dir)

    print("\n" + "=" * 60)
    print("DONE")
    print("=" * 60)


if __name__ == '__main__':
    main()
