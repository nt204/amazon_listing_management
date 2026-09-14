import requests
import os
import json
import pandas as pd
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.by import By
from selenium.common.exceptions import (
    TimeoutException,
    NoSuchElementException,
    StaleElementReferenceException,
    ElementClickInterceptedException,
    ElementNotInteractableException,
)
import time
import random
import traceback
from datetime import datetime, timedelta
import pytz
from urllib.parse import quote, unquote
import subprocess
import sys
import gspread
from oauth2client.service_account import ServiceAccountCredentials
import logging
from multiprocessing import Pool
import re


def _safe_click(driver, element, brand, label):
    """Click voi fallback: native click -> JS click neu bi intercept/not-interactable.

    Why: Amazon Advertising hay co overlay (cookie banner, tooltip, modal animation)
    che element ngay sau khi wait.element_to_be_clickable tra ve. JS click bypass
    duoc overlay check va co the gay click ngay ca khi element bi che 1 phan.
    """
    try:
        element.click()
        return
    except (ElementClickInterceptedException, ElementNotInteractableException) as e:
        logging.warning(
            f"[{brand}] {label}: native click bi chan ({type(e).__name__}), thu JS click.")
        driver.execute_script("arguments[0].click();", element)
        return

# --- CẤU HÌNH ---

# Cấu hình bật/tắt chức năng
BULK_FILE_ENABLED = True
SEARCH_TERM_ENABLED = True

# Thiết lập logging
VN_TZ = pytz.timezone('Asia/Ho_Chi_Minh')
current_date = datetime.now(VN_TZ).strftime("%Y%m%d")
log_file = f"E:\\PythonProject1\\Amzdata-01-request-{current_date}.txt"

# Xóa log cũ trước khi chạy
if os.path.exists(log_file):
    with open(log_file, 'w', encoding='utf-8') as f:
        f.write('')

logging.basicConfig(
    filename=log_file,
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
    encoding='utf-8'
)
console = logging.StreamHandler()
console.setLevel(logging.INFO)
console.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s', datefmt='%Y-%m-%d %H:%M:%S'))
logging.getLogger('').addHandler(console)

# Cấu hình Telegram
BOT_TOKEN = "7319056820:AAGnHjcTzqWlS6QU4OjEiP3mPnXCejGnXqw"
GROUP_CHAT_ID = -1002462247213
TOPIC_ID = 1792
TELEGRAM_PROXY_URL = "https://nce-telegram-proxy.ntthanhnce.workers.dev"
SCRIPT_NAME = "Amz-01-request"

# Stagger delay theo brand (giay) — de tranh dong loat 5 store cung login Amazon
# Advertising trong 1 giay khi session het han. Brand co cookie thuong het han
# hang ngay (nhu Bozspacer) can bat buoc re-login -> Amazon flag khi thay nhieu
# session dong thoi tu cung IP/machine -> tra ve challenge giu nguyen ap_password.
# Delay du de cac brand khac hoan tat login (~60-90s) truoc khi brand nay start.
STAGGER_DELAY_BY_BRAND = {
    "Bozspacer": 90,
}

# Cấu hình đầu vào
LOCAL_API_PATH = r"C:\Users\Administrator\AppData\Roaming\adspower_global\cwd_global\source\local_api"
GOOGLE_API_KEYFILE = r"E:\PythonProject1\NCE_googleapi.json"
SPREADSHEET_URL = "https://docs.google.com/spreadsheets/d/1CBZuKZOjG9zxNrfdh3qgeofkwW1758ruZl-yT77_IeI/edit?gid=0#gid=0"
WORKSHEET_NAME = "APBrand"
API_URL_DEFAULT = "http://127.0.0.1:50325"
ADDSPOWER_PATH = r"C:\Program Files\AdsPower Global\AdsPower Global.exe"

# Global gspread client
gc = None


# --- CÁC HÀM HỖ TRỢ ---

def escape_markdown(text):
    """Hàm hỗ trợ escape các ký tự đặc biệt của MarkdownV2."""
    escape_chars = r'_*[]()~`>#+-=|{}.!'
    return ''.join(f'\\{char}' if char in escape_chars else char for char in str(text))


def clean_for_log(markdown_text):
    """Làm sạch tin nhắn Markdown để ghi log cho dễ đọc."""
    emojis_to_remove = ['🚀', '✅', '❌', '🔑', '💥', '🎉', '⚠️', '☠️', '📄', '⏳']
    clean_text = markdown_text
    for emoji in emojis_to_remove:
        clean_text = clean_text.replace(emoji, '')
    chars_to_remove = ['*', '_', '`', '~']
    for char in chars_to_remove:
        clean_text = clean_text.replace(char, '')
    clean_text = clean_text.replace('\\', '')
    return clean_text.strip()


def send_telegram_message(message, parse_mode="MarkdownV2"):
    """Gửi tin nhắn Telegram. Tự retry khi gặp 429 (rate limit)."""
    url = f"{TELEGRAM_PROXY_URL}/bot{BOT_TOKEN}/sendMessage?chat_id={GROUP_CHAT_ID}&text={quote(message)}&message_thread_id={TOPIC_ID}&parse_mode={parse_mode}"
    for attempt in range(1, 4):
        try:
            response = requests.get(url, timeout=10)
            if response.status_code == 200:
                clean_message = clean_for_log(message)
                log_message = clean_message.replace('\n', ' ').strip()
                logging.info(f"[TELEGRAM] Đã gửi: {log_message}")
                return
            if response.status_code == 429:
                try:
                    retry_after = int(response.json().get("parameters", {}).get("retry_after", 5))
                except Exception:
                    retry_after = 5
                if attempt < 3:
                    logging.warning(
                        f"[TELEGRAM] 429 rate limit, chờ {retry_after}s rồi thử lại (lần {attempt}/3).")
                    time.sleep(retry_after + 1)
                    continue
            logging.error(f"[TELEGRAM] Gửi thất bại: {response.status_code} {response.text}")
            return
        except Exception as e:
            logging.error(f"[TELEGRAM] Lỗi khi gửi tin nhắn: {str(e)}")
            return


def read_local_api_file(file_path):
    try:
        with open(file_path, 'r') as file:
            return file.read().strip()
    except FileNotFoundError:
        logging.info(f"[SYSTEM] Không tìm thấy file {file_path}. Sử dụng URL mặc định.")
        return None
    except Exception as e:
        logging.error(f"[SYSTEM] Lỗi khi đọc file {file_path}: {e}")
        return None


def check_api_status(api_url):
    status_url = f"{api_url}/status"
    try:
        response = requests.get(status_url, timeout=5)
        response.raise_for_status()
        data = response.json()
        if data.get("code") == 0:
            logging.info("[SYSTEM] API AdsPower đang hoạt động.")
            return True
        else:
            logging.warning(f"[SYSTEM] API không sẵn sàng: {data.get('msg', 'Không có thông báo lỗi')}")
            return False
    except requests.exceptions.RequestException as e:
        logging.error(f"[SYSTEM] Lỗi kết nối API: {e}")
        return False


def open_profile(api_url, profile_id, brand, api_key=None):
    while True:
        open_url = f"{api_url}/api/v2/browser-profile/start"
        payload = {"profile_id": profile_id}
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        try:
            response = requests.post(open_url, json=payload, headers=headers, timeout=10)
            response.raise_for_status()
            data = response.json()
            if data.get("code") == 0:
                debug_port = data['data']['debug_port']
                driver_path = data['data']['webdriver']
                logging.info(f"[{brand}] Mở profile thành công. Debug port: {debug_port}")
                time.sleep(5)
                return debug_port, driver_path
            else:
                error_msg = data.get('msg', 'Không có thông báo lỗi')
                logging.error(f"[{brand}] Lỗi khi mở profile: {error_msg}")
                msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
                      f"❌ _Lỗi khi mở profile_\n" \
                      f"Lỗi: `{escape_markdown(error_msg)}`"
                send_telegram_message(msg)
                stop_profile(api_url, profile_id, brand)
                time.sleep(random.uniform(2, 4))
        except requests.exceptions.RequestException as e:
            logging.error(f"[{brand}] Lỗi gửi yêu cầu mở profile: {e}")
            msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
                  f"❌ _Lỗi gửi yêu cầu mở profile_\n" \
                  f"Lỗi: `{escape_markdown(e)}`"
            send_telegram_message(msg)
            stop_profile(api_url, profile_id, brand)
            time.sleep(random.uniform(2, 4))
        except json.JSONDecodeError:
            logging.error(f"[{brand}] Phản hồi không phải JSON hợp lệ.")
            msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
                  f"❌ _Phản hồi không phải JSON hợp lệ khi mở profile_"
            send_telegram_message(msg)
            stop_profile(api_url, profile_id, brand)
            time.sleep(random.uniform(2, 4))


def stop_profile(api_url, profile_id, brand, api_key=None):
    stop_url = f"{api_url}/api/v2/browser-profile/stop"
    payload = {"profile_id": profile_id}
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    try:
        response = requests.post(stop_url, json=payload, headers=headers, timeout=10)
        response.raise_for_status()
        data = response.json()
        if data.get("code") == 0:
            logging.info(f"[{brand}] Đã dừng profile thành công.")
        else:
            logging.error(f"[{brand}] Lỗi khi dừng profile: {data.get('msg', 'Không có thông báo lỗi')}")
    except requests.exceptions.RequestException as e:
        logging.error(f"[{brand}] Lỗi gửi yêu cầu dừng profile: {e}")


