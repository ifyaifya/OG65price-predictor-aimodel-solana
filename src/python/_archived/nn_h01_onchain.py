# NN h0,h1 - weights from on-chain account
# Account 0: W1[0:12] + b1[0:2] = 14 bytes (pre-stored as signed+128)
# Account 1: features (6 bytes)
# Account 2: output (2 bytes)

w=open("/sol/0","rb")
d=w.read(14)
w.close()

f=open("/sol/1","rb")
I=f.read(6)
f.close()

i0=I[0]-128
i1=I[1]-128
i2=I[2]-128
i3=I[3]-128
i4=I[4]-128
i5=I[5]-128

h0=(d[12]-128)+i0*(d[0]-128)//128+i1*(d[1]-128)//128+i2*(d[2]-128)//128+i3*(d[3]-128)//128+i4*(d[4]-128)//128+i5*(d[5]-128)//128
if h0<0:h0=0
if h0>255:h0=255

h1=(d[13]-128)+i0*(d[6]-128)//128+i1*(d[7]-128)//128+i2*(d[8]-128)//128+i3*(d[9]-128)//128+i4*(d[10]-128)//128+i5*(d[11]-128)//128
if h1<0:h1=0
if h1>255:h1=255

g=open("/sol/2","wb")
g.write(bytes([h0,h1]))
g.close()
1
