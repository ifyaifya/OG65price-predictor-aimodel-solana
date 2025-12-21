# Pyth Price Reader - Read SOL/USD price directly from Pyth on-chain account
# Account structure: https://docs.pyth.network/price-feeds
#
# Key offsets:
#   Offset 20:  expo (i32, 4 bytes) - decimal exponent
#   Offset 208: price (i64, 8 bytes) - raw price value
#   Offset 216: conf (u64, 8 bytes) - confidence interval
#
# Usage: Pass Pyth SOL/USD account as /sol/1
# SOL/USD mainnet: H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG

# Read Pyth price account (passed as account index 1)
f=open("/sol/1","rb")
d=f.read()
f.close()

# Parse expo at offset 20 (4 bytes, signed int32)
e=d[20]|d[21]<<8|d[22]<<16|d[23]<<24
if e>2147483647:e=e-4294967296

# Parse price at offset 208 (8 bytes, signed int64)
p=d[208]|d[209]<<8|d[210]<<16|d[211]<<24|d[212]<<32|d[213]<<40|d[214]<<48|d[215]<<56
if p>9223372036854775807:p=p-18446744073709551616

# Parse confidence at offset 216 (8 bytes, unsigned)
c=d[216]|d[217]<<8|d[218]<<16|d[219]<<24|d[220]<<32|d[221]<<40|d[222]<<48|d[223]<<56

# Return price * 1000 for precision (expo is typically -8)
# Ex: price=18940000000, expo=-8 → 189.4 * 1000 = 189400
p*1000