def get_sheet_data(keyfile):
    global gc
    scope = [
        "https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive.file",
    ]
    try:
        if not gc:
            credentials = ServiceAccountCredentials.from_json_keyfile_name(keyfile, scope)
            gc = gspread.authorize(credentials)
        sheet = gc.open_by_url(SPREADSHEET_URL).worksheet(WORKSHEET_NAME)
        all_rows = sheet.get_all_records()
        profile_data = {row["id"]: row["BRAND"] for row in all_rows if row.get("id") and row.get("BRAND")}
        logging.info(f"[SYSTEM] Đã đọc {len(profile_data)} profiles từ Google Sheet.")
        return profile_data
    except gspread.exceptions.APIError as e:
        logging.error(f"[SYSTEM] Lỗi API Google Sheet: {e}")
        return None
    except Exception as e:
        logging.error(f"[SYSTEM] Lỗi khi truy cập Google Sheet: {e}")
        return None


# --- START: NEW LOGIN MECHANISM FROM Ketoanamz-01-6file.py ---
# Giữ lại các hàm get_password, get_2fa, initialize_gspread từ bản gốc của Amz-01 vì chúng được thiết kế cho multiprocessing.
# Chỉ thay thế các hàm handle_two_step_verification và login_if_needed_advertising.

def initialize_gspread_client_if_needed(brand):
    """
    Khởi tạo gspread client toàn cục nếu nó chưa được khởi tạo.
    Cần thiết cho multiprocessing.
    """
    global gc
    if gc:
        return True
    try:
        scope = [
            "https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive",
            "https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive.file",
        ]
        credentials = ServiceAccountCredentials.from_json_keyfile_name(GOOGLE_API_KEYFILE, scope)
        gc = gspread.authorize(credentials)
        logging.info(f"[{brand}] gspread client đã được khởi tạo trong process.")
        return True
    except Exception as e:
        logging.error(f"[{brand}] Lỗi khởi tạo gspread client trong process: {e}")
        gc = None  # Đảm bảo gc vẫn là None nếu thất bại
        return False


# Cache cap process: doc accInfo 1 lan, reuse cho tat ca get_* calls.
# Multiprocessing.Pool fork child process => moi child co cache rieng.
# Voi 7 brand chay song song => 7 read (truoc do la 7*6=42). Quota 60/min => an toan.
_account_cache = None
_account_cache_ts = 0.0
_ACCOUNT_CACHE_TTL = 1800  # 30 phut


def _gspread_call_with_retry(fn, brand, label, max_attempts=6):
    """Goi 1 gspread call voi retry+backoff khi gap 429/5xx.

    - Honor Retry-After header neu co (Google tra ve khi quota exceeded).
    - Fallback exponential backoff + jitter (chong herd khi nhieu child process
      cung dap quota cung luc).
    """
    for attempt in range(1, max_attempts + 1):
        try:
            return fn()
        except gspread.exceptions.APIError as e:
            status = None
            try:
                status = e.response.status_code if e.response else None
            except Exception:
                pass
            if status not in (429, 500, 502, 503, 504):
                raise
            retry_after = None
            try:
                ra = e.response.headers.get('Retry-After') if e.response else None
                if ra:
                    retry_after = float(ra)
            except Exception:
                pass
            if retry_after is None:
                retry_after = min(2 ** attempt, 60) + random.uniform(0, 3)
            logging.warning(
                f"[{brand}] gspread {label} HTTP {status}, retry "
                f"{attempt}/{max_attempts} sau {retry_after:.1f}s")
            time.sleep(retry_after)
    raise Exception(f"gspread {label} that bai sau {max_attempts} retry")


def _load_account_cache(brand, force=False):
    """Doc accInfo 1 lan, cache process-local. TTL 30 phut.

    Return dict {profile_id: row} hoac None khi loi.
    """
    global _account_cache, _account_cache_ts
    now = time.time()
    if not force and _account_cache is not None \
            and (now - _account_cache_ts) < _ACCOUNT_CACHE_TTL:
        return _account_cache
    if not initialize_gspread_client_if_needed(brand):
        return None

    def _fetch():
        sheet = gc.open_by_url(SPREADSHEET_URL).worksheet("accInfo")
        return sheet.get_all_records()

    try:
        rows = _gspread_call_with_retry(_fetch, brand, "load accInfo")
    except gspread.exceptions.WorksheetNotFound:
        logging.error(f"[{brand}] Khong tim thay worksheet 'accInfo'.")
        return None
    except Exception as e:
        logging.error(f"[{brand}] Loi load accInfo cache: {e}")
        return None

    cache = {}
    for row in rows:
        pid = str(row.get('idAdsPowers') or '').strip()
        if pid:
            cache[pid] = row
    _account_cache = cache
    _account_cache_ts = now
    logging.info(f"[{brand}] Load cache accInfo: {len(cache)} record(s).")
    return cache


def get_password_from_gsheet(profile_id, brand):
    """Lấy mật khẩu từ Google Sheet 'accInfo' (qua cache)."""
    cache = _load_account_cache(brand)
    if cache is None:
        return None
    row = cache.get(str(profile_id).strip())
    if not row:
        logging.error(f"[{brand}] Không tìm thấy profile ID: {profile_id} trong sheet 'accInfo'.")
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"❌ _Không tìm thấy mật khẩu trong Google Sheet_\n" \
              f"Profile ID: `{profile_id}`"
        send_telegram_message(msg)
        return None
    password = row.get('pass amazon')
    if not password:
        logging.error(
            f"[{brand}] Profile ID {profile_id} không có mật khẩu trong cột 'pass amazon'.")
        return None
    logging.info(f"[{brand}] Đã tìm thấy mật khẩu cho profile ID: {profile_id} (cache).")
    return str(password)


def get_2fa_secret(profile_id, brand):
    """Lấy mã 2FA secret từ Google Sheet 'accInfo' (qua cache)."""
    cache = _load_account_cache(brand)
    if cache is None:
        return None
    row = cache.get(str(profile_id).strip())
    if not row:
        logging.error(f"[{brand}] Không tìm thấy profile ID: {profile_id} để lấy 2FA.")
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"❌ _Không tìm thấy mã 2FA trong Google Sheet_\n" \
              f"Profile ID: `{profile_id}`"
        send_telegram_message(msg)
        return None
    secret_2fa = row.get('2FA')
    if not secret_2fa:
        logging.error(f"[{brand}] Profile ID {profile_id} không có mã trong cột '2FA'.")
        return None
    logging.info(f"[{brand}] Đã tìm thấy mã 2FA cho profile ID: {profile_id} (cache).")
    return str(secret_2fa)


def verify_login_success(driver, brand, timeout=30):
    """
    Xác minh rằng trang đăng nhập hoặc OTP không còn hiển thị sau khi submit.
    """
    logging.info(f"[{brand}] Bắt đầu xác minh trạng thái đăng nhập...")
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            # Kiểm tra sự tồn tại của các form đăng nhập/OTP
            driver.find_element(By.ID, "ap_password")
            logging.info(f"[{brand}] Vẫn thấy ô mật khẩu. Đăng nhập chưa thành công. Chờ...")
            time.sleep(2)
            continue
        except NoSuchElementException:
            # Không thấy ô mật khẩu, tốt. Giờ kiểm tra OTP.
            pass

        try:
            driver.find_element(By.ID, "auth-mfa-otpcode")
            logging.info(f"[{brand}] Vẫn thấy ô OTP. Đăng nhập chưa thành công. Chờ...")
            time.sleep(2)
            continue
        except NoSuchElementException:
            # Không thấy ô OTP.
            pass

        # Nếu không thấy cả hai, coi như thành công
        logging.info(f"[{brand}] Không còn thấy form đăng nhập/OTP. Xác nhận đăng nhập thành công.")
        return True

    logging.error(f"[{brand}] Sau {timeout} giây, vẫn còn trên trang đăng nhập/OTP. Đăng nhập thất bại.")
    return False


