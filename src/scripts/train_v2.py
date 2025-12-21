#!/usr/bin/env python3
"""
Price Predictor Training Pipeline v2
Improved training with better optimizer, regularization, and validation.

Features:
- Adam optimizer with momentum
- L2 regularization
- Early stopping
- Cross-validation
- Comprehensive metrics (accuracy, precision, recall, F1)
- Export INT8 weights for on-chain deployment

Usage:
    python train_v2.py [--data data/sol_market_data.csv] [--epochs 200] [--output weights/]
"""

import numpy as np
import argparse
import os
import struct
from collections import Counter

# ============================================================================
# Data Loading
# ============================================================================

def load_real_data(filepath):
    """Load market data from CSV file."""
    if not os.path.exists(filepath):
        print(f"Warning: {filepath} not found. Using synthetic data.")
        return generate_synthetic_data(10000)

    print(f"Loading data from {filepath}...")
    X, y = [], []

    with open(filepath, 'r') as f:
        header = f.readline()  # Skip header
        for line in f:
            parts = line.strip().split(',')
            if len(parts) >= 9:
                try:
                    # Features: vwap_ratio, volume_accel, orderbook_imbal, volatility, liquidity, momentum
                    features = [float(parts[i]) / 255.0 for i in range(2, 8)]  # Normalize 0-255 to 0-1
                    direction = int(parts[8])
                    X.append(features)
                    y.append(direction)
                except (ValueError, IndexError):
                    continue

    if len(X) < 100:
        print(f"Warning: Only {len(X)} samples found. Using synthetic data.")
        return generate_synthetic_data(10000, n_features=4)

    X = np.array(X)
    y = np.array(y)
    print(f"Loaded {len(X)} samples")
    return X, y


def generate_synthetic_data(n_samples=10000, n_features=4):
    """Generate synthetic market data for training."""
    np.random.seed(42)
    X, y = [], []

    for _ in range(n_samples):
        trend = np.random.uniform(-1, 1)
        noise = np.random.uniform(0, 0.3)

        # Features (normalized 0-1)
        vwap_ratio = 0.5 + trend * 0.2 + np.random.uniform(-0.1, 0.1)
        volume_accel = 0.5 + abs(trend) * 0.3 + np.random.uniform(-0.1, 0.1)
        orderbook_imbal = 0.5 + trend * 0.3 + np.random.uniform(-0.1, 0.1)
        momentum = 0.5 + trend * 0.4 + np.random.uniform(-0.1, 0.1)

        if n_features == 4:
            features = np.clip([vwap_ratio, volume_accel, orderbook_imbal, momentum], 0, 1)
        else:
            volatility = noise + np.random.uniform(0, 0.2)
            liquidity = 0.5 + np.random.uniform(-0.3, 0.3)
            features = np.clip([vwap_ratio, volume_accel, orderbook_imbal,
                               volatility, liquidity, momentum], 0, 1)
        X.append(features)

        # Label
        if trend > 0.2:
            label = 1
        elif trend < -0.2:
            label = -1
        else:
            label = 0

        # Add noise to labels
        if np.random.random() < 0.15:
            label = np.random.choice([-1, 0, 1])

        y.append(label)

    return np.array(X), np.array(y)


def balance_classes(X, y):
    """Upsample minority classes to balance the dataset."""
    counts = Counter(y)
    max_count = max(counts.values())

    X_balanced, y_balanced = [], []

    for label in counts:
        indices = np.where(y == label)[0]
        n_samples = len(indices)
        n_upsample = max_count - n_samples

        # Add original samples
        X_balanced.extend(X[indices])
        y_balanced.extend(y[indices])

        # Upsample with noise
        if n_upsample > 0:
            upsample_indices = np.random.choice(indices, n_upsample, replace=True)
            for idx in upsample_indices:
                # Add small noise to upsampled features
                noisy_features = X[idx] + np.random.normal(0, 0.02, X[idx].shape)
                noisy_features = np.clip(noisy_features, 0, 1)
                X_balanced.append(noisy_features)
                y_balanced.append(y[idx])

    # Shuffle
    indices = np.random.permutation(len(X_balanced))
    return np.array(X_balanced)[indices], np.array(y_balanced)[indices]


