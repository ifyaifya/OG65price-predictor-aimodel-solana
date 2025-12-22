# Price Predictor 6→3→2 - Stage 2 (Decoder)
#
# Reads hidden layer from scratch and computes final prediction.
#
# Accounts:
#   /sol/1 = Scratch account (read) - hidden layer values from Stage 1
#
# Hidden layer layout (6 bytes):
#   [0-1]: h0 (u16)
#   [2-3]: h1 (u16)
#   [4-5]: h2 (u16)

# Read scratch account
f=open("/sol/1","rb")
s=list(f.read())
f.close()

# Extract hidden values (u16 little-endian)
h0=s[0]|s[1]<<8
h1=s[2]|s[3]<<8
h2=s[4]|s[5]<<8

# Decoder weights (8 INT8 params)
# D[0-2]: output 0 weights, D[3-5]: output 1 weights, D[6-7]: biases
D=[5,125,-35,25,-8,-46,-51,0]

# Output layer
o0=D[6]+h0*D[0]+h1*D[1]+h2*D[2]
o1=D[7]+h0*D[3]+h1*D[4]+h2*D[5]

# Return: direction * 1000 + confidence
# Positive o0 = bullish, Negative o0 = bearish
# o1 = confidence level
o0*1000+o1
