# Price Predictor 4→3→2 Stage 2: Decoder
# 3 hidden → 2 outputs (8 params: 6 weights + 2 biases)
# Layout: W[0-5]=weights, W[6-7]=biases
f=open("/sol/1","rb")
W=list(f.read())
f.close()
W=[w-256 if w>127 else w for w in W]
g=open("/sol/2","rb")
h=list(g.read())
g.close()
o0=W[6]+h[0]*W[0]+h[1]*W[2]+h[2]*W[4]
o1=W[7]+h[0]*W[1]+h[1]*W[3]+h[2]*W[5]
o0*1000+o1
