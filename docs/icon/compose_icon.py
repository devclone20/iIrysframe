# Ícone macOS do iIrys Frame a partir do render 3/4 do rover 01 laranja.
#
# Formato Apple pós-Big Sur: canvas 1024 transparente, tile squircle de 824
# centrado. O squircle é uma superelipse (n≈5), não um rounded-rect — a
# diferença nota-se lado a lado com os ícones do sistema. Desenhado a 4×
# (4096) e reduzido com LANCZOS para arestas limpas.
from PIL import Image, ImageDraw, ImageFilter
import math, sys

SRC = sys.argv[1]
OUT = sys.argv[2]

S = 4                     # supersampling
CANVAS = 1024 * S
TILE = 824 * S
OFF = (CANVAS - TILE) // 2

def squircle_mask(size, n=5.0, steps=2048):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    a = size / 2
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        c, s_ = math.cos(t), math.sin(t)
        x = a + a * (abs(c) ** (2 / n)) * (1 if c >= 0 else -1)
        y = a + a * (abs(s_) ** (2 / n)) * (1 if s_ >= 0 else -1)
        pts.append((x, y))
    d.polygon(pts, fill=255)
    return m

# ── fundo do tile: carbono escuro com brilho quente atrás da cabeça ──────────
tile = Image.new("RGB", (TILE, TILE), (12, 12, 15))
grad = Image.new("L", (1, TILE))
for y in range(TILE):
    grad.putpixel((0, y), int(255 * (1 - y / TILE)))
grad = grad.resize((TILE, TILE))
top = Image.new("RGB", (TILE, TILE), (26, 26, 31))
tile = Image.composite(top, tile, grad)

glow = Image.new("RGB", (TILE, TILE), (0, 0, 0))
gd = ImageDraw.Draw(glow)
cx, cy, r = TILE // 2, int(TILE * 0.42), int(TILE * 0.36)
gd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(28, 14, 6))
glow = glow.filter(ImageFilter.GaussianBlur(TILE // 8))
tile = Image.blend(tile, Image.blend(tile, glow, 1.0).point(lambda p: p), 0.0)  # no-op keep
from PIL import ImageChops
tile = ImageChops.add(tile, glow)

# ── o robot ──────────────────────────────────────────────────────────────────
robot = Image.open(SRC).convert("RGBA")
W, H = robot.size
# recorte quadrado focado na cabeça: no render icon_34 a cabeça vive
# aproximadamente entre x 20-80%, y 15-75%; recorte com margem para os ombros
box = (int(W * 0.10), int(H * 0.10), int(W * 0.98), int(H * 0.98))
robot = robot.crop(box)
rw = int(TILE * 1.06)          # ligeiro bleed — os ombros são cortados pelo squircle
robot = robot.resize((rw, int(rw * robot.height / robot.width)), Image.LANCZOS)

# sombra suave do robot sobre o fundo, para assentar em vez de flutuar
alpha = robot.split()[3]
shadow = Image.new("RGBA", (TILE, TILE), (0, 0, 0, 0))
sx = (TILE - robot.width) // 2
sy = int(TILE * 0.06)
sh = Image.new("RGBA", robot.size, (0, 0, 0, 0))
sh.putalpha(alpha.point(lambda p: int(p * 0.55)))
shadow.paste(sh, (sx, sy + int(TILE * 0.025)), sh)
shadow = shadow.filter(ImageFilter.GaussianBlur(TILE // 60))

comp = tile.convert("RGBA")
comp.alpha_composite(shadow)
comp.alpha_composite(robot, (sx, sy))

# hairline interior para definição sobre fundos claros do Finder
ring = Image.new("RGBA", (TILE, TILE), (0, 0, 0, 0))
rd = ImageDraw.Draw(ring)
mask_ring = squircle_mask(TILE)
edge = mask_ring.filter(ImageFilter.MaxFilter(3))
inner = mask_ring.filter(ImageFilter.MinFilter(5))
outline = ImageChops.subtract(edge, inner)
ring.putalpha(outline.point(lambda p: int(p * 0.10)))
white = Image.new("RGBA", (TILE, TILE), (255, 255, 255, 255))
white.putalpha(ring.split()[3])
comp.alpha_composite(white)

# máscara squircle final
mask = squircle_mask(TILE)
tile_final = Image.new("RGBA", (TILE, TILE), (0, 0, 0, 0))
tile_final.paste(comp, (0, 0), mask)

canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
canvas.alpha_composite(tile_final, (OFF, OFF))
canvas = canvas.resize((1024, 1024), Image.LANCZOS)
canvas.save(OUT)
print("ok", OUT)