# ============================================================================
# Neural Network
# ============================================================================

def relu(x):
    return np.maximum(0, x)


def relu_derivative(x):
    return (x > 0).astype(float)


class AdamOptimizer:
    """Adam optimizer with momentum and adaptive learning rates."""

    def __init__(self, lr=0.001, beta1=0.9, beta2=0.999, epsilon=1e-8):
        self.lr = lr
        self.beta1 = beta1
        self.beta2 = beta2
        self.epsilon = epsilon
        self.t = 0
        self.m = {}
        self.v = {}

    def update(self, name, param, grad):
        if name not in self.m:
            self.m[name] = np.zeros_like(param)
            self.v[name] = np.zeros_like(param)

        self.t += 1

        # Update biased first moment
        self.m[name] = self.beta1 * self.m[name] + (1 - self.beta1) * grad
        # Update biased second moment
        self.v[name] = self.beta2 * self.v[name] + (1 - self.beta2) * (grad ** 2)

        # Bias correction
        m_hat = self.m[name] / (1 - self.beta1 ** self.t)
        v_hat = self.v[name] / (1 - self.beta2 ** self.t)

        # Update parameter
        return param - self.lr * m_hat / (np.sqrt(v_hat) + self.epsilon)


class NeuralNetwork:
    """Simple feedforward neural network with configurable architecture."""

    def __init__(self, input_size=4, hidden_size=3, output_size=2, l2_reg=0.001):
        self.input_size = input_size
        self.hidden_size = hidden_size
        self.output_size = output_size
        self.l2_reg = l2_reg

        # Initialize weights (Xavier initialization)
        np.random.seed(123)
        self.W1 = np.random.randn(input_size, hidden_size) * np.sqrt(2.0 / input_size)
        self.b1 = np.zeros(hidden_size)
        self.W2 = np.random.randn(hidden_size, output_size) * np.sqrt(2.0 / hidden_size)
        self.b2 = np.zeros(output_size)

        self.optimizer = AdamOptimizer(lr=0.001)

    def forward(self, x):
        """Forward pass."""
        self.z1 = np.dot(x, self.W1) + self.b1
        self.a1 = relu(self.z1)
        self.z2 = np.dot(self.a1, self.W2) + self.b2
        return self.z2

    def backward(self, x, y_true, y_pred):
        """Backward pass with L2 regularization."""
        batch_size = x.shape[0] if len(x.shape) > 1 else 1

        # Output layer gradients
        d_z2 = 2 * (y_pred - y_true) / batch_size
        d_W2 = np.outer(self.a1, d_z2) + self.l2_reg * self.W2
        d_b2 = d_z2

        # Hidden layer gradients
        d_a1 = np.dot(d_z2, self.W2.T)
        d_z1 = d_a1 * relu_derivative(self.z1)
        d_W1 = np.outer(x, d_z1) + self.l2_reg * self.W1
        d_b1 = d_z1

        return d_W1, d_b1, d_W2, d_b2

    def train_step(self, x, y_true):
        """Single training step."""
        y_pred = self.forward(x)
        loss = np.mean((y_pred - y_true) ** 2)
        loss += 0.5 * self.l2_reg * (np.sum(self.W1**2) + np.sum(self.W2**2))

        d_W1, d_b1, d_W2, d_b2 = self.backward(x, y_true, y_pred)

        self.W1 = self.optimizer.update('W1', self.W1, d_W1)
        self.b1 = self.optimizer.update('b1', self.b1, d_b1)
        self.W2 = self.optimizer.update('W2', self.W2, d_W2)
        self.b2 = self.optimizer.update('b2', self.b2, d_b2)

        return loss

    def predict(self, X):
        """Predict direction for batch of samples."""
        predictions = []
        for x in X:
            out = self.forward(x * 255 - 128)  # Scale to INT8-like range
            # Softmax-like: pick the class with strongest output
            direction = 1 if out[0] > 10 else (-1 if out[0] < -10 else 0)
            predictions.append(direction)
        return np.array(predictions)

    def predict_binary(self, X):
        """Predict binary direction (up/down) for batch of samples."""
        predictions = []
        for x in X:
            out = self.forward(x * 255 - 128)
            direction = 1 if out[0] > 0 else -1
            predictions.append(direction)
        return np.array(predictions)


