# NN h1 (TX2) - W=[112,51,-34,26,-30,-32], b=34
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
h=34+i0*112//128+i1*51//128+i2*(-34)//128+i3*26//128+i4*(-30)//128+i5*(-32)//128
if h<0:h=0
if h>255:h=255
g=open("/sol/2","wb")
g.write(prev+bytes([h]))
g.close()
1
