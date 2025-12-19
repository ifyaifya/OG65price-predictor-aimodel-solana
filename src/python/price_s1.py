# Price Predictor Stage 1: Encoder 6→4 (28 params)
# Inputs read from weight account bytes 28-33
# Writes hidden state (4 bytes) to /sol/2
f=open("/sol/1","rb")
W=list(f.read())
f.close()
W=[w-256 if w>127 else w for w in W]
x=[W[28],W[29],W[30],W[31],W[32],W[33]]
h0=W[24]+x[0]*W[0]+x[1]*W[4]+x[2]*W[8]+x[3]*W[12]+x[4]*W[16]+x[5]*W[20]
h1=W[25]+x[0]*W[1]+x[1]*W[5]+x[2]*W[9]+x[3]*W[13]+x[4]*W[17]+x[5]*W[21]
h2=W[26]+x[0]*W[2]+x[1]*W[6]+x[2]*W[10]+x[3]*W[14]+x[4]*W[18]+x[5]*W[22]
h3=W[27]+x[0]*W[3]+x[1]*W[7]+x[2]*W[11]+x[3]*W[15]+x[4]*W[19]+x[5]*W[23]
if h0<0:h0=0
if h1<0:h1=0
if h2<0:h2=0
if h3<0:h3=0
g=open("/sol/2","wb")
g.write(bytes([h0%256,h1%256,h2%256,h3%256]))
g.close()
1
