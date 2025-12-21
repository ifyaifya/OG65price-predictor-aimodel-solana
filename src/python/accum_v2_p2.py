# Accumulator V2 Part 2: SMA, momentum, volatility
# Accounts: /sol/1=Accumulator (r/w)
f=open("/sol/1","rb")
a=list(f.read())
f.close()
p0=a[0]|a[1]<<8|a[2]<<16|a[3]<<24
p1=a[4]|a[5]<<8|a[6]<<16|a[7]<<24
p2=a[8]|a[9]<<8|a[10]<<16|a[11]<<24
p3=a[12]|a[13]<<8|a[14]<<16|a[15]<<24
s=(p0+p1+p2+p3)//4
a[16]=s&255
a[17]=(s>>8)&255
a[18]=(s>>16)&255
a[19]=(s>>24)&255
mx=p0
mn=p0
if p1>mx:mx=p1
if p1<mn:mn=p1
if p2>mx:mx=p2
if p2<mn:mn=p2
if p3>mx:mx=p3
if p3<mn:mn=p3
v=0
if s>0:
    v=(mx-mn)*1000//s
    if v>255:v=255
a[20]=v
m=128
if p3>0:
    m=128+(p0-p3)*100//p3
    if m<0:m=0
    if m>255:m=255
a[21]=m
g=open("/sol/1","wb")
g.write(bytes(a))
g.close()
s