# ============================================================================
# Training
# ============================================================================

def train_network(X_train, y_train, X_val, y_val, hidden_size=3, epochs=200, patience=20):
    """Train network with early stopping."""
    input_size = X_train.shape[1]
    output_size = 2

    # Convert labels to targets
    def labels_to_targets(y):
        targets = np.zeros((len(y), 2))
        for i, label in enumerate(y):
            targets[i, 0] = label * 50  # Direction score
            targets[i, 1] = 128  # Base confidence
        return targets

    model = NeuralNetwork(input_size, hidden_size, output_size)

    best_val_acc = 0
    best_weights = None
    patience_counter = 0

    train_targets = labels_to_targets(y_train)
    val_targets = labels_to_targets(y_val)

    print(f"\nTraining {input_size}→{hidden_size}→{output_size} network...")
    print(f"Train samples: {len(X_train)}, Val samples: {len(X_val)}")
    print(f"Patience: {patience}, L2 reg: {model.l2_reg}")
    print("-" * 60)

    for epoch in range(epochs):
        # Training
        total_loss = 0
        indices = np.random.permutation(len(X_train))

        for i in indices:
            x = X_train[i] * 255 - 128  # Scale to INT8-like range
            loss = model.train_step(x, train_targets[i])
            total_loss += loss

        avg_loss = total_loss / len(X_train)

        # Validation
        val_preds = model.predict(X_val)
        val_acc = np.mean(val_preds == y_val)

        # Early stopping check
        if val_acc > best_val_acc:
            best_val_acc = val_acc
            best_weights = (model.W1.copy(), model.b1.copy(),
                          model.W2.copy(), model.b2.copy())
            patience_counter = 0
        else:
            patience_counter += 1

        if (epoch + 1) % 10 == 0:
            train_preds = model.predict(X_train)
            train_acc = np.mean(train_preds == y_train)
            print(f"Epoch {epoch+1:3d}: Loss={avg_loss:.4f}, Train Acc={train_acc:.1%}, Val Acc={val_acc:.1%}")

        if patience_counter >= patience:
            print(f"\nEarly stopping at epoch {epoch+1}")
            break

    # Restore best weights
    if best_weights:
        model.W1, model.b1, model.W2, model.b2 = best_weights

    return model


# ============================================================================
# Evaluation
# ============================================================================

def evaluate_model(model, X, y, name="Test"):
    """Comprehensive model evaluation."""
    preds = model.predict(X)

    # Accuracy
    accuracy = np.mean(preds == y)

    # Per-class metrics
    classes = [-1, 0, 1]
    metrics = {}

    for c in classes:
        tp = np.sum((preds == c) & (y == c))
        fp = np.sum((preds == c) & (y != c))
        fn = np.sum((preds != c) & (y == c))

        precision = tp / (tp + fp) if (tp + fp) > 0 else 0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

        metrics[c] = {'precision': precision, 'recall': recall, 'f1': f1}

    # Confusion matrix
    confusion = np.zeros((3, 3), dtype=int)
    for i, true_label in enumerate(y):
        pred_label = preds[i]
        true_idx = classes.index(true_label)
        pred_idx = classes.index(pred_label)
        confusion[true_idx, pred_idx] += 1

    print(f"\n{name} Evaluation:")
    print("-" * 40)
    print(f"Accuracy: {accuracy:.1%}")
    print(f"\nPer-class metrics:")
    for c in classes:
        label = {-1: "Bearish", 0: "Neutral", 1: "Bullish"}[c]
        m = metrics[c]
        print(f"  {label:8s}: P={m['precision']:.2f}, R={m['recall']:.2f}, F1={m['f1']:.2f}")

    print(f"\nConfusion Matrix:")
    print(f"              Pred: Bear  Neut  Bull")
    for i, c in enumerate(classes):
        label = {-1: "Bearish", 0: "Neutral", 1: "Bullish"}[c]
        print(f"  True {label:8s}: {confusion[i, 0]:4d}  {confusion[i, 1]:4d}  {confusion[i, 2]:4d}")

    return accuracy, metrics


