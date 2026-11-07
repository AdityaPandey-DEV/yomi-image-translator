import os
from PIL import Image, ImageDraw, ImageFont

output_dir = '/Users/adityapandeydev/Desktop/CWS_Assets'
os.makedirs(output_dir, exist_ok=True)

# Helper function to find a system font
def get_font(size, bold=False):
    font_paths = [
        "/System/Library/Fonts/SFPro-Bold.otf" if bold else "/System/Library/Fonts/SFPro-Regular.otf",
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/Library/Fonts/Arial Bold.ttf" if bold else "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf"
    ]
    for p in font_paths:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()

# 1. Store Icon 128x128 (24-bit RGB PNG)
def create_store_icon():
    img = Image.new("RGB", (128, 128), color="#09090b")
    draw = ImageDraw.Draw(img)
    
    # Gradient badge
    draw.rounded_rectangle([14, 14, 114, 114], radius=26, fill="#f97316", outline="#ea580c", width=2)
    
    # Icon graphic (comic speech bubble)
    draw.rounded_rectangle([32, 34, 96, 84], radius=18, fill="#ffffff")
    draw.polygon([(46, 84), (40, 98), (62, 84)], fill="#ffffff")
    
    # Comic lines
    draw.line([(44, 52), (84, 52)], fill="#18181b", width=4)
    draw.line([(44, 66), (74, 66)], fill="#18181b", width=4)
    
    img.save(os.path.join(output_dir, "store_icon_128x128.png"), "PNG")
    print("Created store_icon_128x128.png")

# 2. Small Promo Tile (440x280) - JPEG or 24-bit PNG (no alpha)
def create_small_promo_tile():
    img = Image.new("RGB", (440, 280), color="#09090b")
    draw = ImageDraw.Draw(img)
    
    # Ambient background glow
    draw.ellipse([-50, -50, 250, 250], fill="#271b12")
    draw.ellipse([250, 100, 550, 400], fill="#1c1917")
    
    # App Icon
    draw.rounded_rectangle([40, 40, 110, 110], radius=18, fill="#f97316", outline="#ea580c", width=2)
    draw.rounded_rectangle([52, 52, 98, 88], radius=12, fill="#ffffff")
    draw.polygon([(60, 88), (56, 98), (72, 88)], fill="#ffffff")
    draw.line([(60, 64), (90, 64)], fill="#18181b", width=3)
    draw.line([(60, 76), (82, 76)], fill="#18181b", width=3)
    
    # Title
    font_title = get_font(22, bold=True)
    font_sub = get_font(13, bold=False)
    font_badge = get_font(11, bold=True)
    
    draw.text((40, 126), "Manga & Manhwa", fill="#ffffff", font=font_title)
    draw.text((40, 154), "Image Translator", fill="#f97316", font=font_title)
    draw.text((40, 192), "Instant In-Place AI Translation & Typesetting", fill="#a1a1aa", font=font_sub)
    draw.text((40, 212), "Japanese • Korean • Chinese Comics & Webtoons", fill="#71717a", font=font_sub)
    
    # Feature Badges
    draw.rounded_rectangle([40, 238, 145, 260], radius=6, fill="#27272a")
    draw.text((48, 242), "⚡ Gemini 3.8 Flash", fill="#fb923c", font=font_badge)
    
    draw.rounded_rectangle([155, 238, 230, 260], radius=6, fill="#27272a")
    draw.text((163, 242), "🔒 100% Free", fill="#34d399", font=font_badge)
    
    img.save(os.path.join(output_dir, "small_promo_tile_440x280.png"), "PNG")
    print("Created small_promo_tile_440x280.png")

