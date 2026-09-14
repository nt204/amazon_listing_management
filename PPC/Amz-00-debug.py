"""
Script chan doan: mo 1 profile AdsPower, vao trang Bulksheet + Reports,
va luu HTML/screenshot/danh sach element de xem giao dien moi cua Amazon.

Chay:  python E:\\PythonProject1\\Amz-00-debug.py

Output luu tai:  E:\\PythonProject1\\debug_amz\\
"""

import requests
import os
import json
import time
import random
from datetime import datetime
import gspread
from oauth2client.service_account import ServiceAccountCredentials
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.by import By
from selenium.common.exceptions import TimeoutException, NoSuchElementException

# --- CAU HINH ---
LOCAL_API_PATH = r"C:\Users\Administrator\AppData\Roaming\adspower_global\cwd_global\source\local_api"
GOOGLE_API_KEYFILE = r"E:\PythonProject1\NCE_googleapi.json"
SPREADSHEET_URL = "https://docs.google.com/spreadsheets/d/1CBZuKZOjG9zxNrfdh3qgeofkwW1758ruZl-yT77_IeI/edit?gid=0#gid=0"
WORKSHEET_NAME = "APBrand"
API_URL_DEFAULT = "http://127.0.0.1:50325"

# Neu ban muon chon profile cu the, dien ID vao day (vd: "k11faho6"). De trong se lay profile dau tien.
TARGET_PROFILE_ID = ""

OUTPUT_DIR = r"E:\PythonProject1\debug_amz"
os.makedirs(OUTPUT_DIR, exist_ok=True)


def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")


def read_local_api_file(path):
    try:
        with open(path, 'r') as f:
            return f.read().strip()
    except Exception:
        return None


def get_first_profile():
    scope = [
        "https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive.file",
    ]
    creds = ServiceAccountCredentials.from_json_keyfile_name(GOOGLE_API_KEYFILE, scope)
    gc = gspread.authorize(creds)
    sheet = gc.open_by_url(SPREADSHEET_URL).worksheet(WORKSHEET_NAME)
    rows = sheet.get_all_records()
    for r in rows:
        pid = str(r.get("id", "")).strip()
        brand = str(r.get("BRAND", "")).strip()
        if not pid or not brand:
            continue
        if TARGET_PROFILE_ID and pid != TARGET_PROFILE_ID:
            continue
        return pid, brand
    return None, None


def open_profile(api_url, profile_id):
    r = requests.post(f"{api_url}/api/v2/browser-profile/start",
                      json={"profile_id": profile_id}, timeout=20)
    r.raise_for_status()
    data = r.json()
    if data.get("code") != 0:
        raise Exception(f"AdsPower error: {data.get('msg')}")
    return data['data']['debug_port'], data['data']['webdriver']


def stop_profile(api_url, profile_id):
    try:
        requests.post(f"{api_url}/api/v2/browser-profile/stop",
                      json={"profile_id": profile_id}, timeout=10)
    except Exception:
        pass


def setup_driver(debug_port, driver_path):
    service = Service(executable_path=driver_path)
    opts = Options()
    opts.add_argument("--disable-blink-features=AutomationControlled")
    opts.add_experimental_option("debuggerAddress", f"127.0.0.1:{debug_port}")
    driver = webdriver.Chrome(service=service, options=opts)
    return driver


