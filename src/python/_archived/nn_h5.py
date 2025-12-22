# NN h5 (TX6) - W=[-32,123,-5,-93,57,-80], b=-26
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
h=-26+i0*(-32)//128+i1*123//128+i2*(-5)//128+i3*(-93)//128+i4*57//128+i5*(-80)//128
if h<0:h=0
if h>255:h=255
g=open("/sol/2","wb")
g.write(prev+bytes([h]))
g.close()
1