def handle_two_step_verification(driver, profile_id, brand):
    """Xử lý trang Two-Step Verification nếu xuất hiện."""
    try:
        # Thay vì check label, ta check thẳng ô nhập OTP. Nếu không có sẽ báo lỗi Timeout và thoát.
        otp_input_locator = (By.ID, "auth-mfa-otpcode")
        WebDriverWait(driver, 5).until(EC.visibility_of_element_located(otp_input_locator))

        logging.info(f"[{brand}] Phát hiện trang Two-Step Verification. Bắt đầu lấy OTP...")
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"🔐 _Phát hiện Two\\-Step Verification, đang lấy OTP\\.\\.\\._"
        send_telegram_message(msg)

        secret_key = get_2fa_secret(profile_id, brand)
        if not secret_key:
            raise Exception("Không lấy được 2FA secret key từ Google Sheet.")

        original_window = driver.current_window_handle
        driver.switch_to.new_window('tab')
        driver.get("https://2fa.live/")

        WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.ID, "listToken"))).send_keys(secret_key)

        logging.info(f"[{brand}] Chờ thời gian thích hợp (giây từ 00-15) để submit 2FA...")
        while not (0 <= datetime.now(VN_TZ).second <= 15):
            time.sleep(0.5)

        driver.find_element(By.ID, "submit").click()
        logging.info(f"[{brand}] Đã submit 2FA, chờ kết quả...")

        time.sleep(random.uniform(5, 7))

        output_text = WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.ID, "output"))).get_attribute('value')
        if '|' not in output_text:
            raise Exception("Kết quả từ 2fa.live không hợp lệ.")

        otp_code = output_text.split('|')[-1].strip()
        if not otp_code.isdigit() or len(otp_code) != 6:
            raise Exception(f"Mã OTP không hợp lệ: {otp_code}")

        logging.info(f"[{brand}] Lấy được mã OTP: {otp_code}")

        driver.close()
        driver.switch_to.window(original_window)

        # Điền OTP vào ô đã xác nhận tồn tại ở trên
        otp_input = WebDriverWait(driver, 5).until(EC.visibility_of_element_located(otp_input_locator))
        otp_input.send_keys(otp_code)
        time.sleep(random.uniform(0, 1))
        driver.find_element(By.ID, "auth-signin-button").click()
        logging.info(f"[{brand}] Đã điền OTP và nhấn Sign In.")
        return True

    except TimeoutException:
        logging.info(f"[{brand}] Không phát hiện trang Two-Step Verification.")
        return True  # Trả về True để flow tiếp tục nếu không có trang OTP
    except Exception as e:
        logging.error(f"[{brand}] Lỗi trong quá trình xử lý Two-Step Verification: {e}", exc_info=True)
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"💥 _Lỗi khi xử lý Two\\-Step Verification_\n" \
              f"Lỗi: `{escape_markdown(str(e).splitlines()[0])}`"
        send_telegram_message(msg)
        try:
            if len(driver.window_handles) > 1:
                original_window = driver.window_handles[0]
                driver.close()
                driver.switch_to.window(original_window)
        except Exception as switch_err:
            logging.error(f"[{brand}] Lỗi khi chuyển về tab chính: {switch_err}")
        return False


def login_if_needed_advertising(driver, wait, profile_id, brand):
    try:
        # Check for the main sign-in page element
        WebDriverWait(driver, 3).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, "#authportal-main-section h1")))
    except TimeoutException:
        # If no password field, check for OTP screen directly
        logging.info(f"[{brand}] Không thấy màn hình đăng nhập Advertising, kiểm tra màn hình OTP...")
        try:
            WebDriverWait(driver, 3).until(EC.visibility_of_element_located((By.ID, "auth-mfa-otpcode")))
            logging.info(f"[{brand}] Phát hiện trực tiếp màn hình OTP, tiến hành xử lý.")
            if not handle_two_step_verification(driver, profile_id, brand):
                raise Exception("Xử lý Two-Step Verification thất bại.")
            return verify_login_success(driver, brand)
        except TimeoutException:
            # If no OTP screen either, assume we are already logged in
            logging.info(f"[{brand}] Không thấy màn hình OTP, đã đăng nhập.")
            return True

    # If password field was found, proceed with the normal login flow
    login_attempts = 0
    while login_attempts < 3:
        login_attempts += 1
        try:
            msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
                  f"🔑 _Yêu cầu đăng nhập Advertising, đang tiến hành \\(Lần {login_attempts}\\)\\.\\.\\._"
            send_telegram_message(msg)

            password = get_password_from_gsheet(profile_id, brand)
            if not password:
                return False  # Không thể tiếp tục nếu không có mật khẩu

            password_field = wait.until(EC.presence_of_element_located((By.ID, "ap_password")))
            password_field.clear()
            password_field.send_keys(password)
            time.sleep(random.uniform(1, 2))

            driver.find_element(By.ID, "signInSubmit").click()

            if not handle_two_step_verification(driver, profile_id, brand):
                raise Exception("Xử lý Two-Step Verification thất bại.")

            if not verify_login_success(driver, brand):
                raise Exception("Xác minh đăng nhập thất bại.")

            logging.info(f"[{brand}] Đăng nhập Advertising thành công (đã xác minh).")
            return True
        except Exception as e:
            logging.error(f"[{brand}] Lỗi đăng nhập Advertising (lần {login_attempts}): {e}. Thử lại sau 5s...")
            if "NoSuchElementException" in str(e) or "StaleElementReferenceException" in str(e):
                logging.info(f"[{brand}] Trang có thể đã tải lại, thử truy cập lại URL...")
                current_url = driver.current_url
                driver.get(current_url)
            time.sleep(5)

    logging.error(f"[{brand}] Đăng nhập Advertising thất bại sau {login_attempts} lần thử.")
    msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
          f"❌ _Đăng nhập Advertising thất bại sau {login_attempts} lần thử._"
    send_telegram_message(msg)
    return False


# --- END: NEW LOGIN MECHANISM ---


def setup_webdriver(debug_port, driver_path):
    service = Service(executable_path=driver_path)
    chrome_options = Options()
    chrome_options.add_argument("--disable-blink-features=AutomationControlled")
    chrome_options.add_experimental_option("debuggerAddress", f"127.0.0.1:{debug_port}")
    driver = webdriver.Chrome(service=service, options=chrome_options)
    driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
        "source": "Object.defineProperty(navigator, 'webdriver', { get: () => undefined })"
    })
    return driver


def check_reports_page(driver, wait, brand, attempt_label="check"):
    # Selector chính theo text — selector 1 chờ lâu vì Amazon hay load chậm
    # (~3 phút quan sat 2026-06-22). Selector 2/3 fallback chờ ngắn.
    selectors = [
        (By.XPATH, "//button[normalize-space(.)='Create report']", 45),
        (By.XPATH, '//*[@id="application-container"]/div/div[2]/div/div[1]/div/div[1]/button', 5),
        (By.XPATH, '//*[@id="application-container"]/div/div[1]/div/div[1]/div/div[1]/button', 5),
    ]
    for by, sel, timeout in selectors:
        try:
            local_wait = WebDriverWait(driver, timeout)
            btn = local_wait.until(EC.presence_of_element_located((by, sel)))
            # Selector 1 da enforce text qua XPath; selector 2/3 dung index DOM
            # nen kiem tra text de tranh false-positive.
            text = (btn.text or "").strip()
            if "Create report" in text or sel.startswith("//button"):
                return True
        except TimeoutException:
            continue
    try:
        current_url = driver.current_url
    except Exception:
        current_url = "<unknown>"
    logging.error(
        f"[{brand}] Không tìm thấy nút 'Create report' trên trang reports. URL={current_url}")
    _dump_reports_page(driver, brand, f"checkfail-{attempt_label}")
    return False


# --- CÁC HÀM XỬ LÝ CHÍNH ---

# So lan retry toi da cho moi report (SP/SB) truoc khi bo cuoc.
# Truoc day la `while True` => 1 brand fail = worker bi chiem mai mai (vd Bozspacer
# loop 5+ tieng 2026-06-07). Cap 10 lan voi sleep 10s => max ~7 phut/report.
SEARCH_TERM_MAX_ATTEMPTS = 10


def _dump_reports_page(driver, brand, label):
    """Luu HTML + current URL khi reports page fail, de debug DOM thuc te."""
    try:
        debug_dir = r"E:\PythonProject1\debug_amz"
        os.makedirs(debug_dir, exist_ok=True)
        ts = datetime.now().strftime('%Y%m%d_%H%M%S')
        debug_path = os.path.join(debug_dir, f"reports_{brand}_{label}_{ts}.html")
        try:
            current_url = driver.current_url
        except Exception:
            current_url = "<unknown>"
        with open(debug_path, 'w', encoding='utf-8') as f:
            f.write(f"<!-- URL: {current_url} -->\n")
            try:
                f.write(driver.page_source)
            except Exception as e:
                f.write(f"<!-- page_source error: {e} -->")
        logging.warning(
            f"[{brand}] {label}: dump HTML reports page -> {debug_path} | URL={current_url}")
    except Exception as e:
        logging.warning(f"[{brand}] {label}: dump HTML loi: {e}")


def _recover_reports_session(driver, wait, brand, profile_id, label):
    """Goi khi reports page fail. Detect re-login page va re-authenticate.

    Tra ve True neu da re-login thanh cong, False neu khong can hoac that bai.
    """
    try:
        current_url = driver.current_url or ''
    except Exception:
        current_url = ''
    login_markers = ('/ap/signin', '/ap/mfa', 'ap_password', 'auth-mfa-otpcode')
    needs_login = any(m in current_url for m in login_markers)
    if not needs_login:
        try:
            driver.find_element(By.ID, 'ap_password')
            needs_login = True
        except Exception:
            pass
    if not needs_login:
        try:
            driver.find_element(By.ID, 'auth-mfa-otpcode')
            needs_login = True
        except Exception:
            pass
    if not needs_login:
        return False
    logging.warning(
        f"[{brand}] {label}: phat hien trang sign-in (URL={current_url[:120]}), thu re-login.")
    try:
        ok = login_if_needed_advertising(driver, wait, profile_id, brand)
        if ok:
            logging.info(f"[{brand}] {label}: re-login OK, retry report.")
            return True
        logging.error(f"[{brand}] {label}: re-login that bai.")
    except Exception as e:
        logging.error(f"[{brand}] {label}: re-login exception: {e}")
    return False


