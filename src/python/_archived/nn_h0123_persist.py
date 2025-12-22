# NN h0-h3 with weights from account
# Account 0: W1 part (24 bytes) + b1 part (4 bytes) = 28 bytes
# Account 1: features (6 bytes)
# Account 2: output (4 bytes)

w=open("/sol/0","rb")
W=list(w.read(28))
w.close()

f=open("/sol/1","rb")
I=list(f.read(6))
f.close()

for j in range(28):
    if W[j]>127:W[j]=W[j]-256

i0=I[0]-128
i1=I[1]-128
i2=I[2]-128
i3=I[3]-128
i4=I[4]-128
i5=I[5]-128

h0=W[24]+i0*W[0]//128+i1*W[1]//128+i2*W[2]//128+i3*W[3]//128+i4*W[4]//128+i5*W[5]//128
if h0<0:h0=0
if h0>255:h0=255

h1=W[25]+i0*W[6]//128+i1*W[7]//128+i2*W[8]//128+i3*W[9]//128+i4*W[10]//128+i5*W[11]//128
if h1<0:h1=0
if h1>255:h1=255

h2=W[26]+i0*W[12]//128+i1*W[13]//128+i2*W[14]//128+i3*W[15]//128+i4*W[16]//128+i5*W[17]//128
if h2<0:h2=0
if h2>255:h2=255

h3=W[27]+i0*W[18]//128+i1*W[19]//128+i2*W[20]//128+i3*W[21]//128+i4*W[22]//128+i5*W[23]//128
if h3<0:h3=0
if h3>255:h3=255

g=open("/sol/2","wb")
g.write(bytes([h0,h1,h2,h3]))
g.close()
1
