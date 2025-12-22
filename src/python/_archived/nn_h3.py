# NN h3 (TX4) - W=[-54,-86,107,-11,5,-76], b=-67
f=open("/sol/1","rb")
d=f.read(6)
f.close()
p=open("/sol/2","rb")
prev=p.read()
p.close()
i0=d[0]-128
i1=d[1]-128
i2=d[2]-128
i3=d[3]-128
i4=d[4]-128
i5=d[5]-128
h=-67+i0*(-54)//128+i1*(-86)//128+i2*107//128+i3*(-11)//128+i4*5//128+i5*(-76)//128
if h<0:h=0
if h>255:h=255
g=open("/sol/2","wb")
g.write(prev+bytes([h]))
g.close()
1