def cross_validate(X, y, n_folds=5, hidden_size=3, epochs=100):
    """K-fold cross-validation."""
    print(f"\n{n_folds}-Fold Cross Validation")
    print("=" * 40)

    fold_size = len(X) // n_folds
    accuracies = []

    for fold in range(n_folds):
        # Split
        val_start = fold * fold_size
        val_end = val_start + fold_size

        X_val = X[val_start:val_end]
        y_val = y[val_start:val_end]
        X_train = np.concatenate([X[:val_start], X[val_end:]])
        y_train = np.concatenate([y[:val_start], y[val_end:]])

        # Balance training data
        X_train, y_train = balance_classes(X_train, y_train)

        # Train
        model = train_network(X_train, y_train, X_val, y_val,
                            hidden_size=hidden_size, epochs=epochs, patience=10)

        # Evaluate
        val_preds = model.predict(X_val)
        acc = np.mean(val_preds == y_val)
        accuracies.append(acc)
        print(f"Fold {fold+1}: {acc:.1%}")

    print(f"\nMean CV Accuracy: {np.mean(accuracies):.1%} ± {np.std(accuracies):.1%}")
    return np.mean(accuracies)


# ============================================================================
# Weight Export
# ============================================================================

def quantize_to_int8(weights):
    """Quantize float weights to INT8 (-128 to 127)."""
    max_val = max(abs(weights.min()), abs(weights.max()))
    scale = 127 / max_val if max_val > 0 else 1
    quantized = np.clip(np.round(weights * scale), -128, 127).astype(np.int8)
    return quantized


def export_weights(model, output_dir):
    """Export weights to binary files for Solana deployment."""
    os.makedirs(output_dir, exist_ok=True)

    # Architecture: 4→3→2 or 6→3→2
    # Encoder weights layout (19 bytes for 4→3, or larger for 6→3):
    # - W1 weights (input_size x hidden_size)
    # - b1 biases (hidden_size)
    # - Reserved for input features

    W1_q = quantize_to_int8(model.W1.flatten())
    b1_q = quantize_to_int8(model.b1)
    W2_q = quantize_to_int8(model.W2.flatten())
    b2_q = quantize_to_int8(model.b2)

    # Calculate sizes
    w1_size = len(W1_q)
    b1_size = len(b1_q)
    input_size = model.input_size
    encoder_size = w1_size + b1_size + input_size

    w2_size = len(W2_q)
    b2_size = len(b2_q)
    decoder_size = w2_size + b2_size

    # Encoder
    encoder = bytearray(encoder_size)
    for i, w in enumerate(W1_q):
        encoder[i] = int(w) & 0xFF
    for i, b in enumerate(b1_q):
        encoder[w1_size + i] = int(b) & 0xFF
    # Remaining bytes reserved for inputs

    # Decoder
    decoder = bytearray(decoder_size)
    for i, w in enumerate(W2_q):
        decoder[i] = int(w) & 0xFF
    for i, b in enumerate(b2_q):
        decoder[w2_size + i] = int(b) & 0xFF

    # Save with architecture in filename
    arch = f"{model.input_size}_{model.hidden_size}"
    enc_path = os.path.join(output_dir, f'encoder_{arch}.bin')
    dec_path = os.path.join(output_dir, f'decoder_{arch}.bin')

    with open(enc_path, 'wb') as f:
        f.write(encoder)
    with open(dec_path, 'wb') as f:
        f.write(decoder)

    print(f"\nExported weights:")
    print(f"  Encoder: {enc_path} ({len(encoder)} bytes)")
    print(f"  Decoder: {dec_path} ({len(decoder)} bytes)")

    # Also save as readable text for debugging
    debug_path = os.path.join(output_dir, 'weights_debug.txt')
    with open(debug_path, 'w') as f:
        f.write("W1 (4x3):\n")
        f.write(str(model.W1) + "\n\n")
        f.write("b1 (3):\n")
        f.write(str(model.b1) + "\n\n")
        f.write("W2 (3x2):\n")
        f.write(str(model.W2) + "\n\n")
        f.write("b2 (2):\n")
        f.write(str(model.b2) + "\n\n")
        f.write("W1 quantized:\n")
        f.write(str(W1_q.tolist()) + "\n\n")
        f.write("b1 quantized:\n")
        f.write(str(b1_q.tolist()) + "\n\n")
        f.write("W2 quantized:\n")
        f.write(str(W2_q.tolist()) + "\n\n")
        f.write("b2 quantized:\n")
        f.write(str(b2_q.tolist()) + "\n")

    print(f"  Debug: {debug_path}")

    return encoder, decoder


