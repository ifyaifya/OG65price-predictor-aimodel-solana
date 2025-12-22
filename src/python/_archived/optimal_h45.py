# Optimal NN h4,h5
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
h4=-59+i0*(-24)//128+i1*(-8)//128+i2*(-22)//128+i3*49//128+i4*(-14)//128+i5*8//128
if h4<0:h4=0
if h4>255:h4=255
h5=-22+i0*(-109)//128+i1*14//128+i2*0//128+i3*(-57)//128+i4*49//128+i5*(-39)//128
if h5<0:h5=0
if h5>255:h5=255
g=open("/sol/2","wb")
g.write(prev+bytes([h4,h5]))
g.close()
1
