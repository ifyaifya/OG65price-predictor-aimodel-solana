# Raydium liquidity
f=open("/sol/1","rb")
sv=f.read()
f.close()
sol=sv[64]|sv[65]<<8|sv[66]<<16|sv[67]<<24|sv[68]<<32|sv[69]<<40|sv[70]<<48|sv[71]<<56
liq=0
s=sol
while s>0:
    liq=liq+1
    s=s>>1
if liq>255:liq=255
g=open("/sol/2","rb")
a=list(g.read())
g.close()
a[22]=liq
h=open("/sol/2","wb")
h.write(bytes(a))
h.close()
liq
