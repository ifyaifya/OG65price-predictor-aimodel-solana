# NN 6→8→1 Decoder: output layer (TX2)
# Input: 8 bytes from /sol/1 (hidden activations)
# Output: prediction value (positive=UP, negative=DOWN)

W=[-25,-127,-4,-22,-59,11,42,14]
b=-127

f=open("/sol/1","rb")
h=list(f.read(8))
f.close()

# Output neuron (dot product)
o=b+h[0]*W[0]//128+h[1]*W[1]//128+h[2]*W[2]//128+h[3]*W[3]//128+h[4]*W[4]//128+h[5]*W[5]//128+h[6]*W[6]//128+h[7]*W[7]//128

# Return: positive = UP, negative/zero = DOWN
o
