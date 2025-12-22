# Price Predictor Stage 1b: Partial Encoder (last 2 hidden neurons + ReLU)
# 6 inputs → h2, h3, combine with h0,h1, apply ReLU
# Weight layout: W[0-11] = weights for h2,h3, W[12-13] = biases, W[14-19] = inputs
f=open("/sol/1","rb")
W=list(f.read())
f.close()
W=[w-256 if w>127 else w for w in W]
x=[W[14],W[15],W[16],W[17],W[18],W[19]]
h2=W[12]+x[0]*W[0]+x[1]*W[2]+x[2]*W[4]+x[3]*W[6]+x[4]*W[8]+x[5]*W[10]
h3=W[13]+x[0]*W[1]+x[1]*W[3]+x[2]*W[5]+x[3]*W[7]+x[4]*W[9]+x[5]*W[11]
g=open("/sol/2","rb")
p=list(g.read())
g.close()
h0=p[0]+p[1]*256
h1=p[2]+p[3]*256
if h0>32767:h0=h0-65536
if h1>32767:h1=h1-65536
if h0<0:h0=0
if h1<0:h1=0
if h2<0:h2=0
if h3<0:h3=0
g=open("/sol/2","wb")
g.write(bytes([h0%256,h1%256,h2%256,h3%256]))
g.close()
1
