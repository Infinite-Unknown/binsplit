"""Draw an EAN-13 barcode as SVG (for testing the photo scanner).

Usage: python3 scripts/make-barcode.py 5449000000996 out.svg
"""
import sys

L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"]
G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"]
R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"]
PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"]

code, out = sys.argv[1], sys.argv[2]
d = [int(c) for c in code]
bits = "101"
for i, n in enumerate(d[1:7]):
    bits += (L if PARITY[d[0]][i] == "L" else G)[n]
bits += "01010"
for n in d[7:]:
    bits += R[n]
bits += "101"

m = 4  # module width in px
quiet = 11 * m
w = len(bits) * m + 2 * quiet
h = 260
rects = "".join(
    f'<rect x="{quiet + i * m}" y="20" width="{m}" height="{200}" fill="#000"/>' for i, b in enumerate(bits) if b == "1"
)
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
<rect width="{w}" height="{h}" fill="#fff"/>{rects}
<text x="{w/2}" y="248" font-family="Helvetica" font-size="28" text-anchor="middle" letter-spacing="6">{code}</text></svg>'''
open(out, "w").write(svg)
print(f"wrote {out}")
