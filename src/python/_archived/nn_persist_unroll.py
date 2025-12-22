# NN 6→8→1 UNROLLED - reads weights from account
# Account 0: weights (65 bytes)
# Account 1: features (6 bytes)

# Read weights
w=open("/sol/0","rb")
W=list(w.read(65))
w.close()

# Read features
f=open("/sol/1","rb")
I=list(f.read(6))
f.close()

# Convert weights to signed
for j in range(65):
    if W[j]>127:W[j]=W[j]-256

# Scale inputs
i0=I[0]-128
i1=I[1]-128
i2=I[2]-128
i3=I[3]-128
i4=I[4]-128
i5=I[5]-128

# Hidden neurons (unrolled)
h0=W[48]+i0*W[0]//128+i1*W[1]//128+i2*W[2]//128+i3*W[3]//128+i4*W[4]//128+i5*W[5]//128
if h0<0:h0=0
if h0>255:h0=255

h1=W[49]+i0*W[6]//128+i1*W[7]//128+i2*W[8]//128+i3*W[9]//128+i4*W[10]//128+i5*W[11]//128
if h1<0:h1=0
if h1>255:h1=255

h2=W[50]+i0*W[12]//128+i1*W[13]//128+i2*W[14]//128+i3*W[15]//128+i4*W[16]//128+i5*W[17]//128
if h2<0:h2=0
if h2>255:h2=255

h3=W[51]+i0*W[18]//128+i1*W[19]//128+i2*W[20]//128+i3*W[21]//128+i4*W[22]//128+i5*W[23]//128
if h3<0:h3=0
if h3>255:h3=255

h4=W[52]+i0*W[24]//128+i1*W[25]//128+i2*W[26]//128+i3*W[27]//128+i4*W[28]//128+i5*W[29]//128
if h4<0:h4=0
if h4>255:h4=255

h5=W[53]+i0*W[30]//128+i1*W[31]//128+i2*W[32]//128+i3*W[33]//128+i4*W[34]//128+i5*W[35]//128
if h5<0:h5=0
if h5>255:h5=255

h6=W[54]+i0*W[36]//128+i1*W[37]//128+i2*W[38]//128+i3*W[39]//128+i4*W[40]//128+i5*W[41]//128
if h6<0:h6=0
if h6>255:h6=255

h7=W[55]+i0*W[42]//128+i1*W[43]//128+i2*W[44]//128+i3*W[45]//128+i4*W[46]//128+i5*W[47]//128
if h7<0:h7=0
if h7>255:h7=255

# Output
o=W[64]+h0*W[56]//128+h1*W[57]//128+h2*W[58]//128+h3*W[59]//128+h4*W[60]//128+h5*W[61]//128+h6*W[62]//128+h7*W[63]//128

r=0
if o>0:r=1
r
