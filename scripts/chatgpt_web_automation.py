#!/usr/bin/env python3
"""
ChatGPT Web Automation Script (Python - Playwright / Selenium)
Tự động đăng nhập chatgpt.com qua Session Cookie, gửi prompt, quét HTML lấy thẻ <img src="...">
và lưu ảnh mockup về đĩa.
"""

import sys
import os
import json
import time
import argparse
import urllib.request

def parse_cookies(cookie_str_or_json):
    cookies = []
    if not cookie_str_or_json:
        return cookies
    
    trimmed = cookie_str_or_json.strip()
    if trimmed.startswith("[") and trimmed.endswith("]"):
        try:
            parsed = json.loads(trimmed)
            if isinstance(parsed, list):
                for item in parsed:
                    if "name" in item and "value" in item:
                        cookies.append({
                            "name": item["name"],
                            "value": item["value"],
                            "domain": item.get("domain", ".chatgpt.com"),
                            "path": item.get("path", "/"),
                            "secure": item.get("secure", True),
                            "httpOnly": item.get("httpOnly", False)
                        })
                return cookies
        except Exception as e:
            print(f"[Python Automation] Failed to parse JSON cookies: {e}", file=sys.stderr)
    
    for pair in trimmed.split(";"):
        if "=" in pair:
            name, value = pair.split("=", 1)
            name = name.strip()
            value = value.strip()
            if name and value:
                cookies.append({
                    "name": name,
                    "value": value,
                    "domain": ".chatgpt.com",
                    "path": "/",
                    "secure": True,
                    "httpOnly": False
                })
    return cookies

def run_playwright(prompt, output_file, cookies_raw, headless=True):
    from playwright.sync_api import sync_playwright

    cookies = parse_cookies(cookies_raw or os.environ.get("CHATGPT_WEB_COOKIES", ""))
    session_token = os.environ.get("CHATGPT_SESSION_TOKEN", "")

    if session_token and not any("session-token" in c["name"] for c in cookies):
        cookies.append({
            "name": "__Secure-next-auth.session-token",
            "value": session_token.strip(),
            "domain": ".chatgpt.com",
            "path": "/",
            "secure": True,
            "httpOnly": True
        })

    with sync_playwright() as p:
        print("[Python Playwright] Launching Chrome browser...")
        try:
            browser = p.chromium.launch(channel="chrome", headless=headless)
        except Exception:
            browser = p.chromium.launch(headless=headless)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 800}
        )

        if cookies:
            print(f"[Python Playwright] Injecting {len(cookies)} session cookies...")
            context.add_cookies(cookies)
        else:
            print("[Python Playwright] Warning: No session cookies provided!", file=sys.stderr)

        page = context.new_page()
        print("[Python Playwright] Accessing https://chatgpt.com...")
        page.goto("https://chatgpt.com", wait_until="domcontentloaded", timeout=30000)

        prompt_selector = "#prompt-textarea, textarea[tabindex='0'], div[contenteditable='true']"
        try:
            page.wait_for_selector(prompt_selector, timeout=15000)
        except Exception:
            raise RuntimeError("Cannot find prompt text area on chatgpt.com. Cookies may be missing or expired.")

        print("[Python Playwright] Typing prompt into chat box...")
        prompt_input = page.locator(prompt_selector).first
        prompt_input.focus()
        prompt_input.fill(prompt)

        send_button = page.locator("button[data-testid='send-button'], button[aria-label='Send prompt']").first
        if send_button.count() > 0 and send_button.is_visible():
            send_button.click()
        else:
            prompt_input.press("Enter")

        print("[Python Playwright] Waiting for ChatGPT Plus image generation...")
        existing_imgs = page.locator("img").all()
        existing_srcs = set(img.get_attribute("src") for img in existing_imgs if img.get_attribute("src"))

        start_time = time.time()
        image_src = None

        while time.time() - start_time < 90:
            time.sleep(2)
            images = page.locator("img").all()
            for img in images:
                src = img.get_attribute("src")
                if src and src not in existing_srcs and "avatar" not in src:
                    if "oaiusercontent" in src or "files." in src or src.startswith("blob:") or src.startswith("data:image"):
                        image_src = src
                        break
            if image_src:
                break

        if not image_src:
            raise RuntimeError("Prompt sent successfully, but generated <img src='...'> not found.")

        print(f"[Python Playwright] Found generated image URL: {image_src[:80]}...")

        if image_src.startswith("data:image"):
            import base64
            header, data = image_src.split(",", 1)
            img_bytes = base64.b64decode(data)
        else:
            resp = page.request.get(image_src)
            img_bytes = resp.body()

        with open(output_file, "wb") as f:
            f.write(img_bytes)
        
        print(f"[Python Playwright] Successfully saved image to {output_file}")
        browser.close()

def main():
    parser = argparse.ArgumentParser(description="ChatGPT Web Automation Image Generator")
    parser.add_argument("--prompt", required=True, help="Image generation prompt")
    parser.add_argument("--output", required=True, help="Output image file path")
    parser.add_argument("--cookies", default="", help="Cookies header string or JSON array")
    parser.add_argument("--headful", action="store_true", help="Run browser in headful (visible) mode")
    
    args = parser.parse_args()
    
    run_playwright(
        prompt=args.prompt,
        output_file=args.output,
        cookies_raw=args.cookies,
        headless=not args.headful
    )

if __name__ == "__main__":
    main()
