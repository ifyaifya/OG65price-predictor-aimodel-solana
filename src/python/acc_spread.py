# Pyth/DEX spread
f=open("/sol/1","rb")
a=list(f.read())
f.close()
pyth=a[0]|a[1]<<8|a[2]<<16|a[3]<<24
dex=a[24]|a[25]<<8|a[26]<<16|a[27]<<24
sp=128
if pyth>0:
    sp=128+(dex-pyth)*100//pyth
if sp<0:sp=0
if sp>255:sp=255
a[23]=sp
g=open("/sol/1","wb")
g.write(bytes(a))
g.close()
sp
