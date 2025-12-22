# NN h7 (TX8) - W=[-11,-1,-96,-45,-39,55], b=-127
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
h=-127+i0*(-11)//128+i1*(-1)//128+i2*(-96)//128+i3*(-45)//128+i4*(-39)//128+i5*55//128
if h<0:h=0
if h>255:h=255
g=open("/sol/2","wb")
g.write(prev+bytes([h]))
g.close()
1
