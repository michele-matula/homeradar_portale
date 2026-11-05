"""Dal logo.jpeg (quadrato arrotondato su fondo chiaro) ricava le icone PNG del portale.

uso (dalla radice, con Pillow installato in <pylib>):
  py -I docs/brand/icons.py <pylib> docs/brand/logo.jpeg apps/web/public
"""
import os
import sys

sys.path.insert(0, sys.argv[1])
from PIL import Image, ImageDraw

src, out = sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)

im = Image.open(src).convert('RGB')
# Quadrato misurato: da 20 a 1003 compresi, raggio degli angoli circa 212 px.
box = (20, 20, 1004, 1004)
radius_ratio = 212 / 984
sq = im.crop(box).resize((1024, 1024), Image.LANCZOS)

# Maschera ad angoli arrotondati disegnata 4x e ridotta (bordi morbidi).
big = 4096
mask = Image.new('L', (big, big), 0)
inset = 6 * 4  # rientro di qualche px: niente alone chiaro dal JPEG sui bordi
ImageDraw.Draw(mask).rounded_rectangle(
    (inset, inset, big - 1 - inset, big - 1 - inset), radius=round(big * radius_ratio) - inset, fill=255
)
mask = mask.resize((1024, 1024), Image.LANCZOS)
rounded = sq.copy()
rounded.putalpha(mask)

for size, name in [(512, 'icon-512.png'), (192, 'icon-192.png'), (32, 'favicon-32.png'), (16, 'favicon-16.png')]:
    rounded.resize((size, size), Image.LANCZOS).save(os.path.join(out, name), optimize=True)

# iOS vuole un quadrato pieno senza trasparenza (arrotonda da sé): angoli col colore di fondo.
teal = sq.getpixel((512, 900))
full = Image.new('RGB', (1024, 1024), teal)
full.paste(sq, (0, 0), mask)
full.resize((180, 180), Image.LANCZOS).save(os.path.join(out, 'apple-touch-icon.png'), optimize=True)

rounded.resize((48, 48), Image.LANCZOS).save(os.path.join(out, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)])
print('teal', teal)
for f in sorted(os.listdir(out)):
    print(f, os.path.getsize(os.path.join(out, f)))
