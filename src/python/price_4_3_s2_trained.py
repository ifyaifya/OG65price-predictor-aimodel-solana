# Price 4→3→2 S2: Decoder with TRAINED weights
# Weights embedded: W2 (6) + b2 (2) = 8 params
# Reads hidden state from account index 1
W=[-1,0,-49,6,50,127,-7,127]
g=open("/sol/1","rb")
h=list(g.read())
g.close()
o0=W[6]+h[0]*W[0]+h[1]*W[2]+h[2]*W[4]
o1=W[7]+h[0]*W[1]+h[1]*W[3]+h[2]*W[5]
o0*1000+o1
