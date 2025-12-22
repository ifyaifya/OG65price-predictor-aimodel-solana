#!/usr/bin/env python3
"""
Price Predictor Training Pipeline
Trains a 6→4→2 neural network and exports INT8 weights for on-chain deployment.

Usage:
    python train.py [--samples 10000] [--output weights.bin]
"""

import numpy as np
import argparse
import struct

def generate_synthetic_data(n_samples=10000):
    """
    Generate synthetic market data for training.
    In production, replace with real market data from Pyth/Jupiter/Birdeye.
    """
    np.random.seed(42)

    X = []
    y = []

    for _ in range(n_samples):
        # Generate random market conditions
        trend = np.random.uniform(-1, 1)  # Underlying trend
        noise = np.random.uniform(0, 0.3)  # Market noise

        # Features (normalized 0-1, will be scaled to 0-255 later)
        vwap_ratio = 0.5 + trend * 0.2 + np.random.uniform(-0.1, 0.1)
        volume_accel = 0.5 + abs(trend) * 0.3 + np.random.uniform(-0.1, 0.1)
        orderbook_imbal = 0.5 + trend * 0.3 + np.random.uniform(-0.1, 0.1)
        volatility = noise + np.random.uniform(0, 0.2)
        liquidity = 0.5 + np.random.uniform(-0.3, 0.3)
        momentum = 0.5 + trend * 0.4 + np.random.uniform(-0.1, 0.1)

        # Clamp to 0-1
        features = np.clip([
            vwap_ratio, volume_accel, orderbook_imbal,
            volatility, liquidity, momentum
        ], 0, 1)

        X.append(features)

        # Label: direction based on trend + some noise
        if trend > 0.2:
            label = 1  # Up
        elif trend < -0.2:
            label = -1  # Down
        else:
            label = 0  # Neutral

        # Add some noise to labels (market is not perfectly predictable)
        if np.random.random() < 0.15:
            label = np.random.choice([-1, 0, 1])

        y.append(label)

    return np.array(X), np.array(y)


def relu(x):
    return np.maximum(0, x)


def train_network(X, y, hidden_size=4, learning_rate=0.01, epochs=100):
    """
    Train a simple 6→4→2 network using gradient descent.
    """
    input_size = 6
    output_size = 2  # direction, confidence

    # Initialize weights (small random values)
    np.random.seed(123)
    W1 = np.random.randn(input_size, hidden_size) * 0.5
    b1 = np.zeros(hidden_size)
    W2 = np.random.randn(hidden_size, output_size) * 0.5
    b2 = np.zeros(output_size)

    # Convert labels to targets
    # direction: -1, 0, 1 → scaled
    # confidence: based on how clear the signal is
    targets = np.zeros((len(y), 2))
    for i, label in enumerate(y):
        targets[i, 0] = label * 50  # Direction score
        targets[i, 1] = 128  # Base confidence

    # Training loop
    for epoch in range(epochs):
        total_loss = 0

        for i in range(len(X)):
            # Forward pass
            x = X[i] * 255 - 128  # Scale to INT8-like range
            h = relu(np.dot(x, W1) + b1)
            out = np.dot(h, W2) + b2

            # Loss (MSE)
            loss = np.mean((out - targets[i]) ** 2)
            total_loss += loss

            # Backward pass (simplified gradient descent)
            d_out = 2 * (out - targets[i]) / 2
            d_W2 = np.outer(h, d_out)
            d_b2 = d_out

            d_h = np.dot(d_out, W2.T)
            d_h[h <= 0] = 0  # ReLU derivative

            d_W1 = np.outer(x, d_h)
            d_b1 = d_h

            # Update weights
            W1 -= learning_rate * d_W1
            b1 -= learning_rate * d_b1
            W2 -= learning_rate * d_W2
            b2 -= learning_rate * d_b2

        if epoch % 10 == 0:
            print(f"Epoch {epoch}: Loss = {total_loss / len(X):.4f}")

    return W1, b1, W2, b2


def quantize_to_int8(weights):
    """
    Quantize float weights to INT8 (-128 to 127).
    """
    # Find scale factor
    max_val = max(abs(weights.min()), abs(weights.max()))
    scale = 127 / max_val if max_val > 0 else 1

    # Quantize
    quantized = np.clip(np.round(weights * scale), -128, 127).astype(np.int8)

    return quantized