def dump_page(driver, tag, brand):
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    base = os.path.join(OUTPUT_DIR, f"{brand}_{tag}_{ts}")

    # 1. Luu HTML
    html_path = base + ".html"
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(driver.page_source)
    log(f"  -> HTML: {html_path}")

    # 2. Luu screenshot
    png_path = base + ".png"
    try:
        driver.save_screenshot(png_path)
        log(f"  -> PNG : {png_path}")
    except Exception as e:
        log(f"  -> PNG loi: {e}")

    # 3. Luu danh sach id/class cua tat ca element co the thao tac
    js = """
    const out = [];
    document.querySelectorAll('button, input, div[id], section[id], form[id], label, a[data-takt-id], [data-takt-id], [data-testid]').forEach(el => {
        out.push({
            tag: el.tagName,
            id: el.id || '',
            class: (el.className && typeof el.className === 'string') ? el.className.slice(0, 120) : '',
            taktId: el.getAttribute('data-takt-id') || '',
            taktFeature: el.getAttribute('data-takt-feature') || '',
            testId: el.getAttribute('data-testid') || '',
            text: (el.innerText || '').trim().slice(0, 80),
            type: el.getAttribute('type') || '',
            name: el.getAttribute('name') || '',
            value: (el.value || '').toString().slice(0, 40),
        });
    });
    return out;
    """
    try:
        elements = driver.execute_script(js)
    except Exception as e:
        elements = []
        log(f"  -> JS loi: {e}")

    elem_path = base + "_elements.json"
    with open(elem_path, "w", encoding="utf-8") as f:
        json.dump({"url": driver.current_url, "title": driver.title, "elements": elements},
                  f, ensure_ascii=False, indent=2)
    log(f"  -> JSON: {elem_path} ({len(elements)} elements)")

    # 4. Luu danh sach rut gon (chi nhung element co id/takt/testid/text)
    summary_path = base + "_summary.txt"
    with open(summary_path, "w", encoding="utf-8") as f:
        f.write(f"URL   : {driver.current_url}\n")
        f.write(f"TITLE : {driver.title}\n")
        f.write(f"COUNT : {len(elements)}\n")
        f.write("=" * 80 + "\n")
        for e in elements:
            if not (e['id'] or e['taktId'] or e['testId'] or (e['text'] and len(e['text']) > 2)):
                continue
            f.write(f"<{e['tag'].lower()}")
            if e['id']:         f.write(f" id='{e['id']}'")
            if e['type']:       f.write(f" type='{e['type']}'")
            if e['name']:       f.write(f" name='{e['name']}'")
            if e['taktId']:     f.write(f" data-takt-id='{e['taktId']}'")
            if e['taktFeature']:f.write(f" data-takt-feature='{e['taktFeature']}'")
            if e['testId']:     f.write(f" data-testid='{e['testId']}'")
            if e['value']:      f.write(f" value='{e['value']}'")
            if e['class']:      f.write(f" class='{e['class']}'")
            f.write(">")
            if e['text']: f.write(f" {e['text']!r}")
            f.write("\n")
    log(f"  -> TXT : {summary_path}")


def main():
    log("Bat dau script chan doan")

    api_url = read_local_api_file(LOCAL_API_PATH) or API_URL_DEFAULT
    log(f"AdsPower API: {api_url}")

    profile_id, brand = get_first_profile()
    if not profile_id:
        log("Khong tim thay profile phu hop trong Google Sheet.")
        return
    log(f"Profile : {profile_id} ({brand})")

    try:
        debug_port, driver_path = open_profile(api_url, profile_id)
        log(f"Mo profile thanh cong (debug_port={debug_port})")
        time.sleep(5)
    except Exception as e:
        log(f"Loi mo profile: {e}")
        return

    driver = None
    try:
        driver = setup_driver(debug_port, driver_path)
        driver.set_page_load_timeout(60)

        # ---- Trang 1: Bulksheet HomePage ----
        log("Truy cap trang Bulksheet...")
        driver.get("https://advertising.amazon.com/bulksheet/HomePage")
        time.sleep(10)  # cho trang load
        log(f"URL hien tai: {driver.current_url}")
        log(f"Title      : {driver.title}")
        dump_page(driver, "bulksheet", brand)

        # ---- Trang 2: Reports ----
        log("Truy cap trang Reports...")
        driver.get("https://advertising.amazon.com/reports")
        time.sleep(10)
        log(f"URL hien tai: {driver.current_url}")
        log(f"Title      : {driver.title}")
        dump_page(driver, "reports", brand)

        # ---- Thu click vao nut Create report de xem form ----
        try:
            log("Thu click Create report...")
            btn = WebDriverWait(driver, 10).until(
                EC.element_to_be_clickable(
                    (By.CSS_SELECTOR, 'button[data-takt-id="storm-ui-button"][data-takt-feature="unified-report-center:urc-subscriptions-table-container"]'))
            )
            btn.click()
            time.sleep(8)
            dump_page(driver, "reports_create_form", brand)
        except Exception as e:
            log(f"  Khong mo duoc form Create report: {e}")
            # Thu selector rong hon
            try:
                btns = driver.find_elements(By.CSS_SELECTOR, 'button[data-takt-id="storm-ui-button"]')
                log(f"  Tim thay {len(btns)} nut storm-ui-button")
                for i, b in enumerate(btns[:10]):
                    log(f"    [{i}] text={b.text!r} feat={b.get_attribute('data-takt-feature')!r}")
            except Exception:
                pass

        log("Hoan thanh chan doan. Kiem tra thu muc: " + OUTPUT_DIR)

    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass
        stop_profile(api_url, profile_id)
        log("Da dong profile.")


if __name__ == "__main__":
    main()
