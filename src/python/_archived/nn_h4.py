# NN h4 (TX5) - W=[-41,-8,-76,24,-47,-13], b=-36
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
h=-36+i0*(-41)//128+i1*(-8)//128+i2*(-76)//128+i3*24//128+i4*(-47)//128+i5*(-13)//128
if h<0:h=0
if h>255:h=255
g=open("/sol/2","wb")
g.write(prev+bytes([h]))
g.close()
1
