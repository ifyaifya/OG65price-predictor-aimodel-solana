# Hidden h2
f=open("/sol/1","rb")
s=list(f.read())
f.close()
I0=s[0]
I1=s[1]
I2=s[2]
I3=s[3]
I4=s[4]
I5=s[5]
W=[3,-7,12,-2,8,-9,45]
h2=W[6]+I0*W[0]+I1*W[1]+I2*W[2]+I3*W[3]+I4*W[4]+I5*W[5]
if h2<0:h2=0
if h2>65535:h2=65535
g=open("/sol/2","rb")
o=list(g.read())
g.close()
o[4]=h2&255
o[5]=(h2>>8)&255
h=open("/sol/2","wb")
h.write(bytes(o))
h.close()
h2
