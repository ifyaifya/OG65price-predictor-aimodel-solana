# Test if bytes() is defined
f=open("/sol/1","rb")
a=list(f.read())
f.close()
a[0]=42
a[1]=43
g=open("/sol/1","wb")
g.write(bytes(a))
g.close()
42
