"""Prepare a Rive file for the app: cut its embedded fonts down to the digits
and swap colours, writing a new .riv.

    python3 scripts/rive/prepare.py in.riv out.riv [--color f2af0f=ff6a2a ...]

Needs fonttools (pip install fonttools). keys.json maps each property key to
its type; it was generated from rive-runtime's include/rive/generated headers
(core_registry.hpp and the *_base.hpp files) and needs regenerating only if a
new Rive editor writes properties it does not list (the script then stops
with "unknown property").

Colours keep their own alpha: only the RGB is swapped, so fades still fade.
"""
import io, json, os, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
KEYS = {int(k): v for k, v in json.load(open(os.path.join(HERE, 'keys.json'))).items()}


def varuint(n):
    out = bytearray()
    while True:
        c = n & 127; n >>= 7
        if n: out.append(c | 128)
        else: out.append(c); return bytes(out)


def parse(b):
    """Yield (prop name, type, value start, value end, length-prefix start) for every property."""
    p = 4
    def vu():
        nonlocal p
        r = s = 0
        while True:
            c = b[p]; p += 1; r |= (c & 127) << s; s += 7
            if c < 128: return r
    vu(); vu(); vu()
    toc = []
    while (k := vu()) != 0: toc.append(k)
    toc_types, bit, cur = {}, 8, 0
    for k in toc:
        if bit == 8: cur = struct.unpack('<I', b[p:p + 4])[0]; p += 4; bit = 0
        toc_types[k] = ['Uint', 'String', 'Double', 'Color'][(cur >> bit) & 3]; bit += 2
    while p < len(b):
        vu()  # object type
        while (k := vu()) != 0:
            known = KEYS.get(k)
            ty = (known[2] if known and known[2] else None) or toc_types.get(k)
            if ty is None: sys.exit(f'unknown property {k} at byte {p}: regenerate keys.json')
            name = f'{known[0]}.{known[1]}' if known else str(k)
            if ty in ('Uint', 'Id', 'Int'): vu()
            elif ty in ('String', 'Bytes'):
                pre = p; n = vu(); yield name, ty, p, p + n, pre; p += n
            elif ty == 'Double': p += 4
            elif ty == 'Bool': p += 1
            elif ty == 'Color': yield name, ty, p, p + 4, None; p += 4


def digits_only(font):
    from fontTools import subset
    from fontTools.ttLib import TTFont
    f = TTFont(io.BytesIO(font))
    opts = subset.Options(); opts.layout_features = []; opts.name_IDs = ['*']; opts.notdef_outline = True; opts.hinting = False
    s = subset.Subsetter(opts); s.populate(text='0123456789'); s.subset(f)
    out = io.BytesIO(); f.save(out); return out.getvalue()


def main():
    src, dst, *rest = sys.argv[1:]
    swaps = {}
    for arg in rest:
        if arg == '--color': continue
        a, z = arg.lower().split('='); swaps[int(a, 16)] = int(z, 16)
    b = bytearray(open(src, 'rb').read())
    size = len(b)
    # Colours first (in place, same length), then fonts from the back so earlier offsets stay valid.
    fonts = []
    for name, ty, start, end, pre in parse(b):
        if ty == 'Color':
            v = struct.unpack('<I', b[start:end])[0]
            rgb = v & 0xFFFFFF
            if rgb in swaps: b[start:end] = struct.pack('<I', (v & 0xFF000000) | swaps[rgb])
        elif name == 'FileAssetContents.bytes' and b[start:start + 4] in (b'\x00\x01\x00\x00', b'true', b'OTTO'):
            fonts.append((pre, start, end))
    for pre, start, end in reversed(fonts):
        small = digits_only(bytes(b[start:end]))
        b[pre:end] = varuint(len(small)) + small
    open(dst, 'wb').write(b)
    print(f'{src}: {size} -> {len(b)} bytes, {len(fonts)} font(s) cut to digits, {len(swaps)} colour swap(s)')


if __name__ == '__main__':
    main()
