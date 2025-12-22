# Optimal NN h6,h7
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
h6=127+i0*(-15)//128+i1*(-30)//128+i2*(-3)//128+i3*8//128+i4*2//128+i5*31//128
if h6<0:h6=0
if h6>255:h6=255
h7=-117+i0*(-8)//128+i1*(-3)//128+i2*(-93)//128+i3*(-9)//128+i4*9//128+i5*78//128
if h7<0:h7=0
if h7>255:h7=255
g=open("/sol/2","wb")
g.write(prev+bytes([h6,h7]))
g.close()
1
