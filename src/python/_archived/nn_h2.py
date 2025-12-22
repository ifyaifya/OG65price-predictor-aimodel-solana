# NN h2 (TX3) - W=[12,-127,-112,-42,-57,17], b=-48
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
h=-48+i0*12//128+i1*(-127)//128+i2*(-112)//128+i3*(-42)//128+i4*(-57)//128+i5*17//128
if h<0:h=0
if h>255:h=255
g=open("/sol/2","wb")
g.write(prev+bytes([h]))
g.close()
1
