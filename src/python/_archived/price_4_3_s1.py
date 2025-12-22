# Price 4→3→2 S1: Encoder (15 params)
# W[0-11]=weights W[12-14]=biases W[15-18]=inputs
f=open("/sol/1","rb")
W=list(f.read())
f.close()
W=[w-256 if w>127 else w for w in W]
h0=W[12]+W[15]*W[0]+W[16]*W[3]+W[17]*W[6]+W[18]*W[9]
h1=W[13]+W[15]*W[1]+W[16]*W[4]+W[17]*W[7]+W[18]*W[10]
h2=W[14]+W[15]*W[2]+W[16]*W[5]+W[17]*W[8]+W[18]*W[11]
if h0<0:h0=0
if h1<0:h1=0
if h2<0:h2=0
g=open("/sol/2","wb")
g.write(bytes([h0%256,h1%256,h2%256]))
g.close()
1
