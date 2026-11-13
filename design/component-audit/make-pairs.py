"""Side-by-side evidence pairs for the component audit: Figma on the left, Verynize (after phase B1) on the right.

Each pair scales both captures to one height, puts a caption bar above each half and writes
design/component-audit/pairs-after/<name>.png. Needs Pillow.

    python3 design/component-audit/make-pairs.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
OUT = HERE / "pairs-after"
HEIGHT = 1100  # px of each capture in the pair
GAP = 24
BAR = 56
BG = (24, 24, 24)
INK = (232, 232, 232)

# name: (figma capture, verynize capture, caption)
PAIRS = {
    "01-main-instance-layers": ("figma/25-instance-variant.png", "verynize/after/01-layers-main-instance.png",
                                "Main + instances in Layers and on canvas"),
    "02-slot-bound": ("figma/09-slot-bound.png", "verynize/after/07-slot-selected.png", "A bound slot, selected"),
    "03-header-edit-preserves-slots": ("figma/18-header-update-preserves-slots.png",
                                       "verynize/after/06-shell-after-edit.png",
                                       "Header edit on the main; each instance keeps its own slot content"),
    "04-before-header-edit": ("figma/17-different-slot-content.png", "verynize/after/05-shell-before-edit.png",
                              "Two instances with different slot content, before the header edit"),
    "05-instance-actions": ("figma/12-instance-actions.png", "verynize/after/08-instance-menu.png",
                            "Instance actions (Detach, Reset, Go to main)"),
    "06-instance-inspector": ("figma/25-instance-variant.png", "verynize/after/03-inspector-instance.png",
                              "Instance inspector with a Modified slot"),
    "07-components-panel": ("pen/10-components-panel.png", "verynize/after/04-components-panel.png",
                            "Components panel (Pen left)"),
}


def font(size):
    for name in ("/System/Library/Fonts/SFNS.ttf", "/System/Library/Fonts/Helvetica.ttc",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def fit(path):
    im = Image.open(HERE / path).convert("RGB")
    return im.resize((round(im.width * HEIGHT / im.height), HEIGHT), Image.LANCZOS)


def pair(name, left, right, caption):
    a, b = fit(left), fit(right)
    left_label = "Pen" if left.startswith("pen/") else "Figma"
    width = a.width + GAP + b.width
    sheet = Image.new("RGB", (width, BAR * 2 + HEIGHT), BG)
    draw = ImageDraw.Draw(sheet)
    draw.text((16, 12), caption, fill=INK, font=font(30))
    draw.text((16, BAR + 12), f"{left_label} · {left}", fill=INK, font=font(24))
    draw.text((a.width + GAP + 16, BAR + 12), f"Verynize · {right}", fill=INK, font=font(24))
    sheet.paste(a, (0, BAR * 2))
    sheet.paste(b, (a.width + GAP, BAR * 2))
    OUT.mkdir(exist_ok=True)
    sheet.save(OUT / f"{name}.png", optimize=True)
    print("wrote", OUT / f"{name}.png")


if __name__ == "__main__":
    for key, (left, right, caption) in PAIRS.items():
        pair(key, left, right, caption)
