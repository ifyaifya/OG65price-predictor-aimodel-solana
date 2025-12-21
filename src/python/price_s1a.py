# Price Predictor Stage 1a: Partial Encoder (first 2 hidden neurons)
# 6 inputs → h0, h1 (14 params: 12 weights + 2 biases)
# Weight layout: W[0-11] = weights for h0,h1, W[12-13] = biases, W[14-19] = inputs
f=open("/sol/1","rb")
W=list(f.read())
f.close()
W=[w-256 if w>127 else w for w in W]
x=[W[14],W[15],W[16],W[17],W[18],W[19]]
h0=W[12]+x[0]*W[0]+x[1]*W[2]+x[2]*W[4]+x[3]*W[6]+x[4]*W[8]+x[5]*W[10]
h1=W[13]+x[0]*W[1]+x[1]*W[3]+x[2]*W[5]+x[3]*W[7]+x[4]*W[9]+x[5]*W[11]
g=open("/sol/2","wb")
g.write(bytes([h0%256,(h0>>8)%256,h1%256,(h1>>8)%256]))
g.close()
1
