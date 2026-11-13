"""Makes the four pictures the library's room is built from.

`marble.webp` is one slab of white marble with gold veins. The gold is the stone's own; the picture
is only cut to the slab's shape and set a little under paper white.
`walnut.webp` is a tile of dark stained rosewood that repeats in both directions, its grain running
across.
`post.webp` is a strip of the same wood with the grain running up, for the standards of the case
and the panelling of the wall.
`gilt.webp` is that same tile with gold leaf laid on it: the leaf takes the grain, and the pores
stay dark, so lettering cut from it carries the grain of the wood around it.

Both start from CC0 pictures (named in THIRD-PARTY.md):
  marble  https://www.sharetextures.com/textures/floor/marble-107   the base colour map, 4K
  wood    https://polyhaven.com/a/rosewood_veneer_02                the 2K diffuse map

Run with Pillow and NumPy installed:
  python tools/make_room.py <marble colour map> <wood diffuse map>
Writes into eastroom/web/room.
"""

import sys
from pathlib import Path

import numpy as np
from numpy.typing import NDArray
from PIL import Image

Light = NDArray[np.float64]  # a picture in linear light, 0 to 1

OUT = Path(__file__).parents[1] / "eastroom" / "web" / "room"
SLAB = (3200, 900)  # px; the widest slab the page lays is 2400 CSS px
TOP = 0.0  # where in the picture the slab is cut, as a share of its height; it takes the full width
# a warm white, kept under paper white so the words and the gold both read on it
STONE = np.array([0.88, 0.86, 0.835])
RICH = 1.5  # how much more colour the veins carry than in the picture: its gold is pale
STAIN = np.array([0.17, 0.062, 0.032])  # the rosewood is stained down to walnut
LEAF = np.array([0.64, 0.39, 0.095])  # gold leaf where it lies on the wood's high grain
PORES = 0.36  # how much of the leaf's light is left in the deepest pores


def linear(path: str) -> Light:
    srgb = np.asarray(Image.open(path).convert("RGB"), dtype=np.float64) / 255
    return np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)


def save(light: Light, name: str, quality: int) -> None:
    light = np.clip(light, 0, 1)
    srgb = np.where(light <= 0.0031308, light * 12.92, 1.055 * light ** (1 / 2.4) - 0.055)
    Image.fromarray((srgb * 255 + 0.5).astype(np.uint8)).save(OUT / name, quality=quality, method=6)


def marble(scan: Light) -> Light:
    """One piece of the stone, as wide as the picture: nothing is mirrored or repeated."""
    side = scan.shape[1]
    top, high = round(side * TOP), round(side * SLAB[1] / SLAB[0])
    part = scan[top : top + high]
    channels = [
        np.asarray(
            Image.fromarray(part[..., c].astype(np.float32), "F").resize(
                SLAB, Image.Resampling.LANCZOS
            ),
            dtype=np.float64,
        )
        for c in range(3)
    ]
    slab: Light = np.stack(channels, axis=2)
    grey: Light = slab.mean(axis=2, keepdims=True)
    slab = grey + (slab - grey) * RICH
    ground = float(np.percentile(grey, 80))  # the stone's own white
    return slab / ground * STONE


def walnut(scan: Light) -> Light:
    grain = scan.mean(axis=2)
    grain = (grain / grain.mean()) ** 1.7
    tile = Image.fromarray(grain.astype(np.float32), "F").resize(
        (1024, 1024), Image.Resampling.LANCZOS
    )
    return np.asarray(tile, dtype=np.float64)[..., None] * STAIN


def gilt(scan: Light) -> Light:
    """The walnut tile under gold leaf: bright on the high grain, dark where the pores stay open."""
    grain: Light = walnut(scan)[..., 0] / STAIN[0]
    lit: Light = np.clip(grain / float(np.percentile(grain, 75)), 0, 1.12)
    leaf: Light = (PORES + (1 - PORES) * lit**1.4)[..., None] * LEAF
    return leaf


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    save(marble(linear(sys.argv[1])), "marble.webp", 82)
    wood = walnut(linear(sys.argv[2]))
    save(wood, "walnut.webp", 78)
    save(np.rot90(wood[:256]), "post.webp", 78)
    save(gilt(linear(sys.argv[2])), "gilt.webp", 60)
