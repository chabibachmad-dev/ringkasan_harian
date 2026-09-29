"""Generate simple app icons for the PWA (no external assets needed).
Monokrom hitam/putih (gaya "Snail OS") -- tanpa warna sama sekali, termasuk
tanpa titik notifikasi oranye/emas seperti versi sebelumnya."""
from PIL import Image, ImageDraw

OUT_DIR = "/home/claude/ringkasan_harian/public/icons"

BLACK = (0, 0, 0, 255)
WHITE = (255, 255, 255, 255)


def make_icon(size: int, path: str, maskable: bool = False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    pad = int(size * 0.08) if maskable else 0
    draw.rounded_rectangle(
        [pad, pad, size - pad, size - pad],
        radius=int(size * 0.22),
        fill=BLACK,
    )

    # "Paper" card -- putih polos di atas latar hitam.
    card_margin = size * 0.24
    card = [card_margin, card_margin * 1.05, size - card_margin * 0.72, size - card_margin * 0.62]
    draw.rounded_rectangle(card, radius=size * 0.04, fill=WHITE)

    # Baris teks di atas kertas -- hitam di atas putih, murni monokrom.
    x0 = card[0] + size * 0.06
    x1 = card[2] - size * 0.06
    y = card[1] + size * 0.09
    line_h = size * 0.045
    gap = size * 0.075
    widths = [1.0, 0.85, 0.9, 0.6]
    for w in widths:
        draw.rounded_rectangle(
            [x0, y, x0 + (x1 - x0) * w, y + line_h],
            radius=line_h / 2,
            fill=BLACK,
        )
        y += gap

    img.save(path)


if __name__ == "__main__":
    import os

    os.makedirs(OUT_DIR, exist_ok=True)
    make_icon(192, f"{OUT_DIR}/icon-192.png")
    make_icon(512, f"{OUT_DIR}/icon-512.png")
    make_icon(512, f"{OUT_DIR}/icon-maskable-512.png", maskable=True)
    print("Icons generated.")
