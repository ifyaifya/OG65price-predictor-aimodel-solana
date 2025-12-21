# Price Predictor with 6 Features - Neural Network 6→3→2
#
# Reads features from accumulator V2 and runs prediction.
#
# Accounts:
#   /sol/1 = Feature accumulator V2 (read)
#
# Accumulator V2 layout (48 bytes):
#   [0-3]:   last_price (u32)
#   [4-7]:   prev_price_1 (u32)
#   [8-11]:  prev_price_2 (u32)
#   [12-15]: prev_price_3 (u32)
#   [16-19]: sma_4 (u32)
#   [20]:    volatility (u8, 0-255)
#   [21]:    momentum (u8, 0-255, 128=neutral)
#   [22]:    liquidity (u8, 0-255)
#   [23]:    pyth_dex_spread (u8, 0-255, 128=no spread)
#   [24-27]: dex_price (u32)
#
# 6 Features extracted:
#   I0 = price_vs_sma (0-255): current price relative to SMA
#   I1 = momentum (0-255): from accumulator
#   I2 = volatility (0-255): from accumulator
#   I3 = liquidity (0-255): from accumulator (NEW)
#   I4 = pyth_dex_spread (0-255): from accumulator (NEW)
#   I5 = trend (0-255): direction of last 3 prices

# Read feature accumulator
f=open("/sol/1","rb")
a=list(f.read())
f.close()

# Extract prices for calculations
p0=a[0]|a[1]<<8|a[2]<<16|a[3]<<24
p1=a[4]|a[5]<<8|a[6]<<16|a[7]<<24
p2=a[8]|a[9]<<8|a[10]<<16|a[11]<<24
sma=a[16]|a[17]<<8|a[18]<<16|a[19]<<24

# === Feature 0: Price vs SMA (128 = at SMA) ===
if sma>0:
    I0=128+(p0-sma)*100//sma
    if I0<0:I0=0
    if I0>255:I0=255
else:
    I0=128

# === Feature 1: Momentum (from accumulator byte 21) ===
I1=a[21]

# === Feature 2: Volatility (from accumulator byte 20) ===
I2=a[20]

# === Feature 3: Liquidity (from accumulator byte 22) ===
I3=a[22]

# === Feature 4: Pyth/DEX Spread (from accumulator byte 23) ===
I4=a[23]

# === Feature 5: Trend (count of up moves in last 3 periods) ===
up=0
if p0>p1:up=up+1
if p1>p2:up=up+1
I5=85*up  # 0, 85, 170 for 0, 1, 2 ups

# === Neural Network 6→3→2 with trained weights ===
# Architecture: 6 inputs, 3 hidden neurons, 2 outputs
# Total params: 6*3 + 3 + 3*2 + 2 = 18 + 3 + 6 + 2 = 29 params
#
# Weights layout (INT8 quantized):
# W[0-5]:   hidden[0] weights (6 inputs)
# W[6-11]:  hidden[1] weights (6 inputs)
# W[12-17]: hidden[2] weights (6 inputs)
# W[18-20]: hidden biases (3)
#
# D[0-2]:   output[0] weights (3 hidden)
# D[3-5]:   output[1] weights (3 hidden)
# D[6-7]:   output biases (2)

# Encoder weights (21 params) - to be trained
W=[10,-5,2,-8,15,-3,  # h0 weights
   -12,8,-1,5,-10,6,   # h1 weights
   3,-7,12,-2,8,-9,    # h2 weights
   50,60,45]           # biases

# Hidden layer computation
h0=W[18]+I0*W[0]+I1*W[1]+I2*W[2]+I3*W[3]+I4*W[4]+I5*W[5]
h1=W[19]+I0*W[6]+I1*W[7]+I2*W[8]+I3*W[9]+I4*W[10]+I5*W[11]
h2=W[20]+I0*W[12]+I1*W[13]+I2*W[14]+I3*W[15]+I4*W[16]+I5*W[17]

# ReLU activation
if h0<0:h0=0
if h1<0:h1=0
if h2<0:h2=0

# Decoder weights (8 params) - to be trained
D=[-5,8,-3,   # o0 weights
   6,-4,10,   # o1 weights
   100,80]    # biases

# Output layer computation
o0=D[6]+h0*D[0]+h1*D[1]+h2*D[2]
o1=D[7]+h0*D[3]+h1*D[4]+h2*D[5]

# Return: direction_score * 1000 + confidence
# direction_score: positive = bullish, negative = bearish
# confidence: magnitude of prediction
o0*1000+o1
