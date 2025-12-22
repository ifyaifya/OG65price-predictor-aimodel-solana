# Accumulator V2 Part 1: Read Pyth, shift prices
# Accounts: /sol/1=Pyth, /sol/2=Accumulator (r/w)
f=open("/sol/1","rb")
d=f.read()
f.close()
# Read full 64-bit price
p=d[208]|d[209]<<8|d[210]<<16|d[211]<<24|d[212]<<32|d[213]<<40|d[214]<<48|d[215]<<56
# Convert to cents (expo=-8): price/10^8 * 100 = price/10^6
c=p//1000000
g=open("/sol/2","rb")
a=list(g.read())
g.close()
while len(a)<48:a.append(0)
a[12:16]=a[8:12]
a[8:12]=a[4:8]
a[4:8]=a[0:4]
a[0]=c&255
a[1]=(c>>8)&255
a[2]=(c>>16)&255
a[3]=(c>>24)&255
h=open("/sol/2","wb")
h.write(bytes(a))
h.close()
c
