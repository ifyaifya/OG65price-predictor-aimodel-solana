# NN Hidden 0-1 (TX1)
f=open("/sol/1","rb")
d=f.read(6)
f.close()
i0=d[0]
i1=d[1]
i2=d[2]
i3=d[3]
i4=d[4]
i5=d[5]
h0=i0*33+i1*240+i2*45+i3*105+i4*238+i5*242
h0=h0//1024
if h0>255:h0=255
h1=i0*112+i1*51+i2*222+i3*26+i4*226+i5*224
h1=h1//1024
if h1>255:h1=255
g=open("/sol/2","wb")
g.write(bytes([h0,h1]))
g.close()
1