def process_sp_report(driver, wait, brand, profile_id=None):
    logging.info(f"[{brand}] Bắt đầu xử lý SP report.")
    for attempt in range(1, SEARCH_TERM_MAX_ATTEMPTS + 1):
        try:
            driver.get("https://advertising.amazon.com/reports")
            time.sleep(random.uniform(3, 6))
            wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, 'button[data-takt-id="storm-ui-button"]')))
            logging.info(f"[{brand}] Trang reports đã load thành công.")

            button = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR,
                                                            'button[data-takt-id="storm-ui-button"][data-takt-feature="unified-report-center:urc-subscriptions-table-container"]')))
            time.sleep(random.uniform(3, 6))
            _safe_click(driver, button, brand, "SP create-button")

            time.sleep(random.uniform(3, 5))
            radio_button = wait.until(EC.element_to_be_clickable((By.ID, "time-units-day")))
            _safe_click(driver, radio_button, brand, "SP time-units-day")

            current_date_str = datetime.now().strftime("%Y%m%d")
            report_name = f"{brand} Search Term SP {current_date_str} (30 day)"
            report_name_input = wait.until(
                EC.presence_of_element_located((By.ID, "report-settings-card-report-name-input")))
            report_name_input.clear()
            report_name_input.send_keys(report_name)

            time.sleep(random.uniform(2, 4))
            run_button = wait.until(EC.element_to_be_clickable((By.ID, "urc_run_subscription_button")))
            _safe_click(driver, run_button, brand, "SP run-subscription")
            time.sleep(random.uniform(3, 5))
            logging.info(f"[{brand}] Đã yêu cầu SP report thành công.")
            return True
        except Exception as e:
            err_str = str(e).strip() or "<empty WebDriver message>"
            tb = traceback.format_exc()
            logging.error(
                f"[{brand}] Lỗi khi xử lý SP report (lần {attempt}/{SEARCH_TERM_MAX_ATTEMPTS}): "
                f"{type(e).__name__}: {err_str}\n{tb}")
            # Dump HTML lan dau de debug DOM thuc te
            if attempt == 1:
                _dump_reports_page(driver, brand, "SP-attempt1")
            # Detect trang sign-in => thu re-login
            if profile_id:
                _recover_reports_session(driver, wait, brand, profile_id, "SP")
            msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
                  f"❌ _Lỗi SP report \\(lần {attempt}/{SEARCH_TERM_MAX_ATTEMPTS}\\)_\n" \
                  f"Loại: `{escape_markdown(type(e).__name__)}`\n" \
                  f"Lỗi: `{escape_markdown(err_str)}`"
            send_telegram_message(msg)
            if attempt < SEARCH_TERM_MAX_ATTEMPTS:
                logging.info(f"[{brand}] Sẽ thử lại xử lý SP report sau 10 giây...")
                time.sleep(10)
    logging.error(
        f"[{brand}] BO QUA SP report sau {SEARCH_TERM_MAX_ATTEMPTS} lần thử.")
    send_telegram_message(
        f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n"
        f"⚠️ _Bỏ qua SP report sau {SEARCH_TERM_MAX_ATTEMPTS} lần thử_")
    return False


def process_sb_report(driver, wait, brand, profile_id=None):
    logging.info(f"[{brand}] Bắt đầu xử lý SB report.")
    for attempt in range(1, SEARCH_TERM_MAX_ATTEMPTS + 1):
        try:
            driver.get("https://advertising.amazon.com/reports")
            time.sleep(random.uniform(3, 6))

            button = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR,
                                                            'button[data-takt-id="storm-ui-button"][data-takt-feature="unified-report-center:urc-subscriptions-table-container"]')))
            time.sleep(random.uniform(3, 6))
            _safe_click(driver, button, brand, "SB create-button")

            time.sleep(random.uniform(3, 5))
            dropdown_button = wait.until(
                EC.element_to_be_clickable((By.ID, "report-configuration-form:report-category-control-component-0")))
            _safe_click(driver, dropdown_button, brand, "SB category-dropdown")

            time.sleep(random.uniform(3, 5))
            sponsored_brands_button = wait.until(
                EC.element_to_be_clickable(
                    (By.CSS_SELECTOR, 'button[data-takt-id="storm-ui-dropdown-item"][value="sb"]')))
            _safe_click(driver, sponsored_brands_button, brand, "SB sb-option")

            time.sleep(random.uniform(3, 5))
            report_type_dropdown = wait.until(
                EC.element_to_be_clickable((By.ID, "report-configuration-form:report-type-control-component-0")))
            _safe_click(driver, report_type_dropdown, brand, "SB report-type-dropdown")

            time.sleep(random.uniform(3, 5))
            search_term_button = wait.until(EC.element_to_be_clickable(
                (By.CSS_SELECTOR, 'button[data-takt-id="storm-ui-dropdown-item"][value="searchTerms"]')))
            _safe_click(driver, search_term_button, brand, "SB searchTerms-option")

            time.sleep(random.uniform(3, 5))
            radio_button = wait.until(EC.element_to_be_clickable((By.ID, "time-units-day")))
            _safe_click(driver, radio_button, brand, "SB time-units-day")

            current_date_str = datetime.now().strftime("%Y%m%d")
            report_name = f"{brand} Search Term SB {current_date_str} (30 day)"
            report_name_input = wait.until(
                EC.presence_of_element_located((By.ID, "report-settings-card-report-name-input")))
            report_name_input.clear()
            report_name_input.send_keys(report_name)

            time.sleep(random.uniform(2, 4))
            run_button = wait.until(EC.element_to_be_clickable((By.ID, "urc_run_subscription_button")))
            _safe_click(driver, run_button, brand, "SB run-subscription")
            time.sleep(random.uniform(3, 5))
            logging.info(f"[{brand}] Đã yêu cầu SB report thành công.")
            return True
        except Exception as e:
            err_str = str(e).strip() or "<empty WebDriver message>"
            tb = traceback.format_exc()
            logging.error(
                f"[{brand}] Lỗi khi xử lý SB report (lần {attempt}/{SEARCH_TERM_MAX_ATTEMPTS}): "
                f"{type(e).__name__}: {err_str}\n{tb}")
            if attempt == 1:
                _dump_reports_page(driver, brand, "SB-attempt1")
            if profile_id:
                _recover_reports_session(driver, wait, brand, profile_id, "SB")
            msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
                  f"❌ _Lỗi SB report \\(lần {attempt}/{SEARCH_TERM_MAX_ATTEMPTS}\\)_\n" \
                  f"Loại: `{escape_markdown(type(e).__name__)}`\n" \
                  f"Lỗi: `{escape_markdown(err_str)}`"
            send_telegram_message(msg)
            if attempt < SEARCH_TERM_MAX_ATTEMPTS:
                logging.info(f"[{brand}] Sẽ thử lại xử lý SB report sau 10 giây...")
                time.sleep(10)
    logging.error(
        f"[{brand}] BO QUA SB report sau {SEARCH_TERM_MAX_ATTEMPTS} lần thử.")
    send_telegram_message(
        f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n"
        f"⚠️ _Bỏ qua SB report sau {SEARCH_TERM_MAX_ATTEMPTS} lần thử_")
    return False


def process_search_term_reports(driver, wait, brand, profile_id=None):
    """Hàm nhóm để xử lý cả SP và SB Search Term reports."""
    logging.info(f"[{brand}] Bắt đầu xử lý nhóm Search Term report.")
    process_sp_report(driver, wait, brand, profile_id)
    process_sb_report(driver, wait, brand, profile_id)
    logging.info(f"[{brand}] Kết thúc xử lý nhóm Search Term report.")


