# Volatility only
f=open("/sol/1","rb")
a=list(f.read())
f.close()
p0=a[0]|a[1]<<8|a[2]<<16|a[3]<<24
p3=a[12]|a[13]<<8|a[14]<<16|a[15]<<24
s=a[16]|a[17]<<8|a[18]<<16|a[19]<<24
v=0
if s>0 and p3>0:
    d=p0-p3
    if d<0:d=-d
    v=d*100//s
if v>255:v=255
a[20]=v
g=open("/sol/1","wb")
g.write(bytes(a))
g.close()
v
