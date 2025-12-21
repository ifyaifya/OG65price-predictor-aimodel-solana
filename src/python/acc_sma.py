# SMA calculation only
f=open("/sol/1","rb")
a=list(f.read())
f.close()
p0=a[0]|a[1]<<8|a[2]<<16|a[3]<<24
p1=a[4]|a[5]<<8|a[6]<<16|a[7]<<24
p2=a[8]|a[9]<<8|a[10]<<16|a[11]<<24
p3=a[12]|a[13]<<8|a[14]<<16|a[15]<<24
s=(p0+p1+p2+p3)//4
a[16]=s&255
a[17]=(s>>8)&255
a[18]=(s>>16)&255
a[19]=(s>>24)&255
g=open("/sol/1","wb")
g.write(bytes(a))
g.close()
s
