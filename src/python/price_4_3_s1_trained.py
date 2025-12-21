# Price 4→3→2 S1: Encoder with TRAINED weights
# Weights embedded: W1 (12) + b1 (3) = 15 params
# Input: 4 bytes from account (features)
W=[23,-12,1,-41,-10,0,-127,-12,1,76,-21,1,61,127,123]
f=open("/sol/1","rb")
I=list(f.read())
f.close()
h0=W[12]+I[0]*W[0]+I[1]*W[3]+I[2]*W[6]+I[3]*W[9]
h1=W[13]+I[0]*W[1]+I[1]*W[4]+I[2]*W[7]+I[3]*W[10]
h2=W[14]+I[0]*W[2]+I[1]*W[5]+I[2]*W[8]+I[3]*W[11]
if h0<0:h0=0
if h1<0:h1=0
if h2<0:h2=0
g=open("/sol/2","wb")
g.write(bytes([h0%256,h1%256,h2%256]))
g.close()
1