# ============================================================================
# Main
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description='Train Price Predictor v2')
    parser.add_argument('--data', type=str, default='data/sol_market_data.csv',
                       help='Path to training data CSV')
    parser.add_argument('--epochs', type=int, default=200, help='Training epochs')
    parser.add_argument('--hidden', type=int, default=3, help='Hidden layer size')
    parser.add_argument('--output', type=str, default='weights/', help='Output directory')
    parser.add_argument('--cv', action='store_true', help='Run cross-validation')
    args = parser.parse_args()

    print("=" * 60)
    print("Price Predictor Training Pipeline v2")
    print("=" * 60)

    # Load data
    data_path = os.path.join(os.path.dirname(__file__), '..', '..', args.data)
    X, y = load_real_data(data_path)

    print(f"\nData shape: {X.shape}")
    print(f"Class distribution: up={np.sum(y==1)}, neutral={np.sum(y==0)}, down={np.sum(y==-1)}")

    # Split: 60% train, 20% val, 20% test
    n = len(X)
    indices = np.random.permutation(n)
    X, y = X[indices], y[indices]

    train_end = int(n * 0.6)
    val_end = int(n * 0.8)

    X_train, y_train = X[:train_end], y[:train_end]
    X_val, y_val = X[train_end:val_end], y[train_end:val_end]
    X_test, y_test = X[val_end:], y[val_end:]

    print(f"Train: {len(X_train)}, Val: {len(X_val)}, Test: {len(X_test)}")

    # Cross-validation (optional)
    if args.cv:
        cv_acc = cross_validate(X, y, n_folds=5, hidden_size=args.hidden, epochs=50)

    # Balance training data
    X_train_balanced, y_train_balanced = balance_classes(X_train, y_train)
    print(f"After balancing: {len(X_train_balanced)} samples")

    # Train
    model = train_network(X_train_balanced, y_train_balanced, X_val, y_val,
                         hidden_size=args.hidden, epochs=args.epochs, patience=20)

    # Evaluate
    train_acc, _ = evaluate_model(model, X_train, y_train, "Train")
    val_acc, _ = evaluate_model(model, X_val, y_val, "Validation")
    test_acc, _ = evaluate_model(model, X_test, y_test, "Test")

    # Export weights
    output_dir = os.path.join(os.path.dirname(__file__), '..', '..', args.output)
    export_weights(model, output_dir)

    print("\n" + "=" * 60)
    print("TRAINING COMPLETE")
    print("=" * 60)
    print(f"Final Test Accuracy: {test_acc:.1%}")
    print(f"Weights saved to: {output_dir}")
    print("=" * 60)


if __name__ == '__main__':
    main()