# 3. Marquee Promo Tile (1400x560) - JPEG or 24-bit PNG (no alpha)
def create_marquee_promo_tile():
    img = Image.new("RGB", (1400, 560), color="#09090b")
    draw = ImageDraw.Draw(img)
    
    # Glowing ambient gradients
    draw.ellipse([-100, -100, 700, 700], fill="#25160b")
    draw.ellipse([800, 50, 1600, 750], fill="#181310")
    
    # Main Headline
    font_hero = get_font(52, bold=True)
    font_sub = get_font(22, bold=False)
    font_card = get_font(16, bold=True)
    font_card_sub = get_font(13, bold=False)
    
    # Icon
    draw.rounded_rectangle([100, 90, 210, 200], radius=28, fill="#f97316", outline="#ea580c", width=3)
    draw.rounded_rectangle([122, 114, 188, 164], radius=16, fill="#ffffff")
    draw.polygon([(136, 164), (130, 180), (154, 164)], fill="#ffffff")
    draw.line([(136, 132), (174, 132)], fill="#18181b", width=4)
    draw.line([(136, 148), (164, 148)], fill="#18181b", width=4)
    
    draw.text((100, 226), "Manga & Manhwa", fill="#ffffff", font=font_hero)
    draw.text((100, 290), "Image Translator AI", fill="#f97316", font=font_hero)
    draw.text((100, 368), "Read any Japanese, Korean, or Chinese raw chapter in English", fill="#d4d4d8", font=font_sub)
    draw.text((100, 404), "Powered by Google Gemini 3.8 Flash • In-place Comic Typesetting • Zero Lag", fill="#a1a1aa", font=font_sub)
    
    # Right-side visual cards
    # Raw Panel Card
    draw.rounded_rectangle([780, 80, 1050, 480], radius=20, fill="#18181b", outline="#27272a", width=2)
    draw.rounded_rectangle([780, 80, 1050, 130], radius=20, fill="#27272a")
    draw.text((800, 96), "RAW KOREAN SCAN", fill="#ef4444", font=font_card)
    draw.ellipse([820, 200, 1010, 340], fill="#ffffff", outline="#000000", width=3)
    draw.text((865, 255), "뭐, 잘 됐네.", fill="#000000", font=font_card)
    draw.text((810, 430), "Original Untranslated Panel", fill="#71717a", font=font_card_sub)
    
    # Arrow
    draw.polygon([(1070, 270), (1110, 280), (1070, 290)], fill="#f97316")
    
    # Translated Panel Card
    draw.rounded_rectangle([1120, 80, 1360, 480], radius=20, fill="#18181b", outline="#ea580c", width=2)
    draw.rounded_rectangle([1120, 80, 1360, 130], radius=20, fill="#ea580c")
    draw.text((1140, 96), "YOMI IN-PLACE AI", fill="#ffffff", font=font_card)
    draw.ellipse([1140, 200, 1340, 340], fill="#ffffff", outline="#000000", width=3)
    draw.text((1165, 255), "WELL, THAT'S GREAT!", fill="#000000", font=font_card)
    draw.text((1140, 430), "Typeset Seamlessly In-Place", fill="#34d399", font=font_card_sub)
    
    img.save(os.path.join(output_dir, "marquee_promo_tile_1400x560.png"), "PNG")
    print("Created marquee_promo_tile_1400x560.png")

# 4. Screenshot 1 (1280x800) - In-place translation demo
def create_screenshot_1():
    img = Image.new("RGB", (1280, 800), color="#09090b")
    draw = ImageDraw.Draw(img)
    
    font_heading = get_font(36, bold=True)
    font_sub = get_font(18, bold=False)
    font_bubble = get_font(20, bold=True)
    font_tag = get_font(13, bold=True)
    
    # Header bar
    draw.rectangle([0, 0, 1280, 100], fill="#121215")
    draw.text((50, 26), "Manga & Manhwa Image Translator", fill="#ffffff", font=font_heading)
    draw.text((50, 68), "Native In-Place Typesetting • Seamless Speech Bubble Inpainting", fill="#a1a1aa", font=font_sub)
    
    # Manga Reader Mockup
    draw.rounded_rectangle([50, 130, 820, 750], radius=16, fill="#18181b", outline="#27272a", width=2)
    
    # Manga Panel Content
    draw.rectangle([70, 150, 800, 730], fill="#27272a")
    
    # Bubble 1 (Light bubble with typeset English)
    draw.ellipse([140, 200, 460, 380], fill="#ffffff", outline="#000000", width=4)
    draw.text((200, 275), "ARE YOU READY?!", fill="#000000", font=font_bubble)
    
    # Bubble 2 (Dark dramatic bubble with white text)
    draw.ellipse([440, 420, 760, 620], fill="#141416", outline="#ffffff", width=3)
    draw.text((490, 505), "I WON'T HOLD BACK!!", fill="#ffffff", font=font_bubble)
    
    # Toggle Badge
    draw.rounded_rectangle([610, 680, 790, 715], radius=8, fill="#f97316")
    draw.text((625, 692), "⇄ Translated / Raw", fill="#ffffff", font=font_tag)
    
    # Right-side feature callouts
    features = [
        ("✨ Native Bounding Boxes", "Uses Gemini 3.8 visual grounding to place text exactly inside speech bubbles."),
        ("🎨 Smart Dark & Light Inpainting", "Detects dark dramatic bubbles and white dialogue bubbles automatically."),
        ("⚡ Ultra-Fast Paced Queue", "Translates pages seamlessly as you scroll with zero flickering."),
        ("🔒 100% Free & Private BYOK", "Runs directly on your browser with your own free Google Gemini API key.")
    ]
    
    y = 150
    for title, desc in features:
        draw.rounded_rectangle([860, y, 1230, y + 120], radius=14, fill="#141417", outline="#27272a", width=1)
        draw.text((880, y + 20), title, fill="#fb923c", font=get_font(18, bold=True))
        
        # Word wrap desc
        words = desc.split(" ")
        line1 = " ".join(words[:6])
        line2 = " ".join(words[6:])
        draw.text((880, y + 54), line1, fill="#d4d4d8", font=get_font(14, bold=False))
        if line2:
            draw.text((880, y + 76), line2, fill="#d4d4d8", font=get_font(14, bold=False))
        y += 145

    img.save(os.path.join(output_dir, "screenshot_1_1280x800.png"), "PNG")
    print("Created screenshot_1_1280x800.png")

