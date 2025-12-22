# Optimal NN h2,h3
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
h2=-43+i0*(-25)//128+i1*(-45)//128+i2*30//128+i3*11//128+i4*(-3)//128+i5*(-17)//128
if h2<0:h2=0
if h2>255:h2=255
h3=-51+i0*(-41)//128+i1*(-53)//128+i2*28//128+i3*(-3)//128+i4*74//128+i5*(-7)//128
if h3<0:h3=0
if h3>255:h3=255
g=open("/sol/2","wb")
g.write(prev+bytes([h2,h3]))
g.close()
1
