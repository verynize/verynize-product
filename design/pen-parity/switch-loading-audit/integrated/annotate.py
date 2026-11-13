# Adds an address-bar strip with the page's real location.href (from urls-*.json) above each screenshot.
import json, pathlib
from PIL import Image, ImageDraw, ImageFont
here = pathlib.Path(__file__).parent
font_path = "/System/Library/Fonts/SFNSMono.ttf"
for manifest in ["urls-desktop.json", "urls-web.json"]:
    for name, url in json.loads((here / manifest).read_text()).items():
        shot = Image.open(here / f"{name}.png").convert("RGB")
        scale = shot.width / 1440
        bar = int(44 * scale)
        font = ImageFont.truetype(font_path, int(17 * scale))
        out = Image.new("RGB", (shot.width, shot.height + bar), (12, 12, 14))
        out.paste(shot, (0, bar))
        draw = ImageDraw.Draw(out)
        pad = int(10 * scale)
        draw.rounded_rectangle([pad, pad // 1.5, shot.width - pad, bar - pad // 1.5], radius=int(12 * scale), fill=(38, 38, 42))
        draw.text((pad * 2.5, bar / 2), "URL  " + url, font=font, fill=(235, 235, 235), anchor="lm")
        (here / "annotated").mkdir(exist_ok=True)
        out.save(here / "annotated" / f"{name}.png", optimize=True)
        print(name)
