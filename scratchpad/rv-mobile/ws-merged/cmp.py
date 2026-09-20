import zlib,struct,sys
def readpng(p):
    d=open(p,'rb').read(); i=8; idat=b''
    while i<len(d):
        ln=struct.unpack('>I',d[i:i+4])[0]; typ=d[i+4:i+8]; data=d[i+8:i+8+ln]
        if typ==b'IHDR': w,h,bd,ct=struct.unpack('>IIBB',data[:10])
        elif typ==b'IDAT': idat+=data
        i+=12+ln
    raw=zlib.decompress(idat); ch={0:1,2:3,4:2,6:4}[ct]; bpp=ch*bd//8; stride=w*bpp
    out=bytearray(); prev=bytearray(stride); pos=0
    for y in range(h):
        f=raw[pos]; pos+=1; line=bytearray(raw[pos:pos+stride]); pos+=stride
        for x in range(stride):
            a=line[x-bpp] if x>=bpp else 0; b=prev[x]; c=prev[x-bpp] if x>=bpp else 0
            if f==1: line[x]=(line[x]+a)&255
            elif f==2: line[x]=(line[x]+b)&255
            elif f==3: line[x]=(line[x]+(a+b)//2)&255
            elif f==4:
                pp=a+b-c; pa,pb,pc=abs(pp-a),abs(pp-b),abs(pp-c)
                pr=a if(pa<=pb and pa<=pc) else (b if pb<=pc else c); line[x]=(line[x]+pr)&255
        out+=line; prev=line
    return w,h,bpp,bytes(out)
w,h,bpp,A=readpng(sys.argv[1]); w2,h2,_,B=readpng(sys.argv[2])
if (w,h)!=(w2,h2): print('SIZE DIFFERS',w,h,w2,h2); sys.exit()
n=0; ys=set()
for y in range(h):
    ro=y*w*bpp
    for x in range(w):
        i=ro+x*bpp
        if abs(A[i]-B[i])>3 or abs(A[i+1]-B[i+1])>3 or abs(A[i+2]-B[i+2])>3: n+=1; ys.add(y)
print(f'{n} px' + (f'  y {min(ys)}-{max(ys)}' if ys else ''))
