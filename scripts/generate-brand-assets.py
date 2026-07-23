"""One-off generator for NovaCast app icon / adaptive-icon / favicon / iOS icon /
Fire TV banner assets, sourced from the real brand mark `assets/images/NCnoword.png`
(planet + orbital ring + chrome N/V chevron, true alpha transparency).

Run from repo root: python scripts/generate-brand-assets.py
Requires Pillow (PIL) only - no numpy/sharp/ImageMagick dependency.
"""

import os
from PIL import Image, ImageDraw, ImageFont

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_DIR = os.path.join(REPO, "assets", "images")

BRAND_BG = (0x07, 0x09, 0x0D)  # matches app.json backgroundColor / adaptiveIcon.backgroundColor
GRADIENT_CENTER = (0x22, 0x14, 0x3A)  # subtle dark purple glow for background layer/banner
FALLBACK_MONO = os.path.join(
    os.path.expanduser("~"),
    ".cursor", "projects", "c-Users-tonyl-Desktop-novacast-v2", "assets",
    "novacast-app-icon-monochrome.png",
)


def load_mark():
    """Load NCnoword.png and return it tightly cropped to its opaque bbox."""
    im = Image.open(os.path.join(IMG_DIR, "NCnoword.png")).convert("RGBA")
    bbox = im.split()[-1].getbbox()
    return im.crop(bbox)


def fit_mark(mark, canvas_size, safe_fraction):
    """Resize `mark` (RGBA, tightly cropped) to fit within safe_fraction of canvas_size,
    preserving aspect ratio. Returns (resized_mark, (paste_x, paste_y))."""
    target = int(round(canvas_size * safe_fraction))
    scale = target / max(mark.width, mark.height)
    new_w = max(1, int(round(mark.width * scale)))
    new_h = max(1, int(round(mark.height * scale)))
    resized = mark.resize((new_w, new_h), Image.LANCZOS)
    x = (canvas_size - new_w) // 2
    y = (canvas_size - new_h) // 2
    return resized, (x, y)


def compose(mark, canvas_size, safe_fraction, bg_color):
    """Compose mark onto a square canvas. bg_color=None -> transparent canvas."""
    if bg_color is None:
        canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    else:
        canvas = Image.new("RGBA", (canvas_size, canvas_size), bg_color + (255,))
    resized, pos = fit_mark(mark, canvas_size, safe_fraction)
    canvas.alpha_composite(resized, pos)
    return canvas


def radial_gradient(width, height, center_color, edge_color, center_xy_frac=(0.5, 0.5)):
    """Smooth radial gradient built at low-res then upscaled (no numpy needed)."""
    small_w, small_h = 128, max(1, int(128 * height / width))
    grad = Image.new("RGB", (small_w, small_h))
    cx, cy = small_w * center_xy_frac[0], small_h * center_xy_frac[1]
    max_dist = ((max(cx, small_w - cx)) ** 2 + (max(cy, small_h - cy)) ** 2) ** 0.5
    px = grad.load()
    for yy in range(small_h):
        for xx in range(small_w):
            d = ((xx - cx) ** 2 + (yy - cy) ** 2) ** 0.5
            t = min(1.0, d / max_dist)
            r = round(center_color[0] + (edge_color[0] - center_color[0]) * t)
            g = round(center_color[1] + (edge_color[1] - center_color[1]) * t)
            b = round(center_color[2] + (edge_color[2] - center_color[2]) * t)
            px[xx, yy] = (r, g, b)
    return grad.resize((width, height), Image.LANCZOS)


def make_monochrome_from_mark(mark_full_alpha, canvas_size, safe_fraction, threshold=128):
    """Derive a white-on-transparent silhouette directly from NCnoword's own alpha
    channel. NOTE: in practice this produces an indistinct blob (the planet's soft
    glow/shading has broad semi-opaque coverage that thresholds into a shapeless mass,
    not a recognizable "N"), so it is kept only for visual comparison and is NOT used
    as the final monochrome asset. See make_monochrome_from_fallback() instead."""
    alpha = mark_full_alpha.split()[-1]
    bbox = alpha.getbbox()
    cropped_alpha = alpha.crop(bbox)
    thresholded = cropped_alpha.point(lambda p: 255 if p >= threshold else 0)
    white_rgba = Image.new("RGBA", cropped_alpha.size, (255, 255, 255, 255))
    white_rgba.putalpha(thresholded)
    return compose(white_rgba, canvas_size, safe_fraction, None)


def make_monochrome_from_fallback(canvas_size, safe_fraction, threshold=128):
    """Clean, crisp "N" silhouette from the earlier pre-approved flat white-on-black
    generated image. Used as the FINAL monochrome asset since it is far more legible
    than anything thresholded out of NCnoword's own soft/glowing alpha channel."""
    im = Image.open(FALLBACK_MONO).convert("L")
    bbox_mask = im.point(lambda p: 255 if p >= threshold else 0)
    bbox = bbox_mask.getbbox()
    cropped_mask = bbox_mask.crop(bbox)
    white_rgba = Image.new("RGBA", cropped_mask.size, (255, 255, 255, 255))
    white_rgba.putalpha(cropped_mask)
    return compose(white_rgba, canvas_size, safe_fraction, None)


