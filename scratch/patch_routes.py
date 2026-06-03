import os

routes_path = r"c:\Users\dynast\Desktop\chofi bntk\my project autmation\backend\app\api\routes.py"

with open(routes_path, "r", encoding="utf-8") as f:
    content = f.read()

target = """    image_url = ""
    image_key = design.get("image_r2_key")
    if image_key:
        try:
            image_url = r2_service.signed_get_url(image_key)
        except r2_service.R2Error:
            image_url = ""
"""

replacement = """    import time
    from app.services.image_preview_service import ensure_ai_preview_for_design

    # Lazily ensure/get preview
    start_preview = time.perf_counter()
    image_url, image_source, generated = await ensure_ai_preview_for_design(user.id, design)
    preview_gen_ms = int((time.perf_counter() - start_preview) * 1000) if generated else 0

    # Log timing of preview generation safely
    logger.info(f"[AI TIMING] preview_generation_ms={preview_gen_ms}")
    logger.info(f"[AI TIMING] image_source={image_source}")
"""

# Let's handle \r\n vs \n dynamically
if target in content:
    content = content.replace(target, replacement)
    print("Standard LF match succeeded!")
elif target.replace("\n", "\r\n") in content:
    content = content.replace(target.replace("\n", "\r\n"), replacement.replace("\n", "\r\n"))
    print("CRLF match succeeded!")
else:
    # Let's try matching a smaller substring to see what's happening
    print("Exact target not found, trying smaller match...")
    target_smaller = 'image_url = ""'
    if target_smaller in content:
        print("Smaller target exists. Let's do a line-by-line replacement.")
        # We can find the block and replace it
        lines = content.splitlines()
        found_idx = -1
        for idx, line in enumerate(lines):
            if 'image_url = ""' in line and idx + 5 < len(lines) and 'except r2_service.R2Error:' in lines[idx+5]:
                found_idx = idx
                break
        
        if found_idx != -1:
            lines[found_idx:found_idx+7] = [
                "    import time",
                "    from app.services.image_preview_service import ensure_ai_preview_for_design",
                "",
                "    # Lazily ensure/get preview",
                "    start_preview = time.perf_counter()",
                "    image_url, image_source, generated = await ensure_ai_preview_for_design(user.id, design)",
                "    preview_gen_ms = int((time.perf_counter() - start_preview) * 1000) if generated else 0",
                "",
                "    # Log timing of preview generation safely",
                '    logger.info(f"[AI TIMING] preview_generation_ms={preview_gen_ms}")',
                '    logger.info(f"[AI TIMING] image_source={image_source}")'
            ]
            content = "\n".join(lines)
            print("Line-by-line replacement succeeded!")
        else:
            print("Could not find the target index!")
    else:
        print("Target smaller not found!")

with open(routes_path, "w", encoding="utf-8", newline="") as f:
    f.write(content)
print("Patching complete!")
