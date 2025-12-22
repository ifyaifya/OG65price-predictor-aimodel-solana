# NN On-Chain - 6→8→1 Binary Classification (Full)
# Weights: /sol/2 (65 bytes), Features: /sol/3 (6 bytes)

w = open("/sol/2", "rb")
W = w.read(65)
w.close()

f = open("/sol/3", "rb")
I = f.read(6)
f.close()

# Input [-128, 127]
i0 = I[0] - 128
i1 = I[1] - 128
i2 = I[2] - 128
i3 = I[3] - 128
i4 = I[4] - 128
i5 = I[5] - 128

# Hidden layer - 8 neurons
# Neuron 0: weights W[0:6], bias W[48]
w0=W[0]
w1=W[1]
w2=W[2]
w3=W[3]
w4=W[4]
w5=W[5]
b0=W[48]
if w0>127:
    w0=w0-256
if w1>127:
    w1=w1-256
if w2>127:
    w2=w2-256
if w3>127:
    w3=w3-256
if w4>127:
    w4=w4-256
if w5>127:
    w5=w5-256
if b0>127:
    b0=b0-256
h0=b0+i0*w0//128+i1*w1//128+i2*w2//128+i3*w3//128+i4*w4//128+i5*w5//128
if h0<0:
    h0=0
if h0>255:
    h0=255

# Neuron 1
w0=W[6]
w1=W[7]
w2=W[8]
w3=W[9]
w4=W[10]
w5=W[11]
b1=W[49]
if w0>127:
    w0=w0-256
if w1>127:
    w1=w1-256
if w2>127:
    w2=w2-256
if w3>127:
    w3=w3-256
if w4>127:
    w4=w4-256
if w5>127:
    w5=w5-256
if b1>127:
    b1=b1-256
h1=b1+i0*w0//128+i1*w1//128+i2*w2//128+i3*w3//128+i4*w4//128+i5*w5//128
if h1<0:
    h1=0
if h1>255:
    h1=255

# Neuron 2
w0=W[12]
w1=W[13]
w2=W[14]
w3=W[15]
w4=W[16]
w5=W[17]
b2=W[50]
if w0>127:
    w0=w0-256
if w1>127:
    w1=w1-256
if w2>127:
    w2=w2-256
if w3>127:
    w3=w3-256
if w4>127:
    w4=w4-256
if w5>127:
    w5=w5-256
if b2>127:
    b2=b2-256
h2=b2+i0*w0//128+i1*w1//128+i2*w2//128+i3*w3//128+i4*w4//128+i5*w5//128
if h2<0:
    h2=0
if h2>255:
    h2=255

# Neuron 3
w0=W[18]
w1=W[19]
w2=W[20]
w3=W[21]
w4=W[22]
w5=W[23]
b3=W[51]
if w0>127:
    w0=w0-256
if w1>127:
    w1=w1-256
if w2>127:
    w2=w2-256
if w3>127:
    w3=w3-256
if w4>127:
    w4=w4-256
if w5>127:
    w5=w5-256
if b3>127:
    b3=b3-256
h3=b3+i0*w0//128+i1*w1//128+i2*w2//128+i3*w3//128+i4*w4//128+i5*w5//128
if h3<0:
    h3=0
if h3>255:
    h3=255

# Neuron 4
w0=W[24]
w1=W[25]
w2=W[26]
w3=W[27]
w4=W[28]
w5=W[29]
b4=W[52]
if w0>127:
    w0=w0-256
if w1>127:
    w1=w1-256
if w2>127:
    w2=w2-256
if w3>127:
    w3=w3-256
if w4>127:
    w4=w4-256
if w5>127:
    w5=w5-256
if b4>127:
    b4=b4-256
h4=b4+i0*w0//128+i1*w1//128+i2*w2//128+i3*w3//128+i4*w4//128+i5*w5//128
if h4<0:
    h4=0
if h4>255:
    h4=255

# Neuron 5
w0=W[30]
w1=W[31]
w2=W[32]
w3=W[33]
w4=W[34]
w5=W[35]
b5=W[53]
if w0>127:
    w0=w0-256
if w1>127:
    w1=w1-256
if w2>127:
    w2=w2-256
if w3>127:
    w3=w3-256
if w4>127:
    w4=w4-256
if w5>127:
    w5=w5-256
if b5>127:
    b5=b5-256
h5=b5+i0*w0//128+i1*w1//128+i2*w2//128+i3*w3//128+i4*w4//128+i5*w5//128
if h5<0:
    h5=0
if h5>255:
    h5=255

# Neuron 6
w0=W[36]
w1=W[37]
w2=W[38]
w3=W[39]
w4=W[40]
w5=W[41]
b6=W[54]
if w0>127:
    w0=w0-256
if w1>127:
    w1=w1-256
if w2>127:
    w2=w2-256
if w3>127:
    w3=w3-256
if w4>127:
    w4=w4-256
if w5>127:
    w5=w5-256
if b6>127:
    b6=b6-256
h6=b6+i0*w0//128+i1*w1//128+i2*w2//128+i3*w3//128+i4*w4//128+i5*w5//128
if h6<0:
    h6=0
if h6>255:
    h6=255

# Neuron 7
w0=W[42]
w1=W[43]
w2=W[44]
w3=W[45]
w4=W[46]
w5=W[47]
b7=W[55]
if w0>127:
    w0=w0-256
if w1>127:
    w1=w1-256
if w2>127:
    w2=w2-256
if w3>127:
    w3=w3-256
if w4>127:
    w4=w4-256
if w5>127:
    w5=w5-256
if b7>127:
    b7=b7-256
h7=b7+i0*w0//128+i1*w1//128+i2*w2//128+i3*w3//128+i4*w4//128+i5*w5//128
if h7<0:
    h7=0
if h7>255:
    h7=255

# Output layer: W[56:64], bias W[64]
o0=W[56]
o1=W[57]
o2=W[58]
o3=W[59]
o4=W[60]
o5=W[61]
o6=W[62]
o7=W[63]
ob=W[64]
if o0>127:
    o0=o0-256
if o1>127:
    o1=o1-256
if o2>127:
    o2=o2-256
if o3>127:
    o3=o3-256
if o4>127:
    o4=o4-256
if o5>127:
    o5=o5-256
if o6>127:
    o6=o6-256
if o7>127:
    o7=o7-256
if ob>127:
    ob=ob-256

out=ob+h0*o0//128+h1*o1//128+h2*o2//128+h3*o3//128+h4*o4//128+h5*o5//128+h6*o6//128+h7*o7//128

if out>0:
    print(1)
else:
    print(0)
