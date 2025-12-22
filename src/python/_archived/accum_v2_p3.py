# Accumulator V2 Part 3: Raydium liquidity + spread
# Accounts: /sol/1=SOL vault, /sol/2=USDC vault, /sol/3=Accumulator
f=open("/sol/1","rb")
sv=f.read()
f.close()
g=open("/sol/2","rb")
uv=g.read()
g.close()
sol=sv[64]|sv[65]<<8|sv[66]<<16|sv[67]<<24|sv[68]<<32|sv[69]<<40|sv[70]<<48|sv[71]<<56
usdc=uv[64]|uv[65]<<8|uv[66]<<16|uv[67]<<24|uv[68]<<32|uv[69]<<40|uv[70]<<48|uv[71]<<56
dex=0
if sol>0:dex=(usdc*100000)//sol
liq=0
s=sol
while s>0:
    liq=liq+1
    s=s>>1
if liq>255:liq=255
h=open("/sol/3","rb")
a=list(h.read())
h.close()
a[22]=liq
pyth=a[0]|a[1]<<8|a[2]<<16|a[3]<<24
sp=128
if pyth>0:
    sp=128+(dex-pyth)*100//pyth
    if sp<0:sp=0
    if sp>255:sp=255
a[23]=sp
a[24]=dex&255
a[25]=(dex>>8)&255
a[26]=(dex>>16)&255
a[27]=(dex>>24)&255
i=open("/sol/3","wb")
i.write(bytes(a))
i.close()
dex
