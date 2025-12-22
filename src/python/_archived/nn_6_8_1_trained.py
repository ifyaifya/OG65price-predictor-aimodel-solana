# Price Predictor 6→8→1 with TRAINED weights
# Binary classification: output > 0 → UP, else DOWN
# Input: 6 bytes from account (features normalized 0-255)
# W1(48) + b1(8) + W2(8) + b2(1) = 65 params

# Weights from final_model.bin (signed INT8)
W1=[33,-16,45,105,-18,-14,112,51,-34,26,-30,-32,12,-127,-112,-42,-57,17,-54,-86,107,-11,5,-76,-41,-8,-76,24,-47,-13,-32,123,-5,-93,57,-80,13,-124,-78,5,49,26,-11,-1,-96,-45,-39,55]
b1=[-76,34,-48,-67,-36,-26,4,-127]
W2=[-25,-127,-4,-22,-59,11,42,14]
b2=-127

# Read 6 features from account
f=open("/sol/1","rb")
I=list(f.read(6))
f.close()

# Scale inputs to [-128, 127]
I=[x-128 for x in I]

# Hidden layer (8 neurons) - dot product + bias + ReLU
h=[]
for n in range(8):
    s=b1[n]
    for i in range(6):
        s=s+I[i]*W1[n*6+i]//128
    if s<0:s=0
    h.append(s)

# Output layer (1 neuron) - sigmoid approximated as threshold
o=b2
for i in range(8):
    o=o+h[i]*W2[i]//128

# Return: positive = UP, negative = DOWN
o
