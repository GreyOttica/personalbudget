# Genera le icone dell app: python3 scripts/make-icons.py . <cartella anteprima>
import sys, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter
root = sys.argv[1]
FONT = "/usr/share/fonts/opentype/inter/InterDisplay-Black.otf"
STOPS = [(0.0, (123, 47, 247)), (0.5, (241, 7, 163)), (1.0, (255, 159, 28))]  # viola → magenta → arancio
N = 1024

def grad(t):
    for (a, ca), (b, cb) in zip(STOPS, STOPS[1:]):
        if t <= b:
            u = (t - a) / (b - a)
            return tuple(round(x + (y - x) * u) for x, y in zip(ca, cb))
    return STOPS[-1][1]

def base():
    # sfumatura diagonale, da in alto a sinistra a in basso a destra
    small = Image.new("RGB", (256, 256))
    px = small.load()
    for y in range(256):
        for x in range(256):
            px[x, y] = grad((x + y) / 510)
    img = small.resize((N, N), Image.BICUBIC)
    # bagliore morbido in alto a sinistra
    glow = Image.new("L", (N, N), 0)
    ImageDraw.Draw(glow).ellipse([-N * 0.25, -N * 0.35, N * 0.75, N * 0.55], fill=90)
    glow = glow.filter(ImageFilter.GaussianBlur(N * 0.12))
    img = Image.composite(Image.new("RGB", (N, N), (255, 255, 255)), img, glow)
    return img

def icon(size, glyph_ratio, rounded=False):
    img = base().convert("RGBA")
    font = ImageFont.truetype(FONT, round(N * glyph_ratio))
    d = ImageDraw.Draw(img)
    box = d.textbbox((0, 0), "$", font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    pos = ((N - w) / 2 - box[0], (N - h) / 2 - box[1])
    # ombra morbida sotto il simbolo
    shadow = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).text((pos[0], pos[1] + N * 0.025), "$", font=font, fill=(70, 0, 60, 110))
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(N * 0.02)))
    ImageDraw.Draw(img).text(pos, "$", font=font, fill="white")
    out = img.resize((size, size), Image.LANCZOS)
    if rounded:
        mask = Image.new("L", (size * 4, size * 4), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size * 4 - 1, size * 4 - 1], radius=size * 4 * 0.22, fill=255)
        out.putalpha(mask.resize((size, size), Image.LANCZOS))
        return out
    return out.convert("RGB")

icon(192, 0.66).save(f"{root}/public/icons/icon-192.png")
icon(512, 0.66).save(f"{root}/public/icons/icon-512.png")
icon(512, 0.48).save(f"{root}/public/icons/maskable-512.png")  # area sicura per il ritaglio di Android
icon(180, 0.66).save(f"{root}/src/app/apple-icon.png")          # iOS: quadrata, senza trasparenza
icon(64, 0.72, True).save(f"{root}/src/app/icon.png")
icon(512, 0.66).save(f"{sys.argv[2]}/icon-preview.png")
