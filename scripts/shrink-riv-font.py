# Cut the font embedded in a .riv down to the digits 0-9 (needs fonttools).
# python3 scripts/shrink-riv-font.py <in.riv> <out.riv> <scratch dir>
# N below is the embedded font's byte length, as Rive reports it.
import sys
src,dst,fontdir=sys.argv[1:4]
b=open(src,'rb').read()
def enc(n):
    o=bytearray()
    while True:
        c=n&127;n>>=7
        if n:o.append(c|128)
        else:o.append(c);return bytes(o)
N=276932
i=b.find(enc(N)+b'\x00\x01\x00\x00')
assert i>0 and b.count(enc(N)+b'\x00\x01\x00\x00')==1, i
L=len(enc(N))
font=b[i+L:i+L+N]
open(f'{fontdir}/nunito.ttf','wb').write(font)
from fontTools import subset
from fontTools.ttLib import TTFont
f=TTFont(f'{fontdir}/nunito.ttf')
print('axes',[(a.axisTag,a.minValue,a.defaultValue,a.maxValue) for a in f['fvar'].axes] if 'fvar' in f else None)
opts=subset.Options(); opts.layout_features=[]; opts.name_IDs=['*']; opts.notdef_outline=True; opts.hinting=False; opts.desubroutinize=True
sub=subset.Subsetter(opts); sub.populate(text='0123456789'); sub.subset(f)
f.save(f'{fontdir}/nunito-digits.ttf')
small=open(f'{fontdir}/nunito-digits.ttf','rb').read()
out=b[:i]+enc(len(small))+small+b[i+L+N:]
open(dst,'wb').write(out)
print('font',N,'->',len(small),'| riv',len(b),'->',len(out))
