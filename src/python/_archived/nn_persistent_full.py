# NN 6→8→1 with weights from account
# Account 0: weights (65 bytes: W1=48, b1=8, W2=8, b2=1)
# Account 1: features (6 bytes input from user)
# Account 2: hidden state (8 bytes, writable)
# Returns: 0=DOWN, 1=UP

# Read weights from persistent account
w=open("/sol/0","rb")
W=list(w.read(65))
w.close()

# Convert to signed
for j in range(65):
    if W[j]>127:W[j]=W[j]-256

# Read user features
f=open("/sol/1","rb")
I=list(f.read(6))
f.close()

# Scale inputs
i0=I[0]-128
i1=I[1]-128
i2=I[2]-128
i3=I[3]-128
i4=I[4]-128
i5=I[5]-128

# Hidden layer (8 neurons)
h=[]
for n in range(8):
    b=W[48+n]
    s=b
    for k in range(6):
        s=s+W[n*6+k]*[i0,i1,i2,i3,i4,i5][k]//128
    if s<0:s=0
    if s>255:s=255
    h.append(s)

# Output layer
o=W[64]
for k in range(8):
    o=o+h[k]*W[56+k]//128

# Return prediction
r=0
if o>0:r=1
r