def _scan_page_for_session_data(driver):
    """
    Quet trang dang load: tra ve dict {entityId, csrfToken, userName, currentUrl, htmlLength}.
    Quet nhieu nguon: window globals, HTML, cookies.
    """
    try:
        return driver.execute_script(r"""
            function findIn(text, patterns) {
                if (!text) return null;
                for (const p of patterns) {
                    const m = text.match(p);
                    if (m) return m[1];
                }
                return null;
            }
            const html = document.documentElement.outerHTML;
            const url  = window.location.href;
            const cookies = document.cookie || '';

            // entityId
            let entityId = null;
            try {
                const stateBlobs = [];
                if (window.__INITIAL_STATE__)  stateBlobs.push(JSON.stringify(window.__INITIAL_STATE__));
                if (window.__PRELOADED_STATE__) stateBlobs.push(JSON.stringify(window.__PRELOADED_STATE__));
                if (window.appState)            stateBlobs.push(JSON.stringify(window.appState));
                for (const blob of stateBlobs) {
                    const m = blob.match(/"entityId"\s*:\s*"(ENTITY[A-Z0-9]+)"/);
                    if (m) { entityId = m[1]; break; }
                }
            } catch(e) {}
            if (!entityId) entityId = findIn(url, [/[?&]entityId=(ENTITY[A-Z0-9]+)/]);
            if (!entityId) entityId = findIn(html, [
                /"entityId"\s*:\s*"(ENTITY[A-Z0-9]+)"/,
                /\bentityId\s*=\s*["']?(ENTITY[A-Z0-9]+)["']?/,
                /\?entityId=(ENTITY[A-Z0-9]+)/,
                /(ENTITY[A-Z0-9]{10,})/
            ]);
            if (!entityId) entityId = findIn(cookies, [/entityId=(ENTITY[A-Z0-9]+)/]);

            // csrfToken (co the la dang URL-encoded trong attribute web component,
            // hoac dang JSON da decode trong script)
            let csrfToken = window.csrfAuthToken || window.csrfToken || null;
            if (!csrfToken) csrfToken = findIn(html, [
                /"csrfAuthToken"\s*:\s*"([^"]+)"/,
                /csrfAuthToken["']?\s*[:=]\s*["']([^"']+)["']/,
                /\/bulk-operations\/export\?csrfAuthToken=([^"&'\s>]+)/,
                /csrfAuthToken=([A-Za-z0-9%][^"&'\s>]+)/
            ]);

            // userName / email seller dang dang nhap
            const userName = findIn(html, [
                /"primaryEmail"\s*:\s*"([^"]+@[^"]+)"/,
                /"userName"\s*:\s*"([^"]+@[^"]+)"/,
                /"userEmail"\s*:\s*"([^"]+)"/,
                /"emailAddress"\s*:\s*"([^"]+@[^"]+)"/,
                /"email"\s*:\s*"([^"]+@[^"]+)"/
            ]);

            return {
                entityId: entityId,
                csrfToken: csrfToken,
                userName: userName,
                currentUrl: url,
                htmlLength: html.length,
                readyState: document.readyState
            };
        """) or {}
    except Exception:
        return {}


def _extract_bulkops_session_data(driver, brand):
    """
    Lay (entity_id, csrf_token, user_name).
    Chien luoc:
      1. Vao /home (Amazon thuong redirect them entityId vao URL)
      2. Lay entityId tu URL/HTML
      3. Vao /bulk-operations?entityId=<id> de boostrap CSRF
      4. Lay csrfToken + userName tu HTML cua trang /bulk-operations
      5. Neu thieu, dump page source vao debug_amz/ de minh check
    """
    entity_id = None
    csrf_token = None
    user_name = None

    # ---- Buoc 1: tu URL hien tai (vd /reports) ----
    m = re.search(r'entityId=(ENTITY[A-Z0-9]+)', driver.current_url)
    if m:
        entity_id = m.group(1)
        logging.info(f"[{brand}] entityId lay tu URL hien tai: {entity_id}")

    # ---- Buoc 2: vao /home de buoc Amazon redirect entityId ----
    if not entity_id:
        try:
            driver.get("https://advertising.amazon.com/home")
            time.sleep(random.uniform(4, 6))
            m = re.search(r'entityId=(ENTITY[A-Z0-9]+)', driver.current_url)
            if m:
                entity_id = m.group(1)
                logging.info(f"[{brand}] entityId lay tu /home redirect: {entity_id}")
            else:
                # quet trong page state cua /home
                scan = _scan_page_for_session_data(driver)
                if scan.get('entityId'):
                    entity_id = scan['entityId']
                    logging.info(f"[{brand}] entityId lay tu /home page state: {entity_id}")
        except Exception as e:
            logging.warning(f"[{brand}] Khong load duoc /home: {e}")

    # ---- Buoc 3: vao /bulk-operations (co entityId neu da co) ----
    if entity_id:
        target = f"https://advertising.amazon.com/bulk-operations?entityId={entity_id}"
    else:
        target = "https://advertising.amazon.com/bulk-operations"
    driver.get(target)
    time.sleep(random.uniform(6, 9))

    # Quet 1 lan tat ca thong tin tu /bulk-operations page
    scan = _scan_page_for_session_data(driver)
    logging.info(
        f"[{brand}] Scan /bulk-operations: url={scan.get('currentUrl','')[:120]} "
        f"htmlLen={scan.get('htmlLength')} ready={scan.get('readyState')}")

    if not entity_id:
        entity_id = scan.get('entityId')
    csrf_token = scan.get('csrfToken')
    user_name = scan.get('userName')

    # ---- Buoc 4: dump HTML neu thieu csrf hoac entityId ----
    if not (entity_id and csrf_token):
        try:
            debug_dir = r"E:\PythonProject1\debug_amz"
            os.makedirs(debug_dir, exist_ok=True)
            debug_path = os.path.join(
                debug_dir, f"bulkops_{brand}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.html")
            with open(debug_path, 'w', encoding='utf-8') as f:
                f.write(driver.page_source)
            logging.warning(f"[{brand}] Da luu HTML debug: {debug_path}")
        except Exception:
            pass

    return entity_id, csrf_token, user_name


def _build_session_from_driver(driver, entity_id):
    """Tao requests.Session() voi cookies + headers tu Selenium driver."""
    session = requests.Session()
    for c in driver.get_cookies():
        try:
            session.cookies.set(c['name'], c['value'], domain=c.get('domain'))
        except Exception:
            pass
    try:
        ua = driver.execute_script('return navigator.userAgent;')
    except Exception:
        ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
    session.headers.update({
        'User-Agent': ua,
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://advertising.amazon.com',
        'Referer': f'https://advertising.amazon.com/bulk-operations?entityId={entity_id}',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
    })
    return session


def _build_bulksheet_payload(entity_id, user_name, today, days, sp_flag, sb_flag):
    """
    Tao payload bulksheet export.
    Khoang ngay: end = yesterday, start = today - days - 2 (khop voi behavior cua UI Amazon
    quan sat trong HAR: 30-day preset = today - 32 ngay -> today - 1 ngay).
    """
    end_date = today - timedelta(days=1)
    start_date = today - timedelta(days=days + 2)
    return {
        "entityId": entity_id,
        "sheetProductType": "SPONSORED",
        "userName": user_name or "",
        "startDateStr": start_date.strftime("%Y-%m-%d"),
        "endDateStr": end_date.strftime("%Y-%m-%d"),
        "timeZone": "Asia/Bangkok",
        "keywordTargetState": "ALL",
        "includeTerminatedCampaigns": False,
        "includePausedCampaigns": True,
        "includeZeroImpressionEntities": True,
        "includePlacementData": True,
        "includeBrandAssetInfo": False,
        "includeSponsoredProductsData": sp_flag,
        "includeSponsoredBrandsData": sb_flag,
        "includeSponsoredBrandsV4Data": False,
        "includeSponsoredDisplayData": False,
        "includeSPClientSideValidation": False,
        "includeSpSearchTermReportData": False,
        "includeSbSearchTermReportData": False,
        "includeBudgetRulesData": False,
    }


