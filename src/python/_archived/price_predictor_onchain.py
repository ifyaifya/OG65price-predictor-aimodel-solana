# Full On-Chain Price Predictor
# Reads features from accumulator account and runs neural network
#
# Accounts:
#   /sol/1 = Feature accumulator (read) - contains pre-calculated features
#
# Accumulator layout (32 bytes):
#   [0-3]:   last_price (u32)
#   [4-7]:   prev_price_1 (u32)
#   [8-11]:  prev_price_2 (u32)
#   [12-15]: prev_price_3 (u32)
#   [16-19]: sma_5 (u32)
#   [20]:    volatility (u8, 0-255)
#   [24]:    momentum (u8, 0-255, 128=neutral)
#
# We extract 4 features for our 4->3->2 neural network:
#   I0 = price_vs_sma (0-255): current price relative to SMA
#   I1 = momentum (0-255): from accumulator
#   I2 = volatility (0-255): from accumulator
#   I3 = trend (0-255): direction of last 3 prices

# Read feature accumulator
f=open("/sol/1","rb")
a=list(f.read())
f.close()

# Extract prices
p0=a[0]|a[1]<<8|a[2]<<16|a[3]<<24
p1=a[4]|a[5]<<8|a[6]<<16|a[7]<<24
p2=a[8]|a[9]<<8|a[10]<<16|a[11]<<24
sma=a[16]|a[17]<<8|a[18]<<16|a[19]<<24

# Feature 0: Price vs SMA (128 = at SMA)
if sma>0:
    I0=128+(p0-sma)*100//sma
    if I0<0:I0=0
    if I0>255:I0=255
else:
    I0=128

# Feature 1: Momentum (already calculated, stored at byte 24)
I1=a[24]

# Feature 2: Volatility (already calculated, stored at byte 20)
I2=a[20]

# Feature 3: Trend (count of up moves in last 3 periods)
up=0
if p0>p1:up=up+1
if p1>p2:up=up+1
I3=85*up  # 0, 85, 170 for 0, 1, 2 ups

# === Neural Network 4->3->2 with trained weights ===
# Weights from training (INT8 quantized)
W=[23,-12,1,-41,-10,0,-127,-12,1,76,-21,1,61,127,123]

# Hidden layer
h0=W[12]+I0*W[0]+I1*W[3]+I2*W[6]+I3*W[9]
h1=W[13]+I0*W[1]+I1*W[4]+I2*W[7]+I3*W[10]
h2=W[14]+I0*W[2]+I1*W[5]+I2*W[8]+I3*W[11]

# ReLU
if h0<0:h0=0
if h1<0:h1=0
if h2<0:h2=0

# Decoder weights
D=[-1,0,-49,6,50,127,-7,127]

# Output layer
o0=D[6]+h0*D[0]+h1*D[2]+h2*D[4]
o1=D[7]+h0*D[1]+h1*D[3]+h2*D[5]

# Return direction score * 1000 + confidence
# Positive = bullish, Negative = bearish, ~0 = neutral
o0*1000+o1
