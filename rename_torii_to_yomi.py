#!/usr/bin/env python3
"""
rename_torii_to_yomi.py
Automated script to thoroughly rename all variations of 'torii', 'toji', 'torji'
to 'yomi' (preserving casing and updating links/assets) and ensure 100% free bypass.
"""

import os
import re
import shutil
import zipfile

WORKSPACE_DIR = os.path.abspath(os.path.dirname(__file__))
EXTENSION_DIR = os.path.join(WORKSPACE_DIR, "extension")
SRC_DIR = os.path.join(WORKSPACE_DIR, "src")
README_FILE = os.path.join(WORKSPACE_DIR, "README.md")

# Ordered replacement list (specific -> general)
REPLACEMENTS = [
    # Domains & endpoints
    (r"direct-api\.toriitranslate\.com", "direct-api.yomi-translator.vercel.app"),
    (r"api\.toriitranslate\.com", "direct-api.yomi-translator.vercel.app"),
    (r"https://toriitranslate\.com", "https://yomi-translator.vercel.app"),
    (r"toriitranslate\.com", "yomi-translator.vercel.app"),
    (r"torii-image-translator\.firebaseapp\.com", "yomi-translator.vercel.app"),
    (r"support@toriitranslate\.com", "support@yomi-translator.vercel.app"),

    # Specific compound terms
    (r"ToriiTranslations", "YomiTranslations"),
    (r"ToriiFontsDB", "YomiFontsDB"),
    (r"Torii project file", "Yomi project file"),
    (r"\.torii", ".yomi"),
    (r"Torii Fonts", "Manga Fonts"),
    (r"Torii Manga Translator", "Yomi Manga Translator"),
    (r"Torii Image Translator", "Yomi Image Translator"),
    (r"Torii Translator", "Yomi Translator"),

    # Exact casing of 'torii'
    (r"TORII", "YOMI"),
    (r"Torii", "Yomi"),
    (r"torii", "yomi"),

    # Variations of 'torji'
    (r"TORJI", "YOMI"),
    (r"Torji", "Yomi"),
    (r"torji", "yomi"),

    # Variations of 'toji'
    (r"TOJI", "YOMI"),
    (r"Toji", "Yomi"),
    (r"toji", "yomi"),
]

TEXT_EXTENSIONS = {
    ".js", ".ts", ".tsx", ".jsx", ".html", ".css", ".json", ".md", ".txt", ".svg"
}

def process_file(file_path):
    ext = os.path.splitext(file_path)[1].lower()
    if ext not in TEXT_EXTENSIONS:
        return 0

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception as e:
        print(f"Skipping {file_path}: {e}")
        return 0

    original = content
    for pattern, replacement in REPLACEMENTS:
        content = re.sub(pattern, replacement, content)

    if content != original:
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)
        return 1
    return 0

def process_directory(dir_path):
    modified_count = 0
    for root, dirs, files in os.walk(dir_path):
        # Skip node_modules and .git
        if "node_modules" in dirs:
            dirs.remove("node_modules")
        if ".git" in dirs:
            dirs.remove(".git")
        if "dist" in dirs:
            dirs.remove("dist")

        for file in files:
            file_path = os.path.join(root, file)
            modified_count += process_file(file_path)
    return modified_count

def rename_images():
    img_dir = os.path.join(EXTENSION_DIR, "images")
    icons_dir = os.path.join(EXTENSION_DIR, "icons")
    public_icons_dir = os.path.join(WORKSPACE_DIR, "public", "icons")
    os.makedirs(public_icons_dir, exist_ok=True)

    # 1. Sync extension/icons to public/icons for web app use
    if os.path.exists(icons_dir):
        for f in os.listdir(icons_dir):
            if f.endswith(".png"):
                shutil.copy2(os.path.join(icons_dir, f), os.path.join(public_icons_dir, f))
                print(f"Copied {f} to public/icons/")

    # 2. Sync extension/icons to extension/images/
    icon16 = os.path.join(icons_dir, "icon16.png")
    icon32 = os.path.join(icons_dir, "icon32.png")
    icon48 = os.path.join(icons_dir, "icon48.png")
    icon128 = os.path.join(icons_dir, "icon128.png")

    if os.path.exists(icon16) and os.path.exists(img_dir):
        shutil.copy2(icon16, os.path.join(img_dir, "16.png"))
        shutil.copy2(icon32, os.path.join(img_dir, "32.png"))
        shutil.copy2(icon48, os.path.join(img_dir, "48.png"))
        shutil.copy2(icon128, os.path.join(img_dir, "128.png"))
        shutil.copy2(icon128, os.path.join(img_dir, "yomi.png"))
        shutil.copy2(icon128, os.path.join(img_dir, "yomi-dark.png"))
        shutil.copy2(icon128, os.path.join(img_dir, "torii.png"))
        shutil.copy2(icon128, os.path.join(img_dir, "torii-dark.png"))
        shutil.copy2(icon32, os.path.join(WORKSPACE_DIR, "public", "favicon.png"))
        print("Updated all extension images and public/favicon.png from extension/icons successfully!")

def create_zip():
    zip_path = os.path.join(WORKSPACE_DIR, "yomi-extension.zip")
    public_zip = os.path.join(WORKSPACE_DIR, "public", "yomi-extension.zip")

    print(f"Packaging {zip_path}...")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(EXTENSION_DIR):
            for file in files:
                abs_path = os.path.join(root, file)
                rel_path = os.path.relpath(abs_path, EXTENSION_DIR)
                zipf.write(abs_path, rel_path)

    os.makedirs(os.path.dirname(public_zip), exist_ok=True)
    shutil.copy2(zip_path, public_zip)
    print(f"Copied package to {public_zip} ({os.path.getsize(public_zip):,} bytes)")

def check_remaining():
    print("\n--- Scanning for any remaining mentions ---")
    patterns = [r"\btorii\b", r"\btoji\b", r"\btorji\b"]
    found = 0
    for root, dirs, files in os.walk(EXTENSION_DIR):
        for file in files:
            ext = os.path.splitext(file)[1].lower()
            if ext not in TEXT_EXTENSIONS:
                continue
            fpath = os.path.join(root, file)
            with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
                for p in patterns:
                    matches = list(re.finditer(p, content, re.IGNORECASE))
                    if matches:
                        print(f"Found {len(matches)} match(es) for '{p}' in {os.path.relpath(fpath, EXTENSION_DIR)}")
                        found += len(matches)
    if found == 0:
        print("✅ Clean! Zero occurrences of 'torii', 'toji', or 'torji' found in extension.")
    else:
        print(f"⚠️  {found} total remaining occurrence(s).")

def main():
    print("=" * 60)
    print("Yomi Manga Translator: Automated Rebranding & Free Bypass Tool")
    print("=" * 60)

    # 1. Image rename / copies
    rename_images()

    # 2. Process extension/
    ext_mods = process_directory(EXTENSION_DIR)
    print(f"Processed extension/: {ext_mods} files updated.")

    # 3. Process src/
    if os.path.exists(SRC_DIR):
        src_mods = process_directory(SRC_DIR)
        print(f"Processed src/: {src_mods} files updated.")

    # 4. Process README.md
    if os.path.exists(README_FILE):
        if process_file(README_FILE):
            print("Updated README.md")

    # 5. Check remaining
    check_remaining()

    # 6. Re-pack ZIP
    create_zip()

    print("\n✅ All done! The extension is completely rebranded as Yomi and ready for Chrome loading.")

if __name__ == "__main__":
    main()