def export_weights(W1, b1, W2, b2, output_path):
    """
    Export weights to binary file for Solana deployment.

    Encoder weights layout (34 bytes):
    - Bytes 0-23: W1 (6x4 = 24 weights, column-major for our indexing)
    - Bytes 24-27: b1 (4 biases)
    - Bytes 28-33: Reserved for input features

    Decoder weights layout (10 bytes):
    - Bytes 0-7: W2 (4x2 = 8 weights)
    - Bytes 8-9: b2 (2 biases)
    """
    # Quantize
    W1_q = quantize_to_int8(W1.flatten())
    b1_q = quantize_to_int8(b1)
    W2_q = quantize_to_int8(W2.flatten())
    b2_q = quantize_to_int8(b2)

    # Encoder weights (34 bytes)
    encoder = bytearray(34)
    for i, w in enumerate(W1_q):
        encoder[i] = w & 0xFF
    for i, b in enumerate(b1_q):
        encoder[24 + i] = b & 0xFF
    # Bytes 28-33 reserved for inputs

    # Decoder weights (10 bytes)
    decoder = bytearray(10)
    for i, w in enumerate(W2_q):
        decoder[i] = w & 0xFF
    for i, b in enumerate(b2_q):
        decoder[8 + i] = b & 0xFF

    # Save
    with open(output_path.replace('.bin', '_encoder.bin'), 'wb') as f:
        f.write(encoder)
    with open(output_path.replace('.bin', '_decoder.bin'), 'wb') as f:
        f.write(decoder)

    print(f"\nExported weights:")
    print(f"  Encoder: {output_path.replace('.bin', '_encoder.bin')} (34 bytes)")
    print(f"  Decoder: {output_path.replace('.bin', '_decoder.bin')} (10 bytes)")

    return encoder, decoder


def evaluate_model(X, y, W1, b1, W2, b2):
    """
    Evaluate model accuracy.
    """
    correct = 0

    for i in range(len(X)):
        x = X[i] * 255 - 128
        h = relu(np.dot(x, W1) + b1)
        out = np.dot(h, W2) + b2

        # Predict direction
        pred_dir = 1 if out[0] > 20 else (-1 if out[0] < -20 else 0)

        if pred_dir == y[i]:
            correct += 1

    accuracy = correct / len(X)
    return accuracy


def main():
    parser = argparse.ArgumentParser(description='Train Price Predictor')
    parser.add_argument('--samples', type=int, default=10000, help='Number of training samples')
    parser.add_argument('--epochs', type=int, default=100, help='Training epochs')
    parser.add_argument('--output', type=str, default='weights.bin', help='Output weights file')
    args = parser.parse_args()

    print("=" * 50)
    print("Price Predictor Training Pipeline")
    print("=" * 50)

    # Generate data
    print(f"\nGenerating {args.samples} synthetic samples...")
    X, y = generate_synthetic_data(args.samples)

    # Split train/test
    split = int(len(X) * 0.8)
    X_train, X_test = X[:split], X[split:]
    y_train, y_test = y[:split], y[split:]

    print(f"Training samples: {len(X_train)}")
    print(f"Test samples: {len(X_test)}")
    print(f"Class distribution: up={sum(y==1)}, neutral={sum(y==0)}, down={sum(y==-1)}")

    # Train
    print(f"\nTraining 6→4→2 network for {args.epochs} epochs...")
    W1, b1, W2, b2 = train_network(X_train, y_train, epochs=args.epochs)

    # Evaluate
    train_acc = evaluate_model(X_train, y_train, W1, b1, W2, b2)
    test_acc = evaluate_model(X_test, y_test, W1, b1, W2, b2)

    print(f"\nResults:")
    print(f"  Train accuracy: {train_acc:.1%}")
    print(f"  Test accuracy: {test_acc:.1%}")

    # Export
    export_weights(W1, b1, W2, b2, args.output)

    print("\n" + "=" * 50)
    print("Training complete!")
    print("=" * 50)


if __name__ == '__main__':
    main()