def process_bulksheet(driver, wait, brand):
    """
    Submit 6 yeu cau bulksheet (SP/SB x 7/14/30 ngay) qua HTTP API
    /bulk-operations/export thay vi click UI.

    Quan trong:
    - Amazon enforce minimum 5000ms delay giua cac POST /bulk-operations/export.
      Phai cho >= 5.5s giua moi request, neu khong se HTTP 400
      "ValidationException: New download requested before fixed delay of 5000 ms".
    - Per-request retry: khi 1 request fail, KHONG restart ca batch (se gay duplicate
      SP-7d, va SB-* khong bao gio chay). Chi retry rieng request fail.
    - Mapping JSON duoc luu KE CA khi mot vai request fail (giu lai progress).
    """
    logging.info(f"[{brand}] Bat dau xu ly Bulksheet (HTTP API).")

    MIN_DELAY_SEC = 5.5       # Amazon yeu cau >= 5000ms giua cac request
    DELAY_JITTER = 1.5        # them 0..1.5s random
    POST_MAX_ATTEMPTS = 3     # so lan retry cho moi request rieng le
    SETUP_MAX_ATTEMPTS = 3

    # === Buoc 1: setup session (entityId + csrfToken). Retry rieng cho phan nay. ===
    entity_id = csrf_token = user_name = None
    session = export_url = None
    setup_error = None

    for setup_attempt in range(1, SETUP_MAX_ATTEMPTS + 1):
        try:
            driver.get("https://advertising.amazon.com/bulk-operations")
            time.sleep(random.uniform(6, 9))

            entity_id, csrf_token, user_name = _extract_bulkops_session_data(driver, brand)

            if not entity_id:
                raise Exception(f"Khong tim thay entityId trong URL: {driver.current_url}")
            if not csrf_token:
                debug_dir = r"E:\PythonProject1\debug_amz"
                os.makedirs(debug_dir, exist_ok=True)
                debug_path = os.path.join(
                    debug_dir, f"bulkops_{brand}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.html")
                try:
                    with open(debug_path, 'w', encoding='utf-8') as f:
                        f.write(driver.page_source)
                except Exception:
                    pass
                raise Exception(f"Khong trich xuat duoc csrfAuthToken (page saved: {debug_path})")
            if not user_name:
                logging.warning(f"[{brand}] Khong tim thay userName trong page, payload se co userName rong.")

            logging.info(
                f"[{brand}] entityId={entity_id} userName={user_name} csrfToken={csrf_token[:25]}...")

            session = _build_session_from_driver(driver, entity_id)
            csrf_decoded = unquote(csrf_token)
            export_url = (
                f"https://advertising.amazon.com/bulk-operations/export"
                f"?csrfAuthToken={quote(csrf_decoded, safe='')}"
            )
            break  # setup OK
        except Exception as e:
            setup_error = e
            logging.error(
                f"[{brand}] Setup bulkops session attempt {setup_attempt}/{SETUP_MAX_ATTEMPTS} that bai: {e}",
                exc_info=True)
            if setup_attempt < SETUP_MAX_ATTEMPTS:
                time.sleep(15)
    else:
        # Het luot setup -> bao loi va return
        msg = (
            f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n"
            f"❌ _Setup session Bulksheet that bai sau {SETUP_MAX_ATTEMPTS} lan_\n"
            f"Loi: `{escape_markdown(str(setup_error).splitlines()[0])}`"
        )
        send_telegram_message(msg)
        return

    # === Buoc 2: submit 6 request voi per-request retry + delay >=5.5s ===
    today = datetime.now(VN_TZ).date()
    date_ranges = [7, 14, 30]
    products = [("SP", True, False), ("SB", False, True)]

    request_records = []
    last_post_time = 0.0

    def _wait_min_delay(label_for_log):
        nonlocal last_post_time
        if last_post_time == 0.0:
            return
        elapsed = time.time() - last_post_time
        min_delay = MIN_DELAY_SEC + random.uniform(0, DELAY_JITTER)
        if elapsed < min_delay:
            wait_sec = min_delay - elapsed
            logging.info(f"[{brand}] Cho {wait_sec:.1f}s truoc khi POST {label_for_log} (Amazon 5000ms guard).")
            time.sleep(wait_sec)

    for label, sp, sb in products:
        for days in date_ranges:
            req_label = f"{label}-{days}d"
            payload = _build_bulksheet_payload(entity_id, user_name, today, days, sp, sb)

            record = None
            for post_attempt in range(1, POST_MAX_ATTEMPTS + 1):
                _wait_min_delay(req_label)
                try:
                    r = session.post(export_url, json=payload, timeout=30)
                except Exception as e:
                    last_post_time = time.time()
                    logging.error(
                        f"[{brand}] {req_label} POST exception {post_attempt}/{POST_MAX_ATTEMPTS}: {e}")
                    continue

                last_post_time = time.time()

                if r.status_code == 200:
                    try:
                        body = r.json()
                    except Exception:
                        logging.error(
                            f"[{brand}] {req_label} response khong phai JSON: {r.text[:300]}")
                        continue
                    rid = body.get('exportRequestId')
                    if not rid:
                        logging.error(
                            f"[{brand}] {req_label} response thieu exportRequestId: {body}")
                        continue
                    logging.info(
                        f"[{brand}] OK Bulksheet {label} {days}d "
                        f"({payload['startDateStr']} -> {payload['endDateStr']}) -> {rid}")
                    record = {
                        "product": label,
                        "days": days,
                        "requestId": rid,
                        "startDate": payload['startDateStr'],
                        "endDate": payload['endDateStr'],
                    }
                    break  # request nay xong
                else:
                    body_text = r.text or ""
                    is_rate_limit = "fixed delay" in body_text.lower() or "5000 ms" in body_text
                    logging.error(
                        f"[{brand}] {req_label} POST attempt {post_attempt}/{POST_MAX_ATTEMPTS} "
                        f"HTTP {r.status_code}: {body_text[:300]}")
                    if is_rate_limit:
                        # Wait them lau hon de qua nguong 5000ms
                        backoff = MIN_DELAY_SEC + 3.0 + random.uniform(0, 2.0)
                        logging.info(f"[{brand}] Rate-limited -> cho them {backoff:.1f}s")
                        time.sleep(backoff)
                        last_post_time = time.time()
                    # voi loi khac, vong lap se gọi _wait_min_delay -> tu xu ly delay

            if record:
                request_records.append(record)
            else:
                logging.error(
                    f"[{brand}] BO QUA {req_label} sau {POST_MAX_ATTEMPTS} lan POST that bai.")
                msg = (
                    f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n"
                    f"⚠️ _Bo qua Bulksheet {escape_markdown(req_label)} "
                    f"sau {POST_MAX_ATTEMPTS} lan that bai_"
                )
                send_telegram_message(msg)

    # === Buoc 3: luu mapping (ke ca partial) ===
    try:
        mapping_dir = os.path.join(
            r"E:\PythonProject1\bulksheet_requests",
            today.strftime("%Y%m%d"))
        os.makedirs(mapping_dir, exist_ok=True)
        mapping_path = os.path.join(mapping_dir, f"{brand}.json")
        mapping = {
            "brand": brand,
            "entityId": entity_id,
            "userName": user_name,
            "submittedDate": today.strftime("%Y-%m-%d"),
            "submittedAtUtc": datetime.utcnow().isoformat() + "Z",
            "requests": request_records,
        }
        with open(mapping_path, 'w', encoding='utf-8') as f:
            json.dump(mapping, f, ensure_ascii=False, indent=2)
        logging.info(f"[{brand}] Da luu mapping bulksheet -> {mapping_path}")
    except Exception as e:
        logging.error(f"[{brand}] Khong luu duoc mapping JSON: {e}")

    logging.info(f"[{brand}] Da submit {len(request_records)}/6 Bulksheet via HTTP API.")
    if len(request_records) == 6:
        emoji = "📄"
    elif len(request_records) > 0:
        emoji = "⚠️"
    else:
        emoji = "❌"
    msg = (
        f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n"
        f"{emoji} _Da submit {len(request_records)}/6 Bulksheet via HTTP API_"
    )
    send_telegram_message(msg)


