# NN h6 (TX7) - W=[13,-124,-78,5,49,26], b=4
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
h=4+i0*13//128+i1*(-124)//128+i2*(-78)//128+i3*5//128+i4*49//128+i5*26//128
if h<0:h=0
if h>255:h=255
g=open("/sol/2","wb")
g.write(prev+bytes([h]))
g.close()
1
