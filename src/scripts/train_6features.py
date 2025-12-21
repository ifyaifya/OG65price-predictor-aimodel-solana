#!/usr/bin/env python3
"""
Train 6→3→2 Neural Network for Price Prediction
Uses data from Pyth Oracle + Raydium DEX
"""

import csv
import random
import math
import os

# Configuration
DATA_FILE = "data/pyth_raydium_data.csv"
WEIGHTS_FILE = "weights/nn6_weights.txt"

# Network architecture
INPUT_SIZE = 6
HIDDEN_SIZE = 3
OUTPUT_SIZE = 2

# Training parameters
LEARNING_RATE = 0.001
EPOCHS = 100
BATCH_SIZE = 32

def load_data(filepath):
    """Load and preprocess training data"""
    X, y = [], []

    with open(filepath, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                features = [
                    int(row['price_vs_sma']),
                    int(row['momentum']),
                    int(row['volatility']),
                    int(row['liquidity']),
                    int(row['spread']),
                    int(row['trend']),
                ]
                label = int(row['label'])
                X.append(features)
                y.append(label)
            except (KeyError, ValueError) as e:
                continue

    return X, y

def normalize_features(X):
    """Normalize to 0-1 range"""
    return [[x / 255.0 for x in sample] for sample in X]

def init_weights():
    """Initialize weights with Xavier initialization"""
    def xavier(fan_in, fan_out):
        limit = math.sqrt(6.0 / (fan_in + fan_out))
        return [[random.uniform(-limit, limit) for _ in range(fan_in)] for _ in range(fan_out)]

    def zeros(n):
        return [0.0] * n

    W1 = xavier(INPUT_SIZE, HIDDEN_SIZE)  # 6x3
    b1 = zeros(HIDDEN_SIZE)
    W2 = xavier(HIDDEN_SIZE, OUTPUT_SIZE)  # 3x2
    b2 = zeros(OUTPUT_SIZE)

    return W1, b1, W2, b2

def relu(x):
    return max(0, x)

def relu_derivative(x):
    return 1.0 if x > 0 else 0.0

def forward(x, W1, b1, W2, b2):
    """Forward pass"""
    # Hidden layer
    h = []
    h_pre = []  # Pre-activation for backprop
    for j in range(HIDDEN_SIZE):
        z = b1[j]
        for i in range(INPUT_SIZE):
            z += x[i] * W1[j][i]
        h_pre.append(z)
        h.append(relu(z))

    # Output layer (no activation for regression-like output)
    o = []
    for k in range(OUTPUT_SIZE):
        z = b2[k]
        for j in range(HIDDEN_SIZE):
            z += h[j] * W2[k][j]
        o.append(z)

    return h, h_pre, o

def train(X, y, epochs=EPOCHS):
    """Train the network"""
    W1, b1, W2, b2 = init_weights()

    # Convert labels: -1 → [1,0], 0 → [0.5,0.5], 1 → [0,1]
    def label_to_target(label):
        if label == -1: return [-1.0, 0.0]
        if label == 1: return [1.0, 0.0]
        return [0.0, 0.0]

    n_samples = len(X)

    for epoch in range(epochs):
        total_loss = 0.0
        correct = 0

        # Shuffle data
        indices = list(range(n_samples))
        random.shuffle(indices)

        for idx in indices:
            x = X[idx]
            target = label_to_target(y[idx])

            # Forward pass
            h, h_pre, o = forward(x, W1, b1, W2, b2)

            # Loss (MSE)
            loss = sum((o[k] - target[k])**2 for k in range(OUTPUT_SIZE)) / OUTPUT_SIZE
            total_loss += loss

            # Accuracy
            pred = 1 if o[0] > 0.5 else (-1 if o[0] < -0.5 else 0)
            if pred == y[idx]:
                correct += 1

            # Backpropagation
            # Output layer gradients
            do = [(o[k] - target[k]) * 2 / OUTPUT_SIZE for k in range(OUTPUT_SIZE)]

            # Hidden layer gradients
            dh = [0.0] * HIDDEN_SIZE
            for j in range(HIDDEN_SIZE):
                for k in range(OUTPUT_SIZE):
                    dh[j] += do[k] * W2[k][j]
                dh[j] *= relu_derivative(h_pre[j])

            # Update W2, b2
            for k in range(OUTPUT_SIZE):
                for j in range(HIDDEN_SIZE):
                    W2[k][j] -= LEARNING_RATE * do[k] * h[j]
                b2[k] -= LEARNING_RATE * do[k]

            # Update W1, b1
            for j in range(HIDDEN_SIZE):
                for i in range(INPUT_SIZE):
                    W1[j][i] -= LEARNING_RATE * dh[j] * x[i]
                b1[j] -= LEARNING_RATE * dh[j]

        accuracy = correct / n_samples * 100
        avg_loss = total_loss / n_samples

        if epoch % 10 == 0 or epoch == epochs - 1:
            print(f"Epoch {epoch:3d}: Loss={avg_loss:.4f}, Accuracy={accuracy:.1f}%")

    return W1, b1, W2, b2

def quantize_weights(W1, b1, W2, b2):
    """Quantize to INT8 (-128 to 127)"""
    def to_int8(w, scale=50):
        v = int(round(w * scale))
        return max(-128, min(127, v))

    # Flatten for export
    # W1: 6x3 → 18 weights + 3 biases = 21
    # W2: 3x2 → 6 weights + 2 biases = 8

    encoder_weights = []
    for j in range(HIDDEN_SIZE):
        for i in range(INPUT_SIZE):
            encoder_weights.append(to_int8(W1[j][i]))
    for j in range(HIDDEN_SIZE):
        encoder_weights.append(to_int8(b1[j]))

    decoder_weights = []
    for k in range(OUTPUT_SIZE):
        for j in range(HIDDEN_SIZE):
            decoder_weights.append(to_int8(W2[k][j]))
    for k in range(OUTPUT_SIZE):
        decoder_weights.append(to_int8(b2[k]))

    return encoder_weights, decoder_weights

def export_weights(encoder_weights, decoder_weights, filepath):
    """Export weights for Python scripts"""
    os.makedirs(os.path.dirname(filepath), exist_ok=True)

    with open(filepath, 'w') as f:
        f.write("# Trained weights for 6→3→2 NN\n")
        f.write(f"# Encoder: {len(encoder_weights)} params\n")
        f.write(f"# Decoder: {len(decoder_weights)} params\n\n")

        f.write("ENCODER_WEIGHTS = [\n")
        f.write(f"    {encoder_weights}\n")
        f.write("]\n\n")

        f.write("DECODER_WEIGHTS = [\n")
        f.write(f"    {decoder_weights}\n")
        f.write("]\n\n")

        # Python array format for scripts
        f.write("# For nn6_h0h1.py:\n")
        f.write(f"W=[{','.join(map(str, encoder_weights[:14]))}]\n\n")

        f.write("# For nn6_h2.py:\n")
        w_h2 = encoder_weights[12:18] + [encoder_weights[20]]
        f.write(f"W=[{','.join(map(str, w_h2))}]\n\n")

        f.write("# For price_6_3_s2.py (decoder):\n")
        f.write(f"D=[{','.join(map(str, decoder_weights))}]\n")

    print(f"\nWeights exported to {filepath}")
    print(f"Encoder: {encoder_weights}")
    print(f"Decoder: {decoder_weights}")

def main():
    print("="*60)
    print("Training 6→3→2 Neural Network")
    print("="*60)

    # Check for data file
    if not os.path.exists(DATA_FILE):
        print(f"\nNo data file found at {DATA_FILE}")
        print("Run collect_pyth_raydium.js first to collect training data")
        print("\nGenerating synthetic data for demo...")
        generate_synthetic_data()

    # Load data
    print(f"\nLoading data from {DATA_FILE}...")
    X, y = load_data(DATA_FILE)
    print(f"Loaded {len(X)} samples")

    if len(X) < 100:
        print("Warning: Very few samples, results may not be reliable")

    # Normalize
    X_norm = normalize_features(X)

    # Class distribution
    from collections import Counter
    dist = Counter(y)
    print(f"Class distribution: {dict(dist)}")

    # Train
    print(f"\nTraining for {EPOCHS} epochs...")
    W1, b1, W2, b2 = train(X_norm, y, EPOCHS)

    # Quantize
    print("\nQuantizing to INT8...")
    encoder_weights, decoder_weights = quantize_weights(W1, b1, W2, b2)

    # Export
    export_weights(encoder_weights, decoder_weights, WEIGHTS_FILE)

    print("\n" + "="*60)
    print("Training complete!")
    print("="*60)

def generate_synthetic_data():
    """Generate synthetic data for testing"""
    os.makedirs("data", exist_ok=True)

    with open(DATA_FILE, 'w') as f:
        f.write("timestamp,pyth_price,dex_price,price_vs_sma,momentum,volatility,liquidity,spread,trend,label\n")

        for i in range(1000):
            # Random features
            price_vs_sma = random.randint(100, 156)
            momentum = random.randint(100, 156)
            volatility = random.randint(0, 50)
            liquidity = random.randint(40, 50)
            spread = random.randint(120, 136)
            trend = random.choice([0, 85, 170])

            # Simple rule for label (for testing)
            score = (price_vs_sma - 128) + (momentum - 128) + (trend - 85) / 2
            if score > 10:
                label = 1
            elif score < -10:
                label = -1
            else:
                label = 0

            f.write(f"{i},120.0,120.5,{price_vs_sma},{momentum},{volatility},{liquidity},{spread},{trend},{label}\n")

    print(f"Generated synthetic data: {DATA_FILE}")

if __name__ == "__main__":
    main()