def _process_bulksheet_via_ui_DEPRECATED(driver, wait, brand):
    """
    [DEPRECATED] Phien ban cu click UI - bi vo do Amazon doi giao dien (mat ID page-wrap).
    Giu lai phong khi can fallback.
    """
    logging.info(f"[{brand}] Bắt đầu xử lý Bulksheet.")
    while True:  # Vòng lặp thử lại
        try:
            driver.get("https://advertising.amazon.com/bulksheet/HomePage")
            # Chờ một element chung để đảm bảo trang đã tải
            wait.until(EC.presence_of_element_located((By.ID, "page-wrap")))
            time.sleep(random.uniform(3, 5))

            is_new_layout = False
            try:
                # Kiểm tra sự tồn tại của element layout mới với thời gian chờ ngắn
                short_wait = WebDriverWait(driver, 5)
                new_layout_label = short_wait.until(
                    EC.presence_of_element_located((By.XPATH, "//div[2]/div/div/div[2]/label")))

                # Xác nhận text của element
                if "Sponsored Products: Targeting and Keyword Filter" in new_layout_label.text:
                    is_new_layout = True
                    logging.info(f"[{brand}] Phát hiện layout Bulksheet MỚI.")
                    msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
                          f"📄 _Phát hiện account MỚI, xử lý theo luồng mới\\._"
                    send_telegram_message(msg)
                else:
                    # Element tồn tại nhưng text không khớp, vẫn là layout cũ
                    logging.info(f"[{brand}] Phát hiện layout Bulksheet CŨ (element có nhưng text khác).")
                    msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
                          f"📄 _Account CŨ, xử lý như bình thường\\._"
                    send_telegram_message(msg)
            except TimeoutException:
                # Không tìm thấy element của layout mới, chắc chắn là layout cũ
                logging.info(f"[{brand}] Phát hiện layout Bulksheet CŨ (không tìm thấy element mới).")
                msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
                      f"📄 _Account CŨ, xử lý như bình thường\\._"
                send_telegram_message(msg)
                is_new_layout = False

            if is_new_layout:
                # --- LUỒNG MỚI (NEW ACCOUNT FLOW) ---
                uncheck_ids = [
                    "includeArchived", "includeBrandAssetInfo", "includeSponsoredBrandsData",
                    "includeSponsoredBrandsV4Data", "includeSponsoredDisplayData",
                    "includeSPClientSideValidation", "includeSpSearchTermReportData",
                    "includeSbSearchTermReportData", "includeBudgetRulesData"
                ]
                check_ids = ["includeZeroImpressionEntities", "includePlacementData", "includeSponsoredProductsData",
                             "includePausedCampaigns"]

                for checkbox_id in uncheck_ids:
                    try:
                        checkbox = driver.find_element(By.ID, checkbox_id)
                        if checkbox.is_selected():
                            driver.execute_script("arguments[0].click();", checkbox)
                            logging.info(f"[{brand}] Đã uncheck: {checkbox_id}")
                            time.sleep(random.uniform(0.5, 1))
                    except NoSuchElementException:
                        logging.warning(f"[{brand}] Không tìm thấy checkbox để uncheck: {checkbox_id}")

                for checkbox_id in check_ids:
                    try:
                        checkbox = driver.find_element(By.ID, checkbox_id)
                        if not checkbox.is_selected():
                            driver.execute_script("arguments[0].click();", checkbox)
                            logging.info(f"[{brand}] Đã check: {checkbox_id}")
                            time.sleep(random.uniform(0.5, 1))
                    except NoSuchElementException:
                        logging.warning(f"[{brand}] Không tìm thấy checkbox để check: {checkbox_id}")

                date_ranges = ["seven_days", "fourteen_days", "thirty_days"]

                # --- Yêu cầu cho SP (Luồng Mới) ---
                sp_checkbox = driver.find_element(By.ID, "includeSponsoredProductsData")
                if not sp_checkbox.is_selected():
                    driver.execute_script("arguments[0].click();", sp_checkbox);
                    time.sleep(1)
                sb_checkbox = driver.find_element(By.ID, "includeSponsoredBrandsData")
                if sb_checkbox.is_selected():
                    driver.execute_script("arguments[0].click();", sb_checkbox);
                    time.sleep(1)

                for date_range in date_ranges:
                    # === BẮT ĐẦU SỬA ===
                    # Dùng XPath ổn định hơn từ macro và click bằng Javascript
                    date_range_button = wait.until(
                        EC.presence_of_element_located(
                            (By.XPATH, '//*[@id="page-wrap"]/div/div[3]/div/div/div/div[2]/button')))  # Cập nhật XPath
                    driver.execute_script("arguments[0].scrollIntoView(true);", date_range_button)
                    time.sleep(1)
                    driver.execute_script("arguments[0].click();", date_range_button)  # Dùng JS click
                    time.sleep(random.uniform(2, 3))

                    # Click vào lựa chọn ngày bằng Javascript
                    range_option = wait.until(
                        EC.element_to_be_clickable((By.CSS_SELECTOR, f'button[value="{date_range}"]')))
                    driver.execute_script("arguments[0].click();", range_option)  # Dùng JS click
                    time.sleep(random.uniform(2, 3))
                    # === KẾT THÚC SỬA ===

                    # GIỮ NGUYÊN NÚT CREATE SPREADSHEET CỦA LAYOUT MỚI
                    create_button = wait.until(EC.element_to_be_clickable(
                        (By.XPATH, '//*[@id="page-wrap"]/div/div[3]/div/div/div/div[2]/div[4]/button')))
                    create_button.click()
                    time.sleep(random.uniform(5, 10))
                    logging.info(f"[{brand}] Đã yêu cầu Bulksheet SP (Layout Mới) - {date_range}.")

                # --- Yêu cầu cho SB (Luồng Mới) ---
                sb_checkbox = driver.find_element(By.ID, "includeSponsoredBrandsData")
                if not sb_checkbox.is_selected():
                    driver.execute_script("arguments[0].click();", sb_checkbox);
                    time.sleep(1)
                sp_checkbox = driver.find_element(By.ID, "includeSponsoredProductsData")
                if sp_checkbox.is_selected():
                    driver.execute_script("arguments[0].click();", sp_checkbox);
                    time.sleep(1)

                for date_range in date_ranges:
                    # === BẮT ĐẦU SỬA ===
                    # Dùng XPath ổn định hơn từ macro và click bằng Javascript
                    date_range_button = wait.until(
                        EC.presence_of_element_located(
                            (By.XPATH, '//*[@id="page-wrap"]/div/div[3]/div/div/div/div[2]/button')))  # Cập nhật XPath
                    driver.execute_script("arguments[0].scrollIntoView(true);", date_range_button)
                    time.sleep(1)
                    driver.execute_script("arguments[0].click();", date_range_button)  # Dùng JS click
                    time.sleep(random.uniform(2, 3))

                    # Click vào lựa chọn ngày bằng Javascript
                    range_option = wait.until(
                        EC.element_to_be_clickable((By.CSS_SELECTOR, f'button[value="{date_range}"]')))
                    driver.execute_script("arguments[0].click();", range_option)  # Dùng JS click
                    time.sleep(random.uniform(2, 3))
                    # === KẾT THÚC SỬA ===

                    # GIỮ NGUYÊN NÚT CREATE SPREADSHEET CỦA LAYOUT MỚI
                    create_button = wait.until(EC.element_to_be_clickable(
                        (By.XPATH, '//*[@id="page-wrap"]/div/div[3]/div/div/div/div[2]/div[4]/button')))
                    create_button.click()
                    time.sleep(random.uniform(5, 10))
                    logging.info(f"[{brand}] Đã yêu cầu Bulksheet SB (Layout Mới) - {date_range}.")
            else:
                # --- LUỒNG CŨ (OLD ACCOUNT FLOW) ---
                # Giữ nguyên code gốc
                uncheck_ids = [
                    "includeArchived", "includeBrandAssetInfo", "includeSponsoredBrandsData",
                    "includeSponsoredBrandsV4Data", "includeSponsoredDisplayData",
                    "includeSPClientSideValidation", "includeSpSearchTermReportData",
                    "includeSbSearchTermReportData", "includeBudgetRulesData"
                ]
                check_ids = ["includeZeroImpressionEntities", "includePlacementData", "includeSponsoredProductsData"]

                for checkbox_id in uncheck_ids:
                    checkbox = driver.find_element(By.ID, checkbox_id)
                    if checkbox.is_selected():
                        checkbox.click()
                        time.sleep(random.uniform(1, 2))
                for checkbox_id in check_ids:
                    checkbox = driver.find_element(By.ID, checkbox_id)
                    if not checkbox.is_selected():
                        checkbox.click()
                        time.sleep(random.uniform(1, 2))

                date_ranges = ["seven_days", "fourteen_days", "thirty_days"]
                for date_range in date_ranges:
                    # === BẮT ĐẦU SỬA ===
                    # Dùng XPath ổn định hơn từ macro và click bằng Javascript
                    date_range_button = wait.until(
                        EC.presence_of_element_located(
                            (By.XPATH, '//*[@id="page-wrap"]/div/div[3]/div/div/div/div[2]/button')))  # Cập nhật XPath
                    driver.execute_script("arguments[0].scrollIntoView(true);", date_range_button)
                    time.sleep(1)
                    driver.execute_script("arguments[0].click();", date_range_button)  # Dùng JS click
                    time.sleep(random.uniform(2, 3))

                    # Click vào lựa chọn ngày bằng Javascript
                    range_option = wait.until(
                        EC.element_to_be_clickable((By.CSS_SELECTOR, f'button[value="{date_range}"]')))
                    driver.execute_script("arguments[0].click();", range_option)  # Dùng JS click
                    time.sleep(random.uniform(2, 3))
                    # === KẾT THÚC SỬA ===

                    create_button = wait.until(EC.element_to_be_clickable(
                        (By.XPATH, '//*[@id="page-wrap"]/div/div[3]/div[1]/div/div/div[2]/div[3]/button')))
                    create_button.click()
                    time.sleep(random.uniform(5, 10))
                    logging.info(f"[{brand}] Đã yêu cầu Bulksheet SP - {date_range}.")

                sb_checkbox = driver.find_element(By.ID, "includeSponsoredBrandsData")
                if not sb_checkbox.is_selected():
                    sb_checkbox.click()
                    time.sleep(random.uniform(1, 2))
                sp_checkbox = driver.find_element(By.ID, "includeSponsoredProductsData")
                if sp_checkbox.is_selected():
                    sp_checkbox.click()
                    time.sleep(random.uniform(1, 2))

                for date_range in date_ranges:
                    # === BẮT ĐẦU SỬA ===
                    # Dùng XPath ổn định hơn từ macro và click bằng Javascript
                    date_range_button = wait.until(
                        EC.presence_of_element_located(
                            (By.XPATH, '//*[@id="page-wrap"]/div/div[3]/div/div/div/div[2]/button')))  # Cập nhật XPath
                    driver.execute_script("arguments[0].scrollIntoView(true);", date_range_button)
                    time.sleep(1)
                    driver.execute_script("arguments[0].click();", date_range_button)  # Dùng JS click
                    time.sleep(random.uniform(2, 3))

                    # Click vào lựa chọn ngày bằng Javascript
                    range_option = wait.until(
                        EC.element_to_be_clickable((By.CSS_SELECTOR, f'button[value="{date_range}"]')))
                    driver.execute_script("arguments[0].click();", range_option)  # Dùng JS click
                    time.sleep(random.uniform(2, 3))
                    # === KẾT THÚC SỬA ===

                    create_button = wait.until(EC.element_to_be_clickable(
                        (By.XPATH, '//*[@id="page-wrap"]/div/div[3]/div[1]/div/div/div[2]/div[3]/button')))
                    create_button.click()
                    time.sleep(random.uniform(5, 10))
                    logging.info(f"[{brand}] Đã yêu cầu Bulksheet SB - {date_range}.")

            logging.info(f"[{brand}] Đã yêu cầu tất cả Bulksheet thành công.")
            logging.info(f"[{brand}] Kết thúc xử lý Bulksheet.")
            break  # Thoát khỏi vòng lặp nếu thành công
        except Exception as e:
            logging.error(f"[{brand}] Lỗi khi xử lý Bulksheet: {e}", exc_info=True)
            msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
                  f"❌ _Lỗi khi xử lý Bulksheet_\n" \
                  f"Lỗi: `{escape_markdown(str(e).splitlines()[0])}`"
            send_telegram_message(msg)
            logging.info(f"[{brand}] Sẽ thử lại xử lý Bulksheet sau 10 giây...")
            time.sleep(10)


