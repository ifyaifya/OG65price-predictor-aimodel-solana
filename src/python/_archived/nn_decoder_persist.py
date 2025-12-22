# NN Decoder - reads W2,b2 from account 0
# Account 0: weights (9 bytes: W2=8, b2=1)
# Account 1: hidden state (8 bytes)
# Returns: 0=DOWN, 1=UP

w=open("/sol/0","rb")
W=list(w.read(9))
w.close()

f=open("/sol/1","rb")
h=list(f.read(8))
f.close()

for j in range(9):
    if W[j]>127:W[j]=W[j]-256

o=W[8]+h[0]*W[0]//128+h[1]*W[1]//128+h[2]*W[2]//128+h[3]*W[3]//128+h[4]*W[4]//128+h[5]*W[5]//128+h[6]*W[6]//128+h[7]*W[7]//128

r=0
if o>0:r=1
r
