# NN Encoder Part 2: compute h4,h5,h6,h7
# Reads features from /sol/1, existing h0-h3 from /sol/2
# Appends h4-h7 to complete the 8 hidden neurons

f=open("/sol/1","rb")
d=f.read(6)
f.close()
i0=d[0]-128
i1=d[1]-128
i2=d[2]-128
i3=d[3]-128
i4=d[4]-128
i5=d[5]-128

# Read existing h0-h3
g=open("/sol/2","rb")
h=list(g.read(4))
g.close()

# h4: W=[-41,-8,-76,24,-47,-13], b=-36
h4=-36+i0*(-41)//128+i1*(-8)//128+i2*(-76)//128+i3*24//128+i4*(-47)//128+i5*(-13)//128
if h4<0:h4=0
if h4>255:h4=255

# h5: W=[-32,123,-5,-93,57,-80], b=-26
h5=-26+i0*(-32)//128+i1*123//128+i2*(-5)//128+i3*(-93)//128+i4*57//128+i5*(-80)//128
if h5<0:h5=0
if h5>255:h5=255

# h6: W=[13,-124,-78,5,49,26], b=4
h6=4+i0*13//128+i1*(-124)//128+i2*(-78)//128+i3*5//128+i4*49//128+i5*26//128
if h6<0:h6=0
if h6>255:h6=255

# h7: W=[-11,-1,-96,-45,-39,55], b=-127
h7=-127+i0*(-11)//128+i1*(-1)//128+i2*(-96)//128+i3*(-45)//128+i4*(-39)//128+i5*55//128
if h7<0:h7=0
if h7>255:h7=255

# Write all 8 hidden neurons
o=open("/sol/2","wb")
o.write(bytes([h[0],h[1],h[2],h[3],h4,h5,h6,h7]))
o.close()
1