def process_profile(args):
    api_url, profile_id, brand = args
    if not brand:
        logging.error(f"[profile_id: {profile_id}] Không có tên brand, bỏ qua.")
        return (str(profile_id), False)

    logging.info(f"--- Bắt đầu xử lý cho Profile ID: {profile_id}, Brand: {brand} ---")

    stagger_sec = STAGGER_DELAY_BY_BRAND.get(brand, 0)
    if stagger_sec > 0:
        logging.info(
            f"[{brand}] Stagger delay {stagger_sec}s de tranh trung login "
            f"voi cac brand khac.")
        msg = (f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n"
               f"⏳ _Chờ {stagger_sec}s để tránh trùng login song song\\.\\.\\._")
        send_telegram_message(msg)
        time.sleep(stagger_sec)

    msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
          f"🚀 _Bắt đầu xử lý store_"
    send_telegram_message(msg)

    profile_start_time = time.time()
    driver = None
    success = False

    try:
        debug_port, driver_path = open_profile(api_url, profile_id, brand)
        if not debug_port or not driver_path:
            raise Exception("Không thể mở profile từ AdsPower.")

        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"✅ _Mở profile thành công_"
        send_telegram_message(msg)

        driver = setup_webdriver(debug_port, driver_path)
        wait = WebDriverWait(driver, 20)
        driver.get("https://advertising.amazon.com/reports")
        time.sleep(5)

        # === NEW LOGIN MECHANISM ===
        if not login_if_needed_advertising(driver, wait, profile_id, brand):
            raise Exception("Đăng nhập Advertising thất bại.")

        # Verify we are on the correct page after login.
        # Retry 3 lan voi sleep tang dan (10s/20s/30s) — Amazon co the load >3 phut
        # khi peak (quan sat 2026-06-22).
        if not check_reports_page(driver, wait, brand, attempt_label="initial"):
            reload_delays = [10, 20, 30]
            reports_ok = False
            for idx, delay in enumerate(reload_delays, start=1):
                logging.warning(
                    f"[{brand}] Không vào được trang reports, reload lần {idx}/{len(reload_delays)} (chờ {delay}s)...")
                driver.get("https://advertising.amazon.com/reports")
                time.sleep(delay)
                if check_reports_page(driver, wait, brand, attempt_label=f"reload{idx}"):
                    reports_ok = True
                    break
            if not reports_ok:
                raise Exception("Không vào được trang reports sau khi đăng nhập và 3 lần reload.")
        # === END NEW LOGIN MECHANISM ===

        # --- THAY ĐỔI THỨ TỰ VÀ THÊM ĐIỀU KIỆN THỰC THI ---
        if BULK_FILE_ENABLED:
            process_bulksheet(driver, wait, brand)
        else:
            logging.info(f"[{brand}] Bỏ qua xử lý Bulksheet do BULK_FILE_ENABLED = False.")

        if SEARCH_TERM_ENABLED:
            process_search_term_reports(driver, wait, brand, profile_id)
        else:
            logging.info(f"[{brand}] Bỏ qua xử lý Search Term do SEARCH_TERM_ENABLED = False.")

        success = True

    except Exception as e:
        logging.error(f"[{brand}] Lỗi nghiêm trọng trong quá trình xử lý profile: {e}", exc_info=True)
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"☠️ _Lỗi nghiêm trọng khi xử lý_\n" \
              f"Lỗi: `{escape_markdown(str(e).splitlines()[0])}`"
        send_telegram_message(msg)
    finally:
        if driver:
            driver.quit()
        stop_profile(api_url, profile_id, brand)
        time.sleep(2)

        profile_end_time = time.time()
        profile_total_time = profile_end_time - profile_start_time
        minutes, seconds = divmod(profile_total_time, 60)

        if success:
            logging.info(f"--- Hoàn thành store {brand} trong {int(minutes)} phút {int(seconds)} giây ---")
            msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
                  f"🎉 _Hoàn thành xử lý store_\n" \
                  f"Thời gian: `{int(minutes)} phút {int(seconds)} giây`"
        else:
            logging.info(f"--- Kết thúc store {brand} (THẤT BẠI) sau {int(minutes)} phút {int(seconds)} giây ---")
            msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
                  f"⛔ _Kết thúc xử lý store \\(THẤT BẠI\\)_\n" \
                  f"Thời gian: `{int(minutes)} phút {int(seconds)} giây`"
        send_telegram_message(msg)

    return (brand, success)


if __name__ == "__main__":
    start_msg = f"🚀 *{escape_markdown(SCRIPT_NAME)}* \\- _Bắt đầu chạy script_"
    send_telegram_message(start_msg)
    logging.info("=============================================")
    logging.info(f"BẮT ĐẦU CHẠY SCRIPT: {SCRIPT_NAME}")
    logging.info("=============================================")

    api_url = read_local_api_file(LOCAL_API_PATH) or API_URL_DEFAULT
    while not check_api_status(api_url):
        logging.error("[SYSTEM] API AdsPower không hoạt động. Thử mở AdsPower...")
        send_telegram_message(
            f"⚠️ *{escape_markdown(SCRIPT_NAME)}* \\- _API AdsPower không hoạt động. Đang thử khởi động\\.\\.\\._")
        subprocess.Popen(ADDSPOWER_PATH)
        time.sleep(10)

    # Note: get_sheet_data initializes 'gc' in the main process.
    # The fix ensures 'gc' is also initialized in child processes.
    profile_data = get_sheet_data(GOOGLE_API_KEYFILE)
    if not profile_data:
        logging.critical("[SYSTEM] Không thể lấy dữ liệu từ Google Sheet. Dừng script.")
        error_msg = f"☠️ *{escape_markdown(SCRIPT_NAME)}* \\- _Không thể lấy dữ liệu từ Google Sheet. Dừng script._"
        send_telegram_message(error_msg)
        exit()

    if not list(profile_data.keys()):
        logging.error("[SYSTEM] Không có profile_id hợp lệ trong sheet.")
        error_msg = f"⚠️ *{escape_markdown(SCRIPT_NAME)}* \\- _Không có profile_id hợp lệ trong Google Sheet._"
        send_telegram_message(error_msg)
        exit()

    overall_start_time = time.time()

    args_list = [(api_url, profile_id, brand) for profile_id, brand in profile_data.items()]
    with Pool(processes=6) as pool:
        results = pool.map(process_profile, args_list)

    overall_end_time = time.time()
    overall_total_time = overall_end_time - overall_start_time
    minutes, seconds = divmod(overall_total_time, 60)

    results = [r for r in results if r]
    succeeded = [b for b, ok in results if ok]
    failed = [b for b, ok in results if not ok]
    total = len(results)

    logging.info(f"TỔNG THỜI GIAN CHO TẤT CẢ STORES: {int(minutes)} phút {int(seconds)} giây")
    logging.info(f"Kết quả: thành công {len(succeeded)}/{total} | thất bại {len(failed)}/{total}")
    if failed:
        logging.error(f"Stores thất bại: {', '.join(failed)}")

    if not failed:
        end_msg = f"✅ *{escape_markdown(SCRIPT_NAME)}* \\- _Hoàn thành tất cả stores_\n" \
                  f"Tổng thời gian: `{int(minutes)} phút {int(seconds)} giây`\n" \
                  f"Thành công: `{len(succeeded)}/{total}`\n\n" \
                  f"⏳ _Đang chuẩn bị chạy {escape_markdown('Amz-02-download')}_\\.\\.\\."
    elif succeeded:
        failed_str = ", ".join(failed)
        end_msg = f"⚠️ *{escape_markdown(SCRIPT_NAME)}* \\- _Hoàn thành với lỗi_\n" \
                  f"Tổng thời gian: `{int(minutes)} phút {int(seconds)} giây`\n" \
                  f"Thành công: `{len(succeeded)}/{total}`\n" \
                  f"Thất bại: `{escape_markdown(failed_str)}`\n\n" \
                  f"⏳ _Đang chuẩn bị chạy {escape_markdown('Amz-02-download')} cho các store thành công_\\.\\.\\."
    else:
        failed_str = ", ".join(failed)
        end_msg = f"⛔ *{escape_markdown(SCRIPT_NAME)}* \\- _Tất cả stores đều thất bại_\n" \
                  f"Tổng thời gian: `{int(minutes)} phút {int(seconds)} giây`\n" \
                  f"Thất bại: `{escape_markdown(failed_str)}`\n\n" \
                  f"🛑 _Bỏ qua chạy {escape_markdown('Amz-02-download')} do không có dữ liệu_"
    send_telegram_message(end_msg)

    if not succeeded:
        logging.error("Không có store nào thành công. Bỏ qua chạy Amz-02-download.")
    else:
        logging.info("Bắt đầu chờ 2 phút...")
        time.sleep(120)
        logging.info("Bắt đầu chạy script Amz-02-download")
        subprocess.run([sys.executable, "E:\\PythonProject1\\Amz-02-download.py"], check=False)
