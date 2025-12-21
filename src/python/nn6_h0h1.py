# Hidden h0,h1
f=open("/sol/1","rb")
s=list(f.read())
f.close()
I0=s[0]
I1=s[1]
I2=s[2]
I3=s[3]
I4=s[4]
I5=s[5]
W=[0,-9,21,13,28,23,64,72,11,-2,-27,58,-17,-56]
h0=W[12]+I0*W[0]+I1*W[1]+I2*W[2]+I3*W[3]+I4*W[4]+I5*W[5]
h1=W[13]+I0*W[6]+I1*W[7]+I2*W[8]+I3*W[9]+I4*W[10]+I5*W[11]
if h0<0:h0=0
if h1<0:h1=0
if h0>65535:h0=65535
if h1>65535:h1=65535
o=[h0&255,(h0>>8)&255,h1&255,(h1>>8)&255,s[6],s[7]]
g=open("/sol/2","wb")
g.write(bytes(o))
g.close()
h0