def pick_font(size):
    for candidate in ("arialbd.ttf", "seguisb.ttf", "segoeuib.ttf"):
        path = os.path.join("C:\\Windows\\Fonts", candidate)
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def make_banner(mark, width, height):
    bg = radial_gradient(width, height, GRADIENT_CENTER, BRAND_BG, center_xy_frac=(0.38, 0.5))
    canvas = bg.convert("RGBA")

    margin = int(width * 0.05)
    mark_h = int(height * 0.60)
    scale = mark_h / mark.height
    mark_w = int(mark.width * scale)
    mark_resized = mark.resize((mark_w, mark_h), Image.LANCZOS)
    mark_y = (height - mark_h) // 2
    mark_x = margin
    canvas.alpha_composite(mark_resized, (mark_x, mark_y))

    text_x = mark_x + mark_w + int(width * 0.04)
    right_margin = int(width * 0.05)
    available_width = width - text_x - right_margin

    draw = ImageDraw.Draw(canvas)
    word1, word2 = "NOVA", "CAST"
    full_word = word1 + word2

    font_size = int(height * 0.30)
    font = pick_font(font_size)
    measured = draw.textbbox((0, 0), full_word, font=font)
    measured_w = measured[2] - measured[0]
    if measured_w > available_width:
        font_size = max(10, int(font_size * available_width / measured_w))
        font = pick_font(font_size)

    bbox1 = draw.textbbox((0, 0), word1, font=font)
    bbox2 = draw.textbbox((0, 0), word2, font=font)
    w1 = bbox1[2] - bbox1[0]
    total_h = max(bbox1[3] - bbox1[1], bbox2[3] - bbox2[1])
    text_y = (height - total_h) // 2 - bbox1[1]

    draw.text((text_x, text_y), word1, font=font, fill=(240, 244, 255, 255))
    draw.text((text_x + w1, text_y), word2, font=font, fill=(90, 150, 255, 255))

    return canvas


def main():
    mark_full = Image.open(os.path.join(IMG_DIR, "NCnoword.png")).convert("RGBA")
    mark = load_mark()

    # 1. icon.png (1024x1024) - mark composited onto opaque brand background.
    icon = compose(mark, 1024, 0.80, BRAND_BG)
    icon.save(os.path.join(IMG_DIR, "icon.png"))
    print("icon.png", icon.size, icon.mode)

    # 2. favicon.png - match existing 48x48 dimensions.
    favicon = icon.resize((48, 48), Image.LANCZOS)
    favicon.save(os.path.join(IMG_DIR, "favicon.png"))
    print("favicon.png", favicon.size, favicon.mode)

    # 3. android-icon-foreground.png (512x512) - true transparency, safe-zone scaled.
    foreground = compose(mark, 512, 0.62, None)
    foreground.save(os.path.join(IMG_DIR, "android-icon-foreground.png"))
    print("android-icon-foreground.png", foreground.size, foreground.mode)

    # 4. android-icon-background.png (512x512) - plain gradient, no mark.
    background = radial_gradient(512, 512, GRADIENT_CENTER, BRAND_BG)
    background = background.convert("RGBA")
    background.save(os.path.join(IMG_DIR, "android-icon-background.png"))
    print("android-icon-background.png", background.size, background.mode)

    # 5. android-icon-monochrome.png (432x432).
    # Direct extraction from NCnoword's own alpha channel was tried and rejected: the
    # planet's soft glow/shading has broad semi-opaque coverage that thresholds into an
    # indistinct blob, not a recognizable "N". Using the pre-approved flat silhouette
    # fallback instead, converted to real alpha transparency (documented tradeoff).
    mono = make_monochrome_from_fallback(432, 0.62)
    mono.save(os.path.join(IMG_DIR, "android-icon-monochrome.png"))
    print("android-icon-monochrome.png", mono.size, mono.mode, "(fallback silhouette, alpha-extracted)")

    # 6. iOS plain PNG icon (opaque, no alpha) - 1024x1024.
    ios_icon = compose(mark, 1024, 0.80, BRAND_BG).convert("RGB")
    ios_icon.save(os.path.join(IMG_DIR, "ios-icon.png"))
    print("ios-icon.png", ios_icon.size, ios_icon.mode)

    # 7. Fire TV / Android TV banner (3 densities, exact 16:9).
    banner_1280 = make_banner(mark, 1280, 720)
    out_dir = os.path.join(REPO, "assets", "images")
    banner_1280.convert("RGB").save(os.path.join(out_dir, "tv-banner-xhdpi.png"))
    banner_1280.resize((960, 540), Image.LANCZOS).convert("RGB").save(
        os.path.join(out_dir, "tv-banner-hdpi.png")
    )
    banner_1280.resize((640, 360), Image.LANCZOS).convert("RGB").save(
        os.path.join(out_dir, "tv-banner-mdpi.png")
    )
    print("tv-banner-xhdpi.png (1280x720), tv-banner-hdpi.png (960x540), tv-banner-mdpi.png (640x360)")


if __name__ == "__main__":
    main()
