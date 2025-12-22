# Raydium Pool Reader - Read SOL/USDC reserves from vault accounts
#
# This script reads token balances from Raydium vault accounts to calculate
# spot price and liquidity metrics.
#
# Accounts:
#   /sol/1 = SOL vault (SPL token account)
#   /sol/2 = USDC vault (SPL token account)
#
# SPL Token Account Layout (165 bytes):
#   [0-31]:   mint (PublicKey)
#   [32-63]:  owner (PublicKey)
#   [64-71]:  amount (u64)
#   [72]:     delegate_option
#   ...
#
# SOL has 9 decimals, USDC has 6 decimals

# Read SOL vault (account 1)
f=open("/sol/1","rb")
a=f.read()
f.close()

# Read USDC vault (account 2)
g=open("/sol/2","rb")
b=g.read()
g.close()

# Extract SOL amount at offset 64 (u64, little-endian)
sol=a[64]|a[65]<<8|a[66]<<16|a[67]<<24|a[68]<<32|a[69]<<40|a[70]<<48|a[71]<<56

# Extract USDC amount at offset 64 (u64, little-endian)
usdc=b[64]|b[65]<<8|b[66]<<16|b[67]<<24|b[68]<<32|b[69]<<40|b[70]<<48|b[71]<<56

# Calculate price: USDC/SOL adjusted for decimals
# SOL = 9 decimals (1 SOL = 1e9 lamports)
# USDC = 6 decimals (1 USDC = 1e6 micro-USDC)
# Price in cents = usdc * 100000 / sol
# (usdc/1e6) / (sol/1e9) * 100 = usdc * 1e9 * 100 / (sol * 1e6) = usdc * 100000 / sol
if sol>0:
    price=(usdc*100000)//sol
else:
    price=0

# Return: price * 1000 + liquidity_indicator
# Price in cents (e.g., 12414 = $124.14)
# Liquidity indicator = log2(sol_lamports) scaled to 0-255
liq=0
s=sol
while s>0:
    liq=liq+1
    s=s>>1
if liq>255:liq=255

price*1000+liq
