"""Gera desktop/build/icon.png (512x512): fundo preto, círculo branco com gota preta. Só biblioteca padrão."""
import math
import os
import struct
import zlib

N = 512
rows = []
cx = cy = N / 2
for y in range(N):
    row = bytearray([0])
    for x in range(N):
        dx, dy = x - cx, y - cy
        d = math.hypot(dx, dy)
        # fundo preto, disco branco r=210
        v = 255 if d <= 210 else 17
        # gota preta: círculo embaixo + triângulo em cima
        gy = dy - 40
        in_drop = (math.hypot(dx, gy) <= 85) or (-150 <= dy - 40 <= 0 and abs(dx) <= 85 * (1 - (-(dy - 40)) / 150 * 1.0) and (dy - 40) >= -150)
        if d <= 210 and in_drop:
            v = 17
        row += bytes([v, v, v, 255])
    rows.append(bytes(row))
raw = b"".join(rows)


def chunk(t, data):
    c = struct.pack(">I", len(data)) + t + data
    return c + struct.pack(">I", zlib.crc32(t + data) & 0xFFFFFFFF)


png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", N, N, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
out = os.path.join(os.path.dirname(__file__), "..", "build", "icon.png")
os.makedirs(os.path.dirname(out), exist_ok=True)
open(out, "wb").write(png)
print("icon.png gerado:", len(png), "bytes")