# 5. Screenshot 2 (1280x800) - Extension Popup & Settings
def create_screenshot_2():
    img = Image.new("RGB", (1280, 800), color="#09090b")
    draw = ImageDraw.Draw(img)
    
    font_heading = get_font(36, bold=True)
    font_sub = get_font(18, bold=False)
    
    draw.rectangle([0, 0, 1280, 100], fill="#121215")
    draw.text((50, 26), "Customizable Translation & AI Models", fill="#ffffff", font=font_heading)
    draw.text((50, 68), "Powered by Gemini 3.8 Flash • 20+ Languages • Free Private BYOK", fill="#a1a1aa", font=font_sub)
    
    # Popup Mockup in center
    draw.rounded_rectangle([440, 140, 840, 740], radius=18, fill="#141417", outline="#f97316", width=2)
    
    # Popup Header
    draw.rounded_rectangle([470, 170, 510, 210], radius=10, fill="#f97316")
    draw.text((530, 172), "Manga & Manhwa", fill="#ffffff", font=get_font(18, bold=True))
    draw.text((530, 196), "Image Translator AI v1.0", fill="#a1a1aa", font=get_font(12, bold=False))
    
    # Toggle row
    draw.text((470, 240), "Auto-Translate on Scroll", fill="#e4e4e7", font=get_font(14, bold=True))
    draw.rounded_rectangle([750, 238, 800, 262], radius=12, fill="#f97316")
    draw.ellipse([776, 240, 798, 260], fill="#ffffff")
    
    # Target Language
    draw.text((470, 290), "Target Language", fill="#a1a1aa", font=get_font(13, bold=False))
    draw.rounded_rectangle([470, 314, 810, 354], radius=8, fill="#27272a", outline="#3f3f46", width=1)
    draw.text((490, 326), "🇺🇸 English", fill="#ffffff", font=get_font(14, bold=True))
    
    # Model selector
    draw.text((470, 380), "AI Vision Model", fill="#a1a1aa", font=get_font(13, bold=False))
    draw.rounded_rectangle([470, 404, 810, 444], radius=8, fill="#27272a", outline="#f97316", width=1)
    draw.text((490, 416), "⚡ Gemini 3.8 Flash (Recommended)", fill="#fb923c", font=get_font(13, bold=True))
    
    # API key
    draw.text((470, 470), "Google Gemini API Key (BYOK)", fill="#a1a1aa", font=get_font(13, bold=False))
    draw.rounded_rectangle([470, 494, 810, 534], radius=8, fill="#27272a", outline="#3f3f46", width=1)
    draw.text((490, 508), "••••••••••••••••••••••••••••••••••••", fill="#71717a", font=get_font(14, bold=False))
    
    # Save button
    draw.rounded_rectangle([470, 560, 810, 606], radius=10, fill="#f97316")
    draw.text((600, 574), "Save Settings", fill="#ffffff", font=get_font(15, bold=True))
    
    # Open Web Studio button
    draw.rounded_rectangle([470, 620, 810, 666], radius=10, fill="#27272a", outline="#3f3f46", width=1)
    draw.text((580, 634), "Open Web Studio", fill="#d4d4d8", font=get_font(14, bold=True))

    img.save(os.path.join(output_dir, "screenshot_2_1280x800.png"), "PNG")
    print("Created screenshot_2_1280x800.png")

if __name__ == '__main__':
    create_store_icon()
    create_small_promo_tile()
    create_marquee_promo_tile()
    create_screenshot_1()
    create_screenshot_2()
    print("All Chrome Web Store assets successfully generated in:", output_dir)

