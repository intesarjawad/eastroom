"""Draws East Room's icons: its first letter under the reading light, in the reading face and
the default colours of the app.

Run with Pillow installed:  python tools/make_icons.py
Writes favicon.ico, icon-180.png, icon-192.png, icon-512.png and
icon-maskable-512.png into eastroom/web.
"""

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

WEB = Path(__file__).parents[1] / "eastroom" / "web"
GROUND, DEEP, ACCENT = "#530108", "#250102", "#91c1ff"  # the same values as :root in reader.css
N = 1024  # drawn large, then reduced


def mark(light: float, corner: float, small: bool = False) -> Image.Image:
    """`light` is the share of the tile the light takes, `corner` the
    tile's corner (0 fills the square).

    Small sizes get the face's small optical size at a heavier weight and no
    glow: the cut made for tiny text.
    """
    tile = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    ImageDraw.Draw(tile).rounded_rectangle([0, 0, N - 1, N - 1], N * corner, fill=GROUND)
    inside = tile.getchannel("A")

    def laid(layer: Image.Image) -> None:  # nothing may spill past the tile's own corners
        layer.putalpha(ImageChops.multiply(layer.getchannel("A"), inside))
        tile.alpha_composite(layer)

    shade = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    ImageDraw.Draw(shade).rectangle([0, N * 0.55, N, N], fill=DEEP)
    laid(shade.filter(ImageFilter.GaussianBlur(N * 0.22)))
    edge = N * (1 - light) / 2
    box = [edge, edge * 0.86, N - edge, N - edge * 0.86]
    if not small:
        glow = Image.new("RGBA", (N, N), (0, 0, 0, 0))
        ImageDraw.Draw(glow).rounded_rectangle(box, N * light * 0.2, fill=(145, 193, 255, 130))
        laid(glow.filter(ImageFilter.GaussianBlur(N * 0.055)))
    draw = ImageDraw.Draw(tile)
    draw.rounded_rectangle(box, N * light * 0.2, fill=ACCENT)
    face = ImageFont.truetype(
        str(WEB / "fonts" / "Literata.woff2"), int(N * light * (1.0 if small else 0.98))
    )
    face.set_variation_by_axes([7, 850] if small else [72, 650])  # optical size, weight
    left, top, right, bottom = draw.textbbox((0, 0), "E", font=face)
    draw.text(
        ((N - (right - left)) / 2 - left, (N - (bottom - top)) / 2 - top), "E", font=face, fill=DEEP
    )
    return tile


def main() -> None:
    tab = mark(0.8, 0.2, small=True)
    sizes = [tab.resize((s, s), Image.Resampling.LANCZOS) for s in (48, 32, 16)]
    sizes[0].save(
        WEB / "favicon.ico", sizes=[(48, 48), (32, 32), (16, 16)], append_images=sizes[1:]
    )
    rounded = mark(0.62, 0.22)
    for size in (192, 512):
        rounded.resize((size, size), Image.Resampling.LANCZOS).save(
            WEB / f"icon-{size}.png", optimize=True
        )
    square = mark(0.62, 0)  # the phone cuts its own corners
    square.resize((180, 180), Image.Resampling.LANCZOS).convert("RGB").save(
        WEB / "icon-180.png", optimize=True
    )
    mark(0.52, 0).resize((512, 512), Image.Resampling.LANCZOS).convert("RGB").save(
        WEB / "icon-maskable-512.png", optimize=True
    )  # all of it inside the safe circle


if __name__ == "__main__":
    main()
