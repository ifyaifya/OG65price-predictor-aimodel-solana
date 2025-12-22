# Price Predictor Stage 2: Decoder 4→2 (10 params)
# Reads hidden state (4 bytes) from /sol/2
# Outputs: direction score, confidence
f=open("/sol/1","rb")
W=list(f.read())
f.close()
W=[w-256 if w>127 else w for w in W]
g=open("/sol/2","rb")
h=list(g.read())
g.close()
direction=W[8]+h[0]*W[0]+h[1]*W[2]+h[2]*W[4]+h[3]*W[6]
confidence=W[9]+h[0]*W[1]+h[1]*W[3]+h[2]*W[5]+h[3]*W[7]
direction*1000+confidence
