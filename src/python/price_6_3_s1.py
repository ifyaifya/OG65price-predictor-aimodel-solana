# Price Predictor 6→3→2 - Stage 1 (Encoder)
#
# Computes hidden layer from 6 features and stores to scratch account.
#
# Accounts:
#   /sol/1 = Feature accumulator V2 (read)
#   /sol/2 = Scratch account (write) - stores hidden layer values
#
# Input features (from accumulator):
#   I0 = price_vs_sma, I1 = momentum, I2 = volatility
#   I3 = liquidity, I4 = pyth_dex_spread, I5 = trend

# Read accumulator
f=open("/sol/1","rb")
a=list(f.read())
f.close()

# Extract prices
p0=a[0]|a[1]<<8|a[2]<<16|a[3]<<24
p1=a[4]|a[5]<<8|a[6]<<16|a[7]<<24
p2=a[8]|a[9]<<8|a[10]<<16|a[11]<<24
sma=a[16]|a[17]<<8|a[18]<<16|a[19]<<24

# Feature 0: Price vs SMA
if sma>0:
    I0=128+(p0-sma)*100//sma
    if I0<0:I0=0
    if I0>255:I0=255
else:
    I0=128

# Features 1-4: Direct from accumulator
I1=a[21]  # momentum
I2=a[20]  # volatility
I3=a[22]  # liquidity
I4=a[23]  # spread

# Feature 5: Trend
up=0
if p0>p1:up=up+1
if p1>p2:up=up+1
I5=85*up

# Encoder weights (21 INT8 params)
W=[10,-5,2,-8,15,-3,-12,8,-1,5,-10,6,3,-7,12,-2,8,-9,50,60,45]

# Hidden layer
h0=W[18]+I0*W[0]+I1*W[1]+I2*W[2]+I3*W[3]+I4*W[4]+I5*W[5]
h1=W[19]+I0*W[6]+I1*W[7]+I2*W[8]+I3*W[9]+I4*W[10]+I5*W[11]
h2=W[20]+I0*W[12]+I1*W[13]+I2*W[14]+I3*W[15]+I4*W[16]+I5*W[17]

# ReLU
if h0<0:h0=0
if h1<0:h1=0
if h2<0:h2=0

# Clamp to u16 range
if h0>65535:h0=65535
if h1>65535:h1=65535
if h2>65535:h2=65535

# Write to scratch (6 bytes: 3 x u16)
s=[h0&255,(h0>>8)&255,h1&255,(h1>>8)&255,h2&255,(h2>>8)&255]
g=open("/sol/2","wb")
g.write(bytes(s))
g.close()

# Return h0 for verification
h0
