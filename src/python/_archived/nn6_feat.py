# Extract 6 features, write to scratch
f=open("/sol/1","rb")
a=list(f.read())
f.close()
p0=a[0]|a[1]<<8|a[2]<<16|a[3]<<24
p1=a[4]|a[5]<<8|a[6]<<16|a[7]<<24
p2=a[8]|a[9]<<8|a[10]<<16|a[11]<<24
sm=a[16]|a[17]<<8|a[18]<<16|a[19]<<24
I0=128
if sm>0:I0=128+(p0-sm)*100//sm
if I0<0:I0=0
if I0>255:I0=255
I1=a[21]
I2=a[20]
I3=a[22]
I4=a[23]
up=0
if p0>p1:up=up+1
if p1>p2:up=up+1
I5=85*up
s=[I0,I1,I2,I3,I4,I5]
g=open("/sol/2","wb")
g.write(bytes(s))
g.close()
I0
