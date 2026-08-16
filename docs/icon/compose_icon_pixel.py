# Ícone iIrys Frame v2 — a foto que o dono enviou (frame 0 do i_01_iclone.GIF),
# fundo BRANCO, tile squircle Apple com hairline.
#
# O look pixelado é intencional (é a foto pedida): o robot sobe por NEAREST
# para manter os pixels crisp; só o squircle e a borda são desenhados a 4× e
# reduzidos, para as arestas do tile ficarem limpas.
from PIL import Image, ImageDraw, ImageChops
import math, sys

GIF = sys.argv[1]
OUT = sys.argv[2]

S = 4
FINAL = 1024
TILE = 824
OFF = (FINAL - TILE) // 2

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

# máscara e hairline nítidas: desenhadas a 4× e reduzidas
big = squircle_mask(TILE * S)
mask = big.resize((TILE, TILE), Image.LANCZOS)
inner = squircle_mask(TILE * S).resize((TILE - 2 * 3, TILE - 2 * 3), Image.LANCZOS)
inner_pad = Image.new("L", (TILE, TILE), 0)
inner_pad.paste(inner, (3, 3))
outline = ImageChops.subtract(mask, inner_pad)        # anel de ~3px

# ── o robot: frame 0 do GIF, alpha real, recorte ao conteúdo ─────────────────
g = Image.open(GIF)
g.seek(0)
robot = g.convert("RGBA")
bbox = robot.split()[3].getbbox()
robot = robot.crop(bbox)
# NEAREST mantém o pixel-art crisp; altura ≈ 74% do tile
target_h = int(TILE * 0.74)
scale = target_h / robot.height
robot = robot.resize((int(robot.width * scale), target_h), Image.NEAREST)

# ── composição ───────────────────────────────────────────────────────────────
tile = Image.new("RGBA", (TILE, TILE), (255, 255, 255, 255))
rx = (TILE - robot.width) // 2
ry = (TILE - robot.height) // 2
tile.alpha_composite(robot, (rx, ry))

# hairline cinzenta subtil (padrão Apple para ícones claros)
border = Image.new("RGBA", (TILE, TILE), (0, 0, 0, 0))
gray = Image.new("RGBA", (TILE, TILE), (60, 60, 67, 255))
border.paste(gray, (0, 0), outline.point(lambda p: int(p * 0.18)))
tile.alpha_composite(border)

# recorte squircle final
clipped = Image.new("RGBA", (TILE, TILE), (0, 0, 0, 0))
clipped.paste(tile, (0, 0), mask)

canvas = Image.new("RGBA", (FINAL, FINAL), (0, 0, 0, 0))
canvas.alpha_composite(clipped, (OFF, OFF))
canvas.save(OUT)
print("ok", OUT, "robot", robot.size)
