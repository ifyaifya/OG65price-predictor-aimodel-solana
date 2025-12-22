# Feature Accumulator V2 - Combines Pyth Oracle + Raydium DEX data
#
# This script runs periodically (via crank) to:
# 1. Read current price from Pyth oracle
# 2. Read DEX price from Raydium pool reserves
# 3. Update rolling features in accumulator account
#
# Accounts:
#   /sol/1 = Pyth SOL/USD price account (read)
#   /sol/2 = Raydium SOL vault - DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz
#   /sol/3 = Raydium USDC vault - HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz
#   /sol/4 = Feature accumulator (read/write)
#
# Accumulator layout (48 bytes):
#   [0-3]:   last_price (u32, Pyth price in cents)
#   [4-7]:   prev_price_1 (u32)
#   [8-11]:  prev_price_2 (u32)
#   [12-15]: prev_price_3 (u32)
#   [16-19]: sma_4 (u32, 4-period SMA)
#   [20]:    volatility (u8, 0-255)
#   [21]:    momentum (u8, 0-255, 128=neutral)
#   [22]:    liquidity (u8, 0-255, log2 scaled)
#   [23]:    pyth_dex_spread (u8, 0-255, 128=no spread)
#   [24-27]: dex_price (u32, Raydium price in cents)
#   [28-31]: reserved

# === Read Pyth price (account 1) ===
f=open("/sol/1","rb")
d=f.read()
f.close()

# Parse price at offset 208 (lower 32 bits)
pyth=d[208]|d[209]<<8|d[210]<<16|d[211]<<24

# Convert to cents (expo=-8, so /1000000 * 100 = /10000)
pyth_cents=pyth//10000

# === Read Raydium vaults (accounts 2 and 3) ===
g=open("/sol/2","rb")
sol_vault=g.read()
g.close()

h=open("/sol/3","rb")
usdc_vault=h.read()
h.close()

# Extract amounts at offset 64
sol_amt=sol_vault[64]|sol_vault[65]<<8|sol_vault[66]<<16|sol_vault[67]<<24|sol_vault[68]<<32|sol_vault[69]<<40|sol_vault[70]<<48|sol_vault[71]<<56
usdc_amt=usdc_vault[64]|usdc_vault[65]<<8|usdc_vault[66]<<16|usdc_vault[67]<<24|usdc_vault[68]<<32|usdc_vault[69]<<40|usdc_vault[70]<<48|usdc_vault[71]<<56

# DEX price in cents = usdc * 100000 / sol
if sol_amt>0:
    dex_cents=(usdc_amt*100000)//sol_amt
else:
    dex_cents=pyth_cents

# Liquidity indicator (log2 of SOL lamports, scaled to 0-255)
liq=0
s=sol_amt
while s>0:
    liq=liq+1
    s=s>>1
if liq>255:liq=255

# === Read current accumulator state (account 4) ===
i=open("/sol/4","rb")
a=list(i.read())
i.close()

# Ensure we have 48 bytes
while len(a)<48:
    a.append(0)

# === Shift prices (prev3 <- prev2 <- prev1 <- last <- new) ===
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
# last_price = current Pyth price
a[0]=pyth_cents&255
a[1]=(pyth_cents>>8)&255
a[2]=(pyth_cents>>16)&255
a[3]=(pyth_cents>>24)&255

# === Calculate SMA (average of last 4 prices) ===
p0=a[0]|a[1]<<8|a[2]<<16|a[3]<<24
p1=a[4]|a[5]<<8|a[6]<<16|a[7]<<24
p2=a[8]|a[9]<<8|a[10]<<16|a[11]<<24
p3=a[12]|a[13]<<8|a[14]<<16|a[15]<<24
sma=(p0+p1+p2+p3)//4
a[16]=sma&255
a[17]=(sma>>8)&255
a[18]=(sma>>16)&255
a[19]=(sma>>24)&255

# === Calculate volatility (max-min range, scaled to 0-255) ===
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

# === Calculate momentum (current vs 3 periods ago, scaled to 0-255) ===
# 128 = neutral, >128 = up, <128 = down
if p3>0:
    m=128+(p0-p3)*100//p3
    if m<0:m=0
    if m>255:m=255
else:
    m=128
a[21]=m

# === Store liquidity indicator ===
a[22]=liq

# === Calculate Pyth/DEX spread (128 = no spread) ===
# Useful for detecting arbitrage opportunities
if pyth_cents>0:
    spread=128+(dex_cents-pyth_cents)*100//pyth_cents
    if spread<0:spread=0
    if spread>255:spread=255
else:
    spread=128
a[23]=spread

# === Store DEX price ===
a[24]=dex_cents&255
a[25]=(dex_cents>>8)&255
a[26]=(dex_cents>>16)&255
a[27]=(dex_cents>>24)&255

# === Write updated accumulator ===
j=open("/sol/4","wb")
j.write(bytes(a[:48]))
j.close()

# Return: pyth_cents * 1000 + spread (for debugging)
pyth_cents*1000+spread
