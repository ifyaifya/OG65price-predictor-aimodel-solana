# Feature Accumulator - Maintains rolling price features on-chain
#
# This script runs periodically (via crank) to:
# 1. Read current price from Pyth account
# 2. Update rolling features in accumulator account
#
# Account layout (accumulator - 32 bytes):
#   [0-3]:   last_price (u32, price in cents)
#   [4-7]:   prev_price_1 (u32, 1 min ago)
#   [8-11]:  prev_price_2 (u32, 2 min ago)
#   [12-15]: prev_price_3 (u32, 3 min ago)
#   [16-19]: sma_5 (u32, 5-period SMA in cents)
#   [20-23]: volatility (u32, scaled 0-255)
#   [24-27]: momentum (u32, scaled 0-255, 128=neutral)
#   [28-31]: reserved
#
# Accounts:
#   /sol/1 = Pyth SOL/USD price account (read)
#   /sol/2 = Feature accumulator (read/write)

# Read Pyth price (account 1)
f=open("/sol/1","rb")
d=f.read()
f.close()

# Parse price at offset 208 (lower 32 bits sufficient)
p=d[208]|d[209]<<8|d[210]<<16|d[211]<<24

# Convert to cents (expo=-8, so /1000000 * 100 = /10000)
c=p//10000

# Read current accumulator state (account 2)
g=open("/sol/2","rb")
a=list(g.read())
g.close()

# Shift prices (prev3 <- prev2 <- prev1 <- last <- new)
# prev_price_3 = prev_price_2
a[12]=a[8]
a[13]=a[9]
a[14]=a[10]
a[15]=a[11]
# prev_price_2 = prev_price_1
a[8]=a[4]
a[9]=a[5]
a[10]=a[6]
a[11]=a[7]
# prev_price_1 = last_price
a[4]=a[0]
a[5]=a[1]
a[6]=a[2]
a[7]=a[3]
# last_price = current
a[0]=c&255
a[1]=(c>>8)&255
a[2]=(c>>16)&255
a[3]=(c>>24)&255

# Calculate SMA (average of last 4 prices)
p0=a[0]|a[1]<<8|a[2]<<16|a[3]<<24
p1=a[4]|a[5]<<8|a[6]<<16|a[7]<<24
p2=a[8]|a[9]<<8|a[10]<<16|a[11]<<24
p3=a[12]|a[13]<<8|a[14]<<16|a[15]<<24
sma=(p0+p1+p2+p3)//4
a[16]=sma&255
a[17]=(sma>>8)&255
a[18]=(sma>>16)&255
a[19]=(sma>>24)&255

# Calculate momentum (current vs 3 periods ago, scaled to 0-255)
# 128 = neutral, >128 = up, <128 = down
if p3>0:
    m=128+(p0-p3)*100//p3
    if m<0:m=0
    if m>255:m=255
else:
    m=128
a[24]=m

# Calculate volatility (max-min range, scaled)
mx=p0
mn=p0
if p1>mx:mx=p1
if p1<mn:mn=p1
if p2>mx:mx=p2
if p2<mn:mn=p2
if p3>mx:mx=p3
if p3<mn:mn=p3
if sma>0:
    v=(mx-mn)*1000//sma
    if v>255:v=255
else:
    v=0
a[20]=v

# Write updated accumulator
h=open("/sol/2","wb")
h.write(bytes(a))
h.close()

# Return current price in cents
c
