# Momentum only
f=open("/sol/1","rb")
a=list(f.read())
f.close()
p0=a[0]|a[1]<<8|a[2]<<16|a[3]<<24
p3=a[12]|a[13]<<8|a[14]<<16|a[15]<<24
m=128
if p3>0:
    m=128+(p0-p3)*100//p3
if m<0:m=0
if m>255:m=255
a[21]=m
g=open("/sol/1","wb")
g.write(bytes(a))
g.close()
m
