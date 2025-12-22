# Price 5→3→2 S1: Encoder (18 params)
# W[0-14]=weights W[15-17]=biases W[18-22]=inputs
f=open("/sol/1","rb")
W=list(f.read())
f.close()
W=[w-256 if w>127 else w for w in W]
h0=W[15]+W[18]*W[0]+W[19]*W[3]+W[20]*W[6]+W[21]*W[9]+W[22]*W[12]
h1=W[16]+W[18]*W[1]+W[19]*W[4]+W[20]*W[7]+W[21]*W[10]+W[22]*W[13]
h2=W[17]+W[18]*W[2]+W[19]*W[5]+W[20]*W[8]+W[21]*W[11]+W[22]*W[14]
if h0<0:h0=0
if h1<0:h1=0
if h2<0:h2=0
g=open("/sol/2","wb")
g.write(bytes([h0%256,h1%256,h2%256]))
g.close()
1
