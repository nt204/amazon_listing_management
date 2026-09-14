import requests
import os
import json
import base64
import pandas as pd
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.by import By
from selenium.common.exceptions import TimeoutException, NoSuchElementException, StaleElementReferenceException
import time
import random
import gspread
from oauth2client.service_account import ServiceAccountCredentials
from datetime import datetime, timedelta
import logging
import pytz
from urllib.parse import quote
import subprocess
from multiprocessing import Pool
import re
import sys
# --- BẮT ĐẦU THÊM DÒNG MỚI ---
from urllib3.exceptions import ReadTimeoutError

# --- KẾT THÚC THÊM DÒNG MỚI ---

# --- CẤU HÌNH ---

# Thiết lập logging
VN_TZ = pytz.timezone('Asia/Ho_Chi_Minh')
current_date = datetime.now(VN_TZ).strftime("%Y%m%d")
# Cập nhật tên file log
log_file = f"E:\\PythonProject1\\Amzdata-02-download-{current_date}.txt"

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
TOPIC_ID = 1153
TELEGRAM_PROXY_URL = "https://nce-telegram-proxy.ntthanhnce.workers.dev"
SCRIPT_NAME = "Amz-02-download"

# Cấu hình đầu vào
LOCAL_API_PATH = r"C:\Users\Administrator\AppData\Roaming\adspower_global\cwd_global\source\local_api"
GOOGLE_API_KEYFILE = r"E:\PythonProject1\NCE_googleapi.json"
SPREADSHEET_URL = "https://docs.google.com/spreadsheets/d/1CBZuKZOjG9zxNrfdh3qgeofkwW1758ruZl-yT77_IeI/edit?gid=0#gid=0"
WORKSHEET_NAME = "APBrand"
API_URL_DEFAULT = "http://127.0.0.1:50325"
# DOWNLOAD_BASE_PATH = r"\\Nceglobal\design tong hop\1. DỮ LIỆU PPC\DỮ LIỆU ĐẦU VÀO"
DOWNLOAD_BASE_PATH = r"E:\PPC\DỮ LIỆU ĐẦU VÀO"
ADDSPOWER_PATH = r"C:\Program Files\AdsPower Global\AdsPower Global.exe"

# Cấu hình bật/tắt cho các khoảng thời gian
ENABLE_7_DAYS = False
ENABLE_14_DAYS = False
ENABLE_30_DAYS = True

# Cấu hình signature
USE_SIGNATURE = False
SIGNATURE = "Thanh"

# Anti-loop / timeout guards (process_profile.outer_loop)
MAX_RETRY_ATTEMPTS = 30                  # 30 x 5p = ~2.5h tong cho moi brand
MAX_RECREATE_PER_REPORT = 3              # toi da re-create 1 Search Term report
LOGIN_RECHECK_EVERY_N_RETRIES = 6        # re-check login moi ~30 phut
BULKSHEET_CREATING_TIMEOUT_RETRIES = 12  # row "Creating" qua 1h thi treat la Failure

# Global gspread client
gc = None


# --- CÁC HÀM HỖ TRỢ ---

def escape_markdown(text):
    """Hàm hỗ trợ escape các ký tự đặc biệt của MarkdownV2."""
    escape_chars = r'_*[]()~`>#+-=|{}.!'
    return ''.join(f'\\{char}' if char in escape_chars else char for char in str(text))


def clean_for_log(markdown_text):
    """Làm sạch tin nhắn Markdown để ghi log cho dễ đọc."""
    emojis_to_remove = ['🚀', '✅', '❌', '🔑', '💥', '?', '⚠️', '☠️', '📄', '⏳', '🎉', '🔄']
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


# --- CÁC HÀM CHỨC NĂNG ---

def get_required_files(brand, current_date):
    required_files = []
    time_ranges = []
    if ENABLE_7_DAYS: time_ranges.append("7 day")
    if ENABLE_14_DAYS: time_ranges.append("14 day")
    if ENABLE_30_DAYS: time_ranges.append("30 day")

    for time_range in time_ranges:
        for file_type in ["SP", "SB"]:
            file_name_base = f"{brand} Bulk File {file_type} {current_date} ({time_range}).xlsx"
            file_name = f"{SIGNATURE} {file_name_base}" if USE_SIGNATURE else file_name_base
            required_files.append(file_name)

    for file_type in ["SB", "SP"]:
        file_name_base = f"{brand} Search Term {file_type} {current_date} (30 day).xlsx"
        file_name = f"{SIGNATURE} {file_name_base}" if USE_SIGNATURE else file_name_base
        required_files.append(file_name)
    return required_files


def get_successfully_downloaded_files(log_file_path, brand, all_required_files):
    """
    Kiểm tra log file để lấy danh sách các file đã được tải thành công cho một brand cụ thể.
    Sử dụng logic "contains" để kiểm tra.
    """
    downloaded = set()
    log_lines = []
    try:
        # Đọc tất cả các dòng một lần để tránh vấn đề truy cập file đồng thời
        with open(log_file_path, 'r', encoding='utf-8') as f:
            log_lines = f.readlines()
    except FileNotFoundError:
        logging.info(f"[{brand}] File log '{log_file_path}' chưa tồn tại, bắt đầu tải từ đầu.")
        return downloaded
    except Exception as e:
        logging.error(f"[{brand}] Lỗi không mong muốn khi đọc file log: {e}")
        return downloaded

    # Lọc các dòng log thành công của brand hiện tại để tối ưu việc tìm kiếm
    brand_success_lines = [line for line in log_lines if f"[{brand}]" in line and "Đã tải và lưu file:" in line]

    # Với mỗi file yêu cầu, quét qua các dòng log đã lọc
    for required_file in all_required_files:
        for log_line in brand_success_lines:
            # Nếu dòng log chứa chính xác tên file yêu cầu, coi như đã tải
            if required_file in log_line:
                downloaded.add(required_file)
                break  # Đã tìm thấy, chuyển sang file yêu cầu tiếp theo

    if downloaded:
        logging.debug(f"[{brand}] Các file đã được tải thành công dựa trên log: {list(downloaded)}")
    return downloaded


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
# Giữ lại các hàm get_password, get_2fa, initialize_gspread từ bản gốc của Amz-02 vì chúng được thiết kế cho multiprocessing.
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


def check_reports_page(driver, wait, brand):
    # Selector chính theo text: bền với mọi thay đổi DOM/styled-component class
    # Fallback 1: XPath mới (2026-06-09) — phòng khi text đổi ngôn ngữ
    # Fallback 2: XPath cũ — phòng khi Amazon revert
    selectors = [
        (By.XPATH, "//button[normalize-space(.)='Create report']"),
        (By.XPATH, '//*[@id="application-container"]/div/div[2]/div/div[1]/div/div[1]/button'),
        (By.XPATH, '//*[@id="application-container"]/div/div[1]/div/div[1]/div/div[1]/button'),
    ]
    for by, sel in selectors:
        try:
            btn = wait.until(EC.presence_of_element_located((by, sel)))
            if btn.text.strip() == "Create report":
                return True
        except TimeoutException:
            continue
    logging.error(f"[{brand}] Không tìm thấy nút 'Create report' trên trang reports.")
    return False


_AG_CONTAINERS = (
    "div.ag-pinned-left-cols-container",
    "div.ag-center-cols-container",
    "div.ag-pinned-right-cols-container",
)


def _row_text_and_href(driver, idx):
    """
    Voi row-index cu the, gom text + link tu ca 3 ag-grid containers.
    Tra ve (full_text, href_or_None).
    """
    texts = []
    href = None
    for sel in _AG_CONTAINERS:
        try:
            row_el = driver.find_element(
                By.CSS_SELECTOR,
                f"{sel} div.ag-row[row-index='{idx}']"
            )
        except NoSuchElementException:
            continue
        try:
            txt = (row_el.get_attribute("innerText") or row_el.text or "").strip()
            if txt:
                texts.append(txt)
        except Exception:
            pass
        if href is None:
            try:
                link = row_el.find_element(By.CSS_SELECTOR, "a[data-takt-id='storm-ui-link']")
                href = link.get_attribute("href")
                if href and href.startswith('/'):
                    href = "https://advertising.amazon.com" + href
            except NoSuchElementException:
                pass
    return " ".join(texts), href


def _scrape_subscriptions_table(driver, brand, max_wait=30):
    """
    Doc bang urc-subscriptions-table tren trang /reports (newest-first).
    Tra ve list [{'idx', 'name', 'status', 'href', 'raw'}].
    status: 'Downloadable' | 'Failed' | 'InProgress' | 'Unknown'
    """
    deadline = time.time() + max_wait
    rows = []
    while time.time() < deadline:
        rows = driver.find_elements(
            By.CSS_SELECTOR,
            "div.ag-pinned-left-cols-container div.ag-row"
        )
        if not rows:
            rows = driver.find_elements(
                By.CSS_SELECTOR,
                "div.ag-center-cols-container div.ag-row"
            )
        if rows:
            break
        time.sleep(1)
    if not rows:
        logging.warning(f"[{brand}] Khong tim thay row trong subscriptions table.")
        return []

    # Dedup by row-index (left + center co the cung ton tai)
    seen_idx = set()
    indexed_rows = []
    for row in rows:
        idx = row.get_attribute("row-index") or row.get_attribute("aria-rowindex")
        if idx is None or idx in seen_idx:
            continue
        seen_idx.add(idx)
        indexed_rows.append(idx)

    # Sap xep theo row-index tang dan (newest-first la 0)
    try:
        indexed_rows.sort(key=lambda x: int(x))
    except Exception:
        pass

    out = []
    for idx in indexed_rows:
        full_text, href = _row_text_and_href(driver, idx)

        lower = full_text.lower()
        if "failed" in lower or "failure" in lower:
            status = "Failed"
        elif href:
            status = "Downloadable"
        elif any(k in lower for k in ("in progress", "pending", "creating", "running", "queued")):
            status = "InProgress"
        else:
            status = "Unknown"

        name = full_text.split('\n')[0].strip() if '\n' in full_text else full_text.strip()

        out.append({"idx": idx, "name": name, "status": status, "href": href, "raw": full_text})

    summary = " | ".join(f"[{r['idx']}]{r['name'][:40]}={r['status']}" for r in out[:6])
    logging.info(f"[{brand}] subscriptions table: {summary}")
    return out


def _find_row_for_report(rows, product, days):
    """Tim row newest-first khop voi 'Search Term {product}' va '({days} day)'."""
    name_token = f"Search Term {product}"
    days_token = f"({days} day)"
    for r in rows:
        haystack = r.get('raw') or r.get('name', '')
        if name_token in haystack and days_token in haystack:
            return r
    return None


def _recreate_sp_search_term_report(driver, wait, brand):
    """Re-request SP Search Term report (giong process_sp_report o Amz-01-request.py)."""
    logging.info(f"[{brand}] Re-request SP Search Term report do trang thai Failed.")
    driver.get("https://advertising.amazon.com/reports")
    time.sleep(random.uniform(3, 6))
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, 'button[data-takt-id="storm-ui-button"]')))

    button = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR,
        'button[data-takt-id="storm-ui-button"][data-takt-feature="unified-report-center:urc-subscriptions-table-container"]')))
    time.sleep(random.uniform(3, 6))
    button.click()

    time.sleep(random.uniform(3, 5))
    wait.until(EC.element_to_be_clickable((By.ID, "time-units-day"))).click()

    current_date_str = datetime.now().strftime("%Y%m%d")
    report_name = f"{brand} Search Term SP {current_date_str} (30 day)"
    name_input = wait.until(EC.presence_of_element_located((By.ID, "report-settings-card-report-name-input")))
    name_input.clear()
    name_input.send_keys(report_name)

    time.sleep(random.uniform(2, 4))
    wait.until(EC.element_to_be_clickable((By.ID, "urc_run_subscription_button"))).click()
    time.sleep(random.uniform(3, 5))
    logging.info(f"[{brand}] Da yeu cau re-create SP Search Term report.")


def _recreate_sb_search_term_report(driver, wait, brand):
    """Re-request SB Search Term report (giong process_sb_report o Amz-01-request.py)."""
    logging.info(f"[{brand}] Re-request SB Search Term report do trang thai Failed.")
    driver.get("https://advertising.amazon.com/reports")
    time.sleep(random.uniform(3, 6))

    button = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR,
        'button[data-takt-id="storm-ui-button"][data-takt-feature="unified-report-center:urc-subscriptions-table-container"]')))
    time.sleep(random.uniform(3, 6))
    button.click()

    time.sleep(random.uniform(3, 5))
    wait.until(EC.element_to_be_clickable(
        (By.ID, "report-configuration-form:report-category-control-component-0"))).click()

    time.sleep(random.uniform(3, 5))
    wait.until(EC.element_to_be_clickable(
        (By.CSS_SELECTOR, 'button[data-takt-id="storm-ui-dropdown-item"][value="sb"]'))).click()

    time.sleep(random.uniform(3, 5))
    wait.until(EC.element_to_be_clickable(
        (By.ID, "report-configuration-form:report-type-control-component-0"))).click()

    time.sleep(random.uniform(3, 5))
    wait.until(EC.element_to_be_clickable(
        (By.CSS_SELECTOR, 'button[data-takt-id="storm-ui-dropdown-item"][value="searchTerms"]'))).click()

    time.sleep(random.uniform(3, 5))
    wait.until(EC.element_to_be_clickable((By.ID, "time-units-day"))).click()

    current_date_str = datetime.now().strftime("%Y%m%d")
    report_name = f"{brand} Search Term SB {current_date_str} (30 day)"
    name_input = wait.until(EC.presence_of_element_located((By.ID, "report-settings-card-report-name-input")))
    name_input.clear()
    name_input.send_keys(report_name)

    time.sleep(random.uniform(2, 4))
    wait.until(EC.element_to_be_clickable((By.ID, "urc_run_subscription_button"))).click()
    time.sleep(random.uniform(3, 5))
    logging.info(f"[{brand}] Da yeu cau re-create SB Search Term report.")


def _download_search_term_file(driver, brand, file_name, download_dir, href):
    """Tai 1 file Search Term qua HTTP request voi cookie cua driver."""
    full_url = href if href.startswith('http') else "https://advertising.amazon.com" + href
    cookies = {c['name']: c['value'] for c in driver.get_cookies()}
    user_agent = driver.execute_script("return navigator.userAgent;")
    logging.info(f"[{brand}] Chuẩn bị tải file: {file_name}")
    start_time = time.time()
    try:
        response = requests.get(full_url, cookies=cookies, headers={'User-Agent': user_agent}, stream=True)
    except Exception as e:
        logging.error(f"[{brand}] Lỗi request tai file {file_name}: {e}")
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"❌ _Lỗi xử lý tải file_ `{escape_markdown(file_name)}`\n" \
              f"Lỗi: `{escape_markdown(e)}`"
        send_telegram_message(msg)
        return

    if response.status_code != 200:
        logging.error(f"[{brand}] Lỗi tải file {file_name} tu {full_url}: Status {response.status_code}")
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"❌ _Lỗi tải file_ `{escape_markdown(file_name)}`\n" \
              f"Status: `{response.status_code}`"
        send_telegram_message(msg)
        return

    file_path = os.path.join(download_dir, file_name)
    with open(file_path, 'wb') as f:
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)

    # Verify magic bytes XLSX. Amazon doi khi tra HTML error page voi status 200
    # -> file luu xuong khong phai zip, Amz-04 mo se loi "File is not a zip file".
    with open(file_path, 'rb') as f:
        magic = f.read(4)
    if not magic.startswith(b'PK\x03\x04'):
        logging.error(
            f"[{brand}] File tai ve khong phai XLSX (magic={magic!r}): {file_name}. Xoa de retry sau.")
        try:
            os.remove(file_path)
        except Exception:
            pass
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"❌ _File tải về không phải XLSX, đã xóa_ `{escape_markdown(file_name)}`"
        send_telegram_message(msg)
        return

    file_size_kb = os.path.getsize(file_path) / 1024
    formatted_size_kb = f"{file_size_kb:,.0f}".replace(",", ".")
    duration = time.time() - start_time
    minutes, seconds = divmod(duration, 60)

    logging.info(
        f"[{brand}] Đã tải và lưu file: {file_name} ({formatted_size_kb} KB) trong {int(minutes)} phút {int(seconds)} giây")
    msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
          f"📄 _Đã tải file_ `{escape_markdown(file_name)}`\n" \
          f"Dung lượng file: `{escape_markdown(formatted_size_kb)} KB`\n" \
          f"Thời gian: `{int(minutes)} phút {int(seconds)} giây`"
    send_telegram_message(msg)


def download_additional_reports(driver, wait, brand, download_dir, files_to_download, recreate_count):
    """
    Tai cac Search Term report tu trang /reports.
    Quy trinh:
      1. Scrape subscriptions table -> status moi row
      2. Voi report Failed hoac MISSING (Amz-01 chua request) -> re-request neu chua qua
         MAX_RECREATE_PER_REPORT, neu vuot thi bo qua
      3. Voi report Downloadable -> tai file qua HTTP
      4. Voi report khac (InProgress/Unknown) -> bo qua, cho 5p sau retry

    recreate_count: dict {(product, days): so_lan_da_re-create} - share giua cac retry,
    se duoc cap nhat tai cho.
    """
    logging.info(f"[{brand}] Bắt đầu tải file search term reports (chỉ tải các file thiếu).")
    driver.get("https://advertising.amazon.com/reports")
    time.sleep(5)

    current_date = datetime.now().strftime("%Y%m%d")
    targets = [("SB", 30), ("SP", 30)]

    rows = _scrape_subscriptions_table(driver, brand)

    # Phase 1: phat hien Failed/Missing va re-request (co gioi han)
    recreated_any = False
    for product, days in targets:
        file_name_base = f"{brand} Search Term {product} {current_date} ({days} day).xlsx"
        file_name = f"{SIGNATURE} {file_name_base}" if USE_SIGNATURE else file_name_base
        if file_name not in files_to_download:
            continue

        row = _find_row_for_report(rows, product, days)

        # Quyet dinh co can re-create khong
        if row is None:
            reason = "MISSING_ROW"
        elif row['status'] == 'Failed':
            reason = "FAILED"
        else:
            continue  # InProgress/Downloadable/Unknown -> khong re-create

        key = (product, days)
        cnt = recreate_count.get(key, 0)
        if cnt >= MAX_RECREATE_PER_REPORT:
            logging.error(
                f"[{brand}] Search Term {product} {days}d {reason} nhung da re-create "
                f"{cnt}/{MAX_RECREATE_PER_REPORT} lan -> bo qua, cho timeout cycle.")
            continue

        logging.error(
            f"[{brand}] Search Term {product} {days}d = {reason} -> re-request "
            f"(lan {cnt + 1}/{MAX_RECREATE_PER_REPORT}).")
        msg = (f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n"
               f"⚠️ _Search Term {escape_markdown(product)} {days} day = "
               f"{escape_markdown(reason)}, re\\-request lần {cnt + 1}/{MAX_RECREATE_PER_REPORT}\\._")
        send_telegram_message(msg)
        try:
            if product == "SP":
                _recreate_sp_search_term_report(driver, wait, brand)
            else:
                _recreate_sb_search_term_report(driver, wait, brand)
            recreate_count[key] = cnt + 1
            recreated_any = True
        except Exception as e:
            logging.error(f"[{brand}] Loi khi re-create {product} report: {e}", exc_info=True)
            msg = (f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n"
                   f"❌ _Lỗi khi re\\-create {escape_markdown(product)} report_\n"
                   f"Lỗi: `{escape_markdown(str(e).splitlines()[0])}`")
            send_telegram_message(msg)

    # Neu da re-create thi rows bi stale -> re-scrape de Phase 2 chinh xac
    if recreated_any:
        driver.get("https://advertising.amazon.com/reports")
        time.sleep(5)
        rows = _scrape_subscriptions_table(driver, brand)

    # Phase 2: tai cac report Downloadable
    for product, days in targets:
        file_name_base = f"{brand} Search Term {product} {current_date} ({days} day).xlsx"
        file_name = f"{SIGNATURE} {file_name_base}" if USE_SIGNATURE else file_name_base
        if file_name not in files_to_download:
            continue

        row = _find_row_for_report(rows, product, days)
        if not row:
            continue
        if row['status'] != 'Downloadable' or not row['href']:
            logging.info(
                f"[{brand}] Search Term {product} {days}d status={row['status']}, chưa tải lần này.")
            continue

        try:
            _download_search_term_file(driver, brand, file_name, download_dir, row['href'])
        except Exception as e:
            logging.error(f"[{brand}] Lỗi khi tải file {file_name}: {e}", exc_info=True)
            msg = (f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n"
                   f"❌ _Lỗi xử lý tải file_ `{escape_markdown(file_name)}`\n"
                   f"Lỗi: `{escape_markdown(str(e).splitlines()[0])}`")
            send_telegram_message(msg)


def setup_webdriver(debug_port, driver_path):
    service = Service(executable_path=driver_path)
    chrome_options = Options()
    chrome_options.add_argument("--disable-blink-features=AutomationControlled")
    chrome_options.add_experimental_option("debuggerAddress", f"127.0.0.1:{debug_port}")
    driver = webdriver.Chrome(service=service, options=chrome_options)
    driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
        "source": "Object.defineProperty(navigator, 'webdriver', { get: () => undefined })"
    })

    # Bump urllib3 HTTP timeout giua Python client <-> chromedriver process.
    # Default Selenium = 120s. Khi fetch() bulksheet ~200MB qua duong truyen VN,
    # response tu chromedriver mat nhieu phut -> client time out (Read timed out).
    # Set 1200s (20 min) -- LON HON set_script_timeout (900s = 15 min) de Python
    # client kien nhan cho Chrome bao "script timeout" chinh thuc, thay vi tu cat
    # connection ngang (gay "Read timed out" giu nguyen file download phia browser).
    for attr_path in (
            ('_client_config', 'timeout'),
            ('_conn', 'timeout'),
    ):
        try:
            obj = driver.command_executor
            for a in attr_path[:-1]:
                obj = getattr(obj, a)
            setattr(obj, attr_path[-1], 1200)
        except Exception:
            pass
    return driver


# ============================================================
# === HTTP BULKSHEET DOWNLOAD (thay the UI-based luong cu) ===
# ============================================================
BULKSHEET_MAPPING_BASE_DIR = r"E:\PythonProject1\bulksheet_requests"


def _load_bulksheet_mapping(brand, date_str):
    """Doc mapping JSON do Amz-01-request.py luu. Return (dict|None, path)."""
    path = os.path.join(BULKSHEET_MAPPING_BASE_DIR, date_str, f"{brand}.json")
    if not os.path.exists(path):
        return None, path
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f), path
    except Exception as e:
        logging.error(f"[{brand}] Loi doc mapping {path}: {e}")
        return None, path


def _wait_for_chrome_download(download_dir, before_set, timeout_sec=600):
    """
    Cho cho mot file moi xuat hien trong download_dir (so voi before_set)
    va khong con .crdownload (download da hoan thanh).
    Return path full den file hoan tat, hoac None neu timeout.
    """
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        time.sleep(2)
        try:
            current = set(os.listdir(download_dir))
        except FileNotFoundError:
            continue
        new_files = current - before_set
        # Bo cac file dang download
        if any(f.endswith('.crdownload') for f in current):
            continue
        # File moi va khong phai .crdownload
        new_xlsx = [f for f in new_files
                    if f.lower().endswith('.xlsx') and not f.endswith('.crdownload')]
        if new_xlsx:
            # Lay file moi nhat
            paths = [(f, os.path.getmtime(os.path.join(download_dir, f)))
                     for f in new_xlsx]
            paths.sort(key=lambda x: x[1], reverse=True)
            return os.path.join(download_dir, paths[0][0])
    return None


def _scrape_new_bulkops_download_links(driver, brand):
    """
    Scrape NEW /bulk-operations page de tim TAT CA link download xlsx.
    Tra ve list of dicts: [{uuid, href, rowText}, ...]

    Why list (not dict): Amazon dung outputId (KHAC voi exportRequestId Amz-01 luu).
    UUID-keyed dict khong match duoc. Caller can text-match qua rowText de tim dung
    link cho moi (product, days) request.

    Tim 3 noi:
        1. <a href="..."> co chua "BulkSheetExport" hoac "/bulk-operations/download/"
        2. <button data-download-url="...">
        3. Any element with data-* attribute pointing to download URL

    rowText = innerText cua TR/role=row gan nhat (chua product name, date range,
    submission time). Caller dung text nay de match.
    """
    js = r"""
    const results = [];
    const seen = new Set();

    function pickRowText(el) {
        // Walk up <=8 cap de tim row container
        let node = el;
        for (let i = 0; i < 8 && node; i++) {
            const role = node.getAttribute && node.getAttribute('role');
            if (node.tagName === 'TR' || role === 'row') {
                const t = node.innerText || node.textContent || '';
                return t.replace(/\s+/g, ' ').trim().slice(0, 800);
            }
            node = node.parentElement;
        }
        // Fallback: closest list-item/section
        const c = el.closest && el.closest('li, section, [class*="row"], [class*="Row"]');
        if (c) {
            const t = c.innerText || c.textContent || '';
            return t.replace(/\s+/g, ' ').trim().slice(0, 800);
        }
        return '';
    }

    function addCandidate(el, href) {
        if (!href) return;
        if (!(href.includes('/bulk-operations/download/') || href.includes('BulkSheetExport'))) return;
        const m = href.match(/\/([a-f0-9-]{36})\//);
        if (!m) return;
        const absHref = href.startsWith('http') ? href : (location.origin + href);
        const key = m[1] + '|' + absHref;
        if (seen.has(key)) return;
        seen.add(key);
        results.push({uuid: m[1], href: absHref, rowText: pickRowText(el)});
    }

    document.querySelectorAll('a[href]').forEach(a => {
        addCandidate(a, a.getAttribute('href'));
    });
    document.querySelectorAll('[data-href], [data-url], [data-download-url]').forEach(el => {
        ['data-href', 'data-url', 'data-download-url'].forEach(attr => {
            addCandidate(el, el.getAttribute(attr));
        });
    });
    return results;
    """
    try:
        raw = driver.execute_script(js) or []
    except Exception as e:
        logging.warning(f"[{brand}] Loi scrape links: {e}")
        return []

    # Trang NEW hien thi exportRequestId truc tiep trong rowText duoi dang
    # "ID: <uuid>" (vd: "Success Download Sponsored Ads Bulk File ... ID: fd994307-...")
    # outputId trong URL khac voi exportRequestId, nhung "ID:" trong rowText
    # CHINH XAC la exportRequestId Amz-01 luu vao mapping. Extract de match.
    id_re = re.compile(r'\bID:\s*([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\b',
                       re.IGNORECASE)
    for entry in raw:
        rt = entry.get('rowText') or ''
        m = id_re.search(rt)
        entry['requestId'] = m.group(1).lower() if m else None
    return raw


def _match_scraped_link(scraped_list, product, days, submitted_date_str,
                        already_used_hrefs):
    """
    Tim link tu scraped_list match (product, days) request.

    Strategies (theo thu tu uu tien):
        1. Row text chua "Sponsored Brands"/"Sponsored Products" + "X day(s)"
        2. Row text chua date marker khop submitted_date

    Returns href or None.
    """
    if not scraped_list:
        return None

    product_full = "Sponsored Brands" if product == "SB" else "Sponsored Products"
    # Day marker linh hoat: "30 day", "30 days", "Last 30 days"
    day_patterns = [
        f"{days} day",   # match "7 day" va "7 days"
        f"last {days}",  # match "Last 7 days"
    ]

    candidates = []
    for entry in scraped_list:
        href = entry.get('href')
        if not href or href in already_used_hrefs:
            continue
        text_lower = (entry.get('rowText') or '').lower()
        if product_full.lower() not in text_lower:
            continue
        if not any(p in text_lower for p in day_patterns):
            continue
        candidates.append(entry)

    if not candidates:
        return None

    # Neu nhieu candidates, uu tien row co date marker hom nay
    # submitted_date_str format "2026-06-05" -> tach Y/M/D va build markers
    try:
        y, m, d = submitted_date_str.split('-')
        date_markers = [
            submitted_date_str,                    # "2026-06-05"
            f"{int(m)}/{int(d)}/{y}",              # "6/5/2026"
            f"{int(m):02d}/{int(d):02d}/{y}",      # "06/05/2026"
            f"{y}/{int(m)}/{int(d)}",              # "2026/6/5"
        ]
        for entry in candidates:
            text = entry.get('rowText') or ''
            if any(mk in text for mk in date_markers):
                return entry['href']
    except Exception:
        pass

    # Default: link dau tien (page thuong list newest first)
    return candidates[0]['href']


def _construct_bulksheet_direct_url(entity_id, submitted_date_str, request_id):
    """
    Tao URL download truc tiep theo format moi cua Amazon Bulk Operations.
    Format (xac nhan tu HAR 2026-04-25 va 2026-06-05):
        /bulk-operations/download/BulkSheetExportOutput/{entityId}/{Y}/{M}/{D}/{requestId}/BulkSheetExport.xlsx
    Year/Month/Day KHONG co leading zero (vd: 2026/6/5, khong phai 2026/06/05).
    """
    y, m, d = submitted_date_str.split('-')
    # HAR cho thay URL co trailing '?' (empty query string). Mot so endpoint cua
    # Amazon kiem tra strict, them '?' de match chinh xac.
    return (
        f"https://advertising.amazon.com/bulk-operations/download/"
        f"BulkSheetExportOutput/{entity_id}/{int(y)}/{int(m)}/{int(d)}/"
        f"{request_id}/BulkSheetExport.xlsx?"
    )


def _download_bulksheet_direct(driver, brand, label, file_name, dest_path, direct_url):
    """
    Download bulksheet bang cach EXECUTE fetch() TRONG context cua trang
    /bulk-operations qua Selenium execute_async_script.

    Ly do KHONG dung window.open hoac requests.get:
    - Amazon endpoint /bulk-operations/download/... validate Sec-Fetch-Dest=empty,
      Sec-Fetch-Mode=cors (XHR/fetch context). Top-level navigation (window.open)
      gui Sec-Fetch-Dest=document -> Amazon reject (khong tra attachment).
    - Python requests gui HTTP/1.1 khong co client hints -> Amazon tra HTTP 400.
    - Chi co fetch() chay tu trong page la pass duoc tat ca check (HTTP/2, client
      hints, sec-fetch headers, same-origin cookies).

    Quy trinh: gui fetch() tu page -> nhan ArrayBuffer -> base64 encode trong JS
    -> tra ve Python -> decode va ghi file.

    Tra ve mot trong:
        'Download'  -> file da luu thanh cong vao dest_path
        'Creating'  -> response khong phai XLSX (Amazon chua generate xong)
        'Failure'   -> loi nghiem trong (4xx/5xx persistent hoac loi local)
    """
    download_dir = os.path.dirname(dest_path)
    os.makedirs(download_dir, exist_ok=True)

    # Polling-based fetch: kick fetch() vao window.__dlState_<id>, Python poll
    # moi 15s de:
    #   - Log progress (bytes / total) => user thay download dang chay
    #   - Detect Chrome hang som (poll throw exception thay vi cho 15 phut)
    #   - Tach state.data ra khoi poll thuong de tranh transfer 200MB+ moi
    #     lan poll. data chi duoc lay khi status === 'done'.
    state_id = f"dl_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"

    start_js = r"""
    const url = arguments[0];
    const stateKey = arguments[1];
    window[stateKey] = {status: 'starting', bytes: 0, total: 0};
    (async () => {
        const s = window[stateKey];
        try {
            const r = await fetch(url, {credentials: 'include', cache: 'no-cache'});
            const headersObj = {};
            r.headers.forEach((v, k) => { headersObj[k] = v; });
            s.headers = headersObj;
            s.httpStatus = r.status;
            s.finalUrl = r.url;
            if (!r.ok) {
                let body = '';
                try { body = await r.text(); } catch(e) { body = '<err: ' + e + '>'; }
                s.body = body.slice(0, 2000);
                s.status = 'error';
                s.error = 'HTTP ' + r.status;
                return;
            }
            s.total = parseInt(r.headers.get('content-length') || '0', 10);
            s.status = 'downloading';
            // Stream chunks (de track progress); neu body.getReader() khong support
            // (cuc hiem voi Chrome moi), fallback ve arrayBuffer().
            let merged;
            if (r.body && r.body.getReader) {
                const reader = r.body.getReader();
                const arrChunks = [];
                while (true) {
                    const {done, value} = await reader.read();
                    if (done) break;
                    arrChunks.push(value);
                    s.bytes += value.byteLength;
                }
                merged = new Uint8Array(s.bytes);
                let off = 0;
                for (const c of arrChunks) { merged.set(c, off); off += c.byteLength; }
            } else {
                const buf = await r.arrayBuffer();
                merged = new Uint8Array(buf);
                s.bytes = merged.length;
            }
            s.size = merged.length;

            // Base64 encode (chunked binary->string -> btoa).
            const encChunk = 0x8000;
            let binary = '';
            for (let i = 0; i < merged.length; i += encChunk) {
                binary += String.fromCharCode.apply(null, merged.subarray(i, i + encChunk));
            }
            const allB64 = btoa(binary);
            binary = null;  // GC hint

            // Chia base64 thanh chunks 4MB de Python fetch tung phan, tranh
            // chromedriver phai serialize 1 string ~280MB qua HTTP -> hit
            // script_timeout. substring trong V8 share buffer => khong nhan doi RAM.
            const CHUNK_B64 = 4 * 1024 * 1024;  // 4 MB / chunk
            s.chunks = [];
            for (let i = 0; i < allB64.length; i += CHUNK_B64) {
                s.chunks.push(allB64.substring(i, i + CHUNK_B64));
            }
            s.totalChunks = s.chunks.length;
            s.status = 'done';
        } catch (e) {
            s.status = 'error';
            s.error = String(e);
        }
    })();
    """

    # Poll lay status + bytes (KHONG kem data => moi poll < 1KB)
    poll_js = r"""
    const s = window[arguments[0]];
    if (!s) return {status: 'missing'};
    const out = {status: s.status, bytes: s.bytes || 0, total: s.total || 0};
    if (s.error) out.error = s.error;
    if (s.httpStatus) out.httpStatus = s.httpStatus;
    if (s.status === 'error') {
        out.headers = s.headers;
        out.body = s.body;
        out.finalUrl = s.finalUrl;
    }
    if (s.status === 'done') {
        out.totalChunks = s.totalChunks;
        out.size = s.size;
        out.headers = s.headers;
        out.finalUrl = s.finalUrl;
    }
    return out;
    """

    # Lay 1 chunk base64 (4MB) — duoc goi nhieu lan voi index tang dan
    fetch_chunk_js = r"""
    const s = window[arguments[0]];
    const i = arguments[1];
    if (!s || !s.chunks || i < 0 || i >= s.chunks.length) return null;
    return s.chunks[i];
    """

    cleanup_js = r"""
    try { delete window[arguments[0]]; } catch(e) {}
    """

    # set_script_timeout chi anh huong execute_async_script. execute_script (poll)
    # van bi gioi han boi urllib3 timeout cua command_executor (1200s o
    # setup_webdriver) => moi poll co toi da ~20 min, du.
    try:
        driver.set_script_timeout(900)
    except Exception:
        pass

    start_time = time.time()
    try:
        driver.execute_script(start_js, direct_url, state_id)
    except Exception as e:
        logging.error(f"[{brand}] {label} kick fetch loi: {type(e).__name__}: {e}")
        return 'Creating'

    logging.info(f"[{brand}] {label}: bat dau fetch -> {direct_url[:120]}")

    POLL_INTERVAL = 15
    MAX_WAIT = 900  # 15 phut tong cong cho 1 file
    last_logged_bytes = -1
    state = None
    while True:
        elapsed = time.time() - start_time
        if elapsed > MAX_WAIT:
            logging.warning(
                f"[{brand}] {label}: fetch timeout sau {elapsed:.0f}s, bo qua.")
            try: driver.execute_script(cleanup_js, state_id)
            except Exception: pass
            return 'Creating'
        try:
            state = driver.execute_script(poll_js, state_id)
        except Exception as e:
            logging.error(
                f"[{brand}] {label} poll loi sau {elapsed:.0f}s: "
                f"{type(e).__name__}: {str(e)[:200]}")
            return 'Creating'

        if not isinstance(state, dict):
            logging.warning(f"[{brand}] {label}: poll tra ve {state!r}, abort.")
            return 'Creating'

        st = state.get('status')
        bytes_dl = state.get('bytes', 0)
        total = state.get('total', 0)

        if st in ('done', 'error', 'missing'):
            break

        # Log progress moi khi bytes thay doi (boi periodic poll)
        if bytes_dl != last_logged_bytes:
            mb = bytes_dl / 1024 / 1024
            total_mb = total / 1024 / 1024 if total else 0
            pct = f"{bytes_dl * 100 / total:.1f}%" if total else "?"
            logging.info(
                f"[{brand}] {label}: tai {mb:.1f}MB"
                f"{'/' + f'{total_mb:.1f}MB' if total else ''} "
                f"({pct}) sau {elapsed:.0f}s")
            last_logged_bytes = bytes_dl

        time.sleep(POLL_INTERVAL)

    if st == 'missing':
        logging.warning(f"[{brand}] {label}: state mat tich (page reload?), abort.")
        return 'Creating'

    if st == 'error':
        err_preview = (state.get('error') or '')[:200]
        http_status = state.get('httpStatus')
        final_url = (state.get('finalUrl') or '')[:200]
        resp_headers = state.get('headers') or {}
        body_preview = (state.get('body') or '')[:1500]
        logging.warning(
            f"[{brand}] {label}: fetch status={http_status} error={err_preview} "
            f"finalUrl={final_url}")
        logging.warning(f"[{brand}] {label}: resp_headers={resp_headers}")
        logging.warning(f"[{brand}] {label}: body[:1500]={body_preview}")
        try: driver.execute_script(cleanup_js, state_id)
        except Exception: pass
        return 'Creating'

    # status == 'done': lay data theo chunks 4MB de tranh
    # chromedriver serialize JSON khong lo + HTTP timeout.
    total_chunks = int(state.get('totalChunks') or 0)
    expected_size = int(state.get('size') or 0)
    if total_chunks <= 0:
        logging.warning(f"[{brand}] {label}: state.done nhung khong co chunks.")
        try: driver.execute_script(cleanup_js, state_id)
        except Exception: pass
        return 'Creating'

    logging.info(
        f"[{brand}] {label}: fetch xong {expected_size/1024/1024:.1f}MB, "
        f"lay {total_chunks} chunk(s) 4MB...")

    b64_parts = []
    transfer_start = time.time()
    try:
        for i in range(total_chunks):
            try:
                chunk = driver.execute_script(fetch_chunk_js, state_id, i)
            except Exception as e:
                logging.error(
                    f"[{brand}] {label} fetch chunk {i}/{total_chunks} loi: "
                    f"{type(e).__name__}: {str(e)[:200]}")
                return 'Creating'
            if chunk is None:
                logging.warning(
                    f"[{brand}] {label}: chunk {i}/{total_chunks} null, abort.")
                return 'Creating'
            b64_parts.append(chunk)
            # Log moi 25% / hoac moi 5 chunks
            if total_chunks <= 5 or (i + 1) % max(1, total_chunks // 4) == 0 \
                    or i == total_chunks - 1:
                logging.info(
                    f"[{brand}] {label}: nhan chunk {i+1}/{total_chunks} "
                    f"({(i+1)*100/total_chunks:.0f}%) sau "
                    f"{time.time()-transfer_start:.0f}s")
    finally:
        try: driver.execute_script(cleanup_js, state_id)
        except Exception: pass

    full_b64 = ''.join(b64_parts)
    b64_parts = None  # free RAM

    # Decode base64 -> bytes
    try:
        data = base64.b64decode(full_b64)
    except Exception as e:
        logging.error(f"[{brand}] {label} decode base64 loi: {e}")
        return 'Failure'
    full_b64 = None

    if expected_size and len(data) != expected_size:
        logging.warning(
            f"[{brand}] {label}: size mismatch decoded={len(data)} "
            f"expected={expected_size}, abort.")
        return 'Creating'

    # Verify magic bytes XLSX (loai tru truong hop Amazon tra HTML/JSON)
    if not data.startswith(b'PK\x03\x04'):
        logging.warning(f"[{brand}] {label}: response khong phai XLSX "
                        f"(magic={data[:8]!r}, len={len(data)}), retry sau.")
        return 'Creating'

    # Ghi truc tiep ra dest_path
    try:
        with open(dest_path, 'wb') as f:
            f.write(data)
    except Exception as e:
        logging.error(f"[{brand}] {label} ghi file loi: {e}")
        return 'Failure'

    size_kb = len(data) / 1024
    duration = time.time() - start_time
    minutes, seconds = divmod(duration, 60)
    formatted = f"{size_kb:,.0f}".replace(",", ".")
    logging.info(
        f"[{brand}] Đã tải và lưu file: {file_name} "
        f"({formatted} KB) trong {int(minutes)} phút {int(seconds)} giây")
    msg = (f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n"
           f"📄 _Đã tải file_ `{escape_markdown(file_name)}`\n"
           f"Dung lượng file: `{escape_markdown(formatted)} KB`\n"
           f"Thời gian: `{int(minutes)} phút {int(seconds)} giây`")
    send_telegram_message(msg)
    return 'Download'


def _download_bulksheet_via_click(driver, brand, label, file_name, dest_path,
                                  direct_url):
    """
    Download bulksheet bang <a download>.click() trong page context thay vi fetch().

    Ly do: tu ~2026-06-30 Amazon /bulk-operations/download/... redirect cross-origin
    (S3 / CloudFront). fetch() voi credentials='include' bi browser tu choi vi S3
    response thieu Access-Control-Allow-Origin + Allow-Credentials phu hop ->
    TypeError: Failed to fetch (chua het wave 1 nen status/headers/body deu rong).

    <a download>.click() la "download navigation", browser xu ly redirect + cookies
    natively, bypass CORS check cua fetch (giong nhu user click that). Da xac nhan
    click thu cong work voi URL tu scraped href.

    Download dir cua Chrome duoc redirect ve dest folder cua brand qua CDP
    Page.setDownloadBehavior -> tranh nham giua cac brand song song dung chung
    default Downloads.

    Tra ve:
        'Download'  -> file da luu thanh cong vao dest_path
        'Creating'  -> file khong xuat hien sau timeout hoac sai magic bytes
                       (Amazon chua generate xong / response HTML error page)
        'Failure'   -> loi nghiem trong (CDP loi, click loi, rename loi)
    """
    download_dir = os.path.dirname(dest_path)
    os.makedirs(download_dir, exist_ok=True)

    try:
        driver.execute_cdp_cmd(
            "Page.setDownloadBehavior",
            {"behavior": "allow", "downloadPath": download_dir})
    except Exception as e:
        logging.warning(f"[{brand}] {label}: setDownloadBehavior loi: {e}")

    try:
        before_set = set(os.listdir(download_dir))
    except Exception:
        before_set = set()

    click_js = r"""
    const url = arguments[0];
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { try { document.body.removeChild(a); } catch(e){} }, 200);
    """
    start_time = time.time()
    try:
        driver.execute_script(click_js, direct_url)
    except Exception as e:
        logging.error(
            f"[{brand}] {label}: click trigger loi: {type(e).__name__}: {e}")
        return 'Failure'

    logging.info(f"[{brand}] {label}: trigger click -> {direct_url[:120]}")

    new_path = _wait_for_chrome_download(download_dir, before_set, timeout_sec=900)
    if not new_path:
        logging.warning(
            f"[{brand}] {label}: khong thay file moi trong {download_dir} sau 15 phut.")
        return 'Creating'

    try:
        with open(new_path, 'rb') as f:
            magic = f.read(4)
    except Exception as e:
        logging.error(f"[{brand}] {label}: doc magic loi: {e}")
        return 'Failure'

    if not magic.startswith(b'PK\x03\x04'):
        logging.error(
            f"[{brand}] {label}: file khong phai XLSX (magic={magic!r}). Xoa de retry.")
        try:
            os.remove(new_path)
        except Exception:
            pass
        return 'Creating'

    try:
        if os.path.exists(dest_path):
            os.remove(dest_path)
        os.rename(new_path, dest_path)
    except Exception as e:
        logging.error(
            f"[{brand}] {label}: rename {new_path} -> {dest_path} loi: {e}")
        return 'Failure'

    size_kb = os.path.getsize(dest_path) / 1024
    duration = time.time() - start_time
    minutes, seconds = divmod(duration, 60)
    formatted = f"{size_kb:,.0f}".replace(",", ".")
    logging.info(
        f"[{brand}] Đã tải và lưu file: {file_name} "
        f"({formatted} KB) trong {int(minutes)} phút {int(seconds)} giây")
    msg = (f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n"
           f"📄 _Đã tải file_ `{escape_markdown(file_name)}`\n"
           f"Dung lượng file: `{escape_markdown(formatted)} KB`\n"
           f"Thời gian: `{int(minutes)} phút {int(seconds)} giây`")
    send_telegram_message(msg)
    return 'Download'


def _download_bulksheet_file_via_oldpage(driver, href, dest_path,
                                         brand, label, file_name):
    """
    Click vao link Download cua row tren OLD page (qua JS) ->
    Chrome native download (302 -> S3 signed URL).
    Sau do rename file ve ten chuan cua brand.
    """
    download_dir = os.path.dirname(dest_path)
    os.makedirs(download_dir, exist_ok=True)

    # Set download dir cho Chrome (CDP)
    try:
        driver.execute_cdp_cmd("Page.setDownloadBehavior",
                               {"behavior": "allow", "downloadPath": download_dir})
    except Exception as e:
        logging.warning(f"[{brand}] {label} setDownloadBehavior loi: {e}")

    # Snapshot file co san truoc khi download
    try:
        before_set = set(os.listdir(download_dir))
    except Exception:
        before_set = set()

    start_time = time.time()
    try:
        # Tao anchor moi voi href dung -> click -> Chrome xu ly nhu user click that
        driver.execute_script(r"""
            const url = arguments[0];
            const a = document.createElement('a');
            a.href = url;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { try { document.body.removeChild(a); } catch(e){} }, 200);
        """, href)
    except Exception as e:
        logging.error(f"[{brand}] {label} click loi: {e}")
        return False

    new_path = _wait_for_chrome_download(download_dir, before_set, timeout_sec=600)
    if not new_path:
        logging.error(f"[{brand}] {label} timeout cho download (10 phut)")
        msg = (f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n"
               f"❌ _Timeout download file_ `{escape_markdown(file_name)}`")
        send_telegram_message(msg)
        return False

    try:
        if os.path.exists(dest_path):
            os.remove(dest_path)
        os.rename(new_path, dest_path)
    except Exception as e:
        logging.error(f"[{brand}] {label} rename loi: {e}")
        return False

    # Verify magic bytes XLSX (loai tru truong hop Chrome luu HTML error page voi ext .xlsx)
    try:
        with open(dest_path, 'rb') as f:
            magic = f.read(4)
    except Exception as e:
        logging.error(f"[{brand}] {label} read magic loi: {e}")
        return False
    if not magic.startswith(b'PK\x03\x04'):
        logging.error(
            f"[{brand}] {label} file khong phai XLSX (magic={magic!r}): {file_name}. Xoa de retry sau.")
        try:
            os.remove(dest_path)
        except Exception:
            pass
        msg = (f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n"
               f"❌ _File tải về không phải XLSX, đã xóa_ `{escape_markdown(file_name)}`")
        send_telegram_message(msg)
        return False

    size_kb = os.path.getsize(dest_path) / 1024
    duration = time.time() - start_time
    minutes, seconds = divmod(duration, 60)
    formatted = f"{size_kb:,.0f}".replace(",", ".")
    logging.info(
        f"[{brand}] Đã tải và lưu file: {file_name} "
        f"({formatted} KB) trong {int(minutes)} phút {int(seconds)} giây")
    msg = (f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n"
           f"📄 _Đã tải file_ `{escape_markdown(file_name)}`\n"
           f"Dung lượng file: `{escape_markdown(formatted)} KB`\n"
           f"Thời gian: `{int(minutes)} phút {int(seconds)} giây`")
    send_telegram_message(msg)
    return True


def download_bulksheet_via_oldpage(driver, mapping, brand, current_date,
                                   download_dir, files_to_download):
    """
    Download cac file bulksheet qua URL truc tiep cua trang NEW /bulk-operations.

    Lich su: Amazon retire trang /bulksheet/HomePage?noRedirect=true vao ~2026-06-05
    (truoc do trang OLD van con dung). HAR phan tich cho thay URL download truc tiep:
        /bulk-operations/download/BulkSheetExportOutput/{entityId}/{Y}/{M}/{D}/{requestId}/...
    Tat ca tham so deu co trong mapping JSON do Amz-01 luu, nen khong can scrape.

    Mapping JSON: { entityId, submittedDate (YYYY-MM-DD), requests: [{product, days, requestId}] }

    Tra ve dict {(product, days): status} de caller biet status nao Failure/Creating/Download.
    """
    entity_id = mapping['entityId']
    submitted_date = mapping.get('submittedDate')
    if not submitted_date:
        # Fallback: dung current_date dang YYYYMMDD chuyen ve YYYY-MM-DD
        submitted_date = f"{current_date[:4]}-{current_date[4:6]}-{current_date[6:8]}"
    requests_meta = mapping.get('requests', [])

    # Quan trong: navigate driver vao trang /bulk-operations TRUOC khi download.
    # Endpoint /bulk-operations/download/... validate CORS dua tren cookies + session
    # duoc set khi load trang /bulk-operations. Neu driver dang o /reports, cookies
    # khong day du -> Amazon tra HTTP 400 + HTML error page.
    try:
        bulk_ops_url = f"https://advertising.amazon.com/bulk-operations?entityId={entity_id}"
        driver.get(bulk_ops_url)
        time.sleep(random.uniform(8, 12))  # cho React table render xong
        logging.info(f"[{brand}] Da vao trang /bulk-operations.")
    except Exception as e:
        logging.warning(f"[{brand}] Loi khi vao trang /bulk-operations: {e}")

    # Scrape link Download thuc te tu page (React render). Tra ve list of
    # {uuid, href, rowText, requestId}.
    #   - uuid: outputId trong URL path (Amazon auto-generated)
    #   - requestId: exportRequestId trich tu "ID:" trong rowText (= Amz-01 luu mapping)
    # Match qua requestId tu rowText la chien luoc chinh (deterministic).
    scraped_list = _scrape_new_bulkops_download_links(driver, brand)
    scraped_by_requestId = {
        e['requestId']: e['href']
        for e in scraped_list if e.get('requestId')
    }
    scraped_by_uuid = {
        e['uuid']: e['href']
        for e in scraped_list if e.get('uuid')
    }
    logging.info(
        f"[{brand}] Tim thay {len(scraped_list)} link download tren NEW page "
        f"({len(scraped_by_requestId)} co ID requestId, "
        f"{len(scraped_by_uuid)} unique outputId).")
    if not scraped_list:
        # Dump page source de debug DOM moi
        try:
            debug_dir = r"E:\PythonProject1\debug_amz"
            os.makedirs(debug_dir, exist_ok=True)
            debug_path = os.path.join(
                debug_dir,
                f"newbulkops_{brand}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.html")
            with open(debug_path, 'w', encoding='utf-8') as f:
                f.write(driver.page_source)
            logging.warning(f"[{brand}] Da luu HTML debug NEW page: {debug_path}")
        except Exception:
            pass

    # Track hrefs da gan cho request truoc do de tranh 2 request match cung 1 link
    used_hrefs = set()
    # Dump 1 lan duy nhat khi fallback constructed URL (de phan tich DOM moi)
    fallback_dumped = False

    result_status = {}
    for rec in requests_meta:
        product = rec['product']
        days = rec['days']
        request_id = rec.get('requestId')
        result_status[(product, days)] = 'UNKNOWN'

        # Bo qua khoang ngay khong duoc enable
        if days == 7  and not ENABLE_7_DAYS:  continue
        if days == 14 and not ENABLE_14_DAYS: continue
        if days == 30 and not ENABLE_30_DAYS: continue

        if not request_id:
            logging.error(f"[{brand}] {product}-{days}d: mapping thieu requestId")
            result_status[(product, days)] = 'Failure'
            continue

        time_range = f"{days} day"
        file_name_base = f"{brand} Bulk File {product} {current_date} ({time_range}).xlsx"
        file_name = f"{SIGNATURE} {file_name_base}" if USE_SIGNATURE else file_name_base

        if file_name not in files_to_download:
            # Da co trong log -> coi nhu da tai
            result_status[(product, days)] = 'Download'
            continue

        dest = os.path.join(download_dir, file_name)
        label = f"{product}-{days}d"

        # Strategy 1 (preferred): match qua "ID:" extracted tu rowText
        #   = exportRequestId Amz-01 luu => link CHINH XAC cua row do.
        # Strategy 2: UUID match (chi work neu Amazon dung cung UUID — hiem).
        # Strategy 3: text-based fallback (product name + day range).
        direct_url = None
        match_strategy = None
        request_id_lower = (request_id or '').lower()
        if request_id_lower in scraped_by_requestId:
            direct_url = scraped_by_requestId[request_id_lower]
            match_strategy = "row-ID"
        elif request_id in scraped_by_uuid:
            direct_url = scraped_by_uuid[request_id]
            match_strategy = "uuid"
        else:
            matched_href = _match_scraped_link(
                scraped_list, product, days, submitted_date, used_hrefs)
            if matched_href:
                direct_url = matched_href
                match_strategy = "row-text"

        if direct_url:
            used_hrefs.add(direct_url)
            logging.info(f"[{brand}] {label}: matched scraped link ({match_strategy}).")
        elif scraped_list:
            # Scrape tim duoc rows nhung khong co row nao khop requestId cua request
            # nay -> Amazon chua generate xong (row chua render / row con "In progress"
            # khong co href). Constructed URL voi exportRequestId chac chan tra
            # NoSuchKey vi S3 dung outputId khac. Skip download, tra 'Creating' de
            # vong retry 2-phut re-scrape khi row moi xuat hien.
            if not fallback_dumped:
                try:
                    debug_dir = r"E:\PythonProject1\debug_amz"
                    os.makedirs(debug_dir, exist_ok=True)
                    debug_path = os.path.join(
                        debug_dir,
                        f"newbulkops_nomatch_{brand}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.html")
                    with open(debug_path, 'w', encoding='utf-8') as f:
                        f.write(driver.page_source)
                    sample = [
                        {"uuid": e.get('uuid'), "rowText": (e.get('rowText') or '')[:200]}
                        for e in scraped_list[:6]
                    ]
                    logging.warning(
                        f"[{brand}] Dump no-match HTML: {debug_path}; "
                        f"scraped sample: {sample}")
                    fallback_dumped = True
                except Exception:
                    pass
            logging.warning(
                f"[{brand}] {label}: KHONG match scraped link "
                f"({len(scraped_list)} candidates), skip -> Creating, doi retry sau.")
            result_status[(product, days)] = 'Creating'
            continue
        else:
            # Scrape tra 0 candidate -> Amazon co the doi DOM. Van thu constructed
            # URL nhu last resort (log warning ro rang de debug).
            direct_url = _construct_bulksheet_direct_url(
                entity_id, submitted_date, request_id)
            logging.warning(
                f"[{brand}] {label}: scrape 0 candidate, fallback constructed URL "
                f"(co the fail neu Amazon dung outputId khac).")

        status = _download_bulksheet_via_click(
            driver, brand, label, file_name, dest, direct_url)
        result_status[(product, days)] = status
        time.sleep(random.uniform(1.0, 2.0))

    return result_status


def process_profile(args):
    api_url, profile_id, brand = args
    if not brand:
        logging.error(f"[profile_id: {profile_id}] Không có tên brand, bỏ qua.")
        return 'GENERAL_ERROR'

    logging.info(f"--- Bắt đầu xử lý cho Profile ID: {profile_id}, Brand: {brand} ---")

    driver = None
    download_start_time = None
    try:
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"🚀 _Bắt đầu xử lý store_"
        send_telegram_message(msg)

        # === START: SỬA LOGIC THEO YÊU CẦU (1) ===
        # Ghi log các file cần tải ngay từ đầu để đảm bảo việc tải lại nếu có lỗi
        current_date_for_log = datetime.now(VN_TZ).strftime("%Y%m%d")
        all_required_files_for_log = get_required_files(brand, current_date_for_log)
        downloaded_files_for_log = get_successfully_downloaded_files(log_file, brand, all_required_files_for_log)
        files_to_download_for_log = [f for f in all_required_files_for_log if f not in downloaded_files_for_log]
        if files_to_download_for_log:
            logging.info(f"[{brand}] Các file cần tải lại: {files_to_download_for_log}")
        # === END: SỬA LOGIC THEO YÊU CẦU (1) ===

        debug_port, driver_path = open_profile(api_url, profile_id, brand)
        if not debug_port or not driver_path:
            raise Exception("Không thể mở profile từ AdsPower.")

        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"✅ _Mở profile thành công_"
        send_telegram_message(msg)

        current_date = datetime.now().strftime("%Y%m%d")
        download_dir = os.path.join(DOWNLOAD_BASE_PATH, current_date, brand)
        os.makedirs(download_dir, exist_ok=True)

        driver = setup_webdriver(debug_port, driver_path)
        wait = WebDriverWait(driver, 20)

        driver.get("https://advertising.amazon.com/reports")
        time.sleep(5)

        # === NEW LOGIN MECHANISM ===
        if not login_if_needed_advertising(driver, wait, profile_id, brand):
            raise Exception("Đăng nhập Advertising thất bại.")

        # Bỏ giới hạn ban đầu (while True) gây treo vô hạn khi Amazon đổi UI.
        # Giới hạn 15 lần ~ 15-20 phút. Hết thì raise -> rơi vào except, kết thúc store,
        # không chiếm worker mãi mãi (incident Bozspacer 10-15/06: kẹt vô hạn,
        # các script downstream skip do thiếu file).
        REPORTS_PAGE_MAX_ATTEMPTS = 15
        reports_page_ok = False
        for reports_page_attempts in range(1, REPORTS_PAGE_MAX_ATTEMPTS + 1):
            logging.info(f"[{brand}] Đang kiểm tra trang reports (Lần thử #{reports_page_attempts}/{REPORTS_PAGE_MAX_ATTEMPTS})...")

            if check_reports_page(driver, wait, brand):
                logging.info(f"[{brand}] Đã vào trang reports thành công.")
                reports_page_ok = True
                break

            logging.warning(
                f"[{brand}] Không vào được trang reports lần #{reports_page_attempts}. Thử biện pháp khắc phục.")

            # Biện pháp 1: Tải lại trang (F5)
            logging.info(f"[{brand}] Thử tải lại trang (F5)...")
            msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
                  f"⚠️ _Không vào được trang reports. Đang thử F5 (Lần {reports_page_attempts}/{REPORTS_PAGE_MAX_ATTEMPTS})\\._"
            send_telegram_message(msg)
            driver.refresh()
            time.sleep(10)

            if check_reports_page(driver, wait, brand):
                logging.info(f"[{brand}] Đã vào trang reports thành công sau khi F5.")
                reports_page_ok = True
                break

            # Biện pháp 2: Nếu F5 không thành công, thử dừng và mở lại profile
            logging.warning(f"[{brand}] F5 không hiệu quả. Thử dừng và mở lại profile.")
            msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
                  f"⚠️ _F5 không hiệu quả. Đang thử mở lại profile (Lần {reports_page_attempts}/{REPORTS_PAGE_MAX_ATTEMPTS})\\._"
            send_telegram_message(msg)

            if driver:
                driver.quit()
            stop_profile(api_url, profile_id, brand)
            time.sleep(5)

            debug_port, driver_path = open_profile(api_url, profile_id, brand)
            if not debug_port or not driver_path:
                logging.error(f"[{brand}] Không thể mở lại profile. Chờ và thử lại.")
                time.sleep(30)
                continue

            driver = setup_webdriver(debug_port, driver_path)
            wait = WebDriverWait(driver, 20)
            driver.get("https://advertising.amazon.com/reports")
            time.sleep(5)

            if not login_if_needed_advertising(driver, wait, profile_id, brand):
                logging.error(f"[{brand}] Đăng nhập thất bại sau khi mở lại profile. Sẽ thử lại.")
                continue

        if not reports_page_ok:
            raise Exception(
                f"Không vào được trang reports sau {REPORTS_PAGE_MAX_ATTEMPTS} lần thử. Bỏ qua store.")

        download_start_time = time.time()
        logging.info(f"[{brand}] Bắt đầu quy trình kiểm tra và tải file...")

        # Doc mapping (tu Amz-01-request)
        bulk_mapping, mapping_path = _load_bulksheet_mapping(brand, current_date)
        if not bulk_mapping:
            # KHONG escalate sang CRITICAL_FAILURE vi se gay vong lap:
            #   Amz-02 missing mapping -> trigger Amz-01 -> Amz-01 cuoi file os.system(Amz-02)
            #   -> Amz-02 van missing mapping -> trigger Amz-01 lan nua -> ... lap vo tan.
            # Thay vao do: skip brand nay, bao Telegram, de cac brand khac tiep tuc.
            err = (f"File mapping {mapping_path} khong ton tai. "
                   f"Bo qua brand {brand}. Chay Amz-01-request.py thu cong neu can.")
            logging.error(f"[{brand}] {err}")
            msg = (f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n"
                   f"⚠️ *Thiếu mapping bulksheet \\- bỏ qua store này*\n"
                   f"`{escape_markdown(mapping_path)}`\n"
                   f"_Cần chạy {escape_markdown('Amz-01-request.py')} thủ công để tạo mapping\\._")
            send_telegram_message(msg)
            return 'MAPPING_MISSING'

        # Cac (product, days) bat buoc theo ENABLE_*
        required_keys = set()
        for product in ("SP", "SB"):
            if ENABLE_30_DAYS: required_keys.add((product, 30))
            if ENABLE_14_DAYS: required_keys.add((product, 14))
            if ENABLE_7_DAYS:  required_keys.add((product, 7))

        # ===========================================================
        # === MAIN LOOP: visit OLD page, scrape, download ready files
        # === Retry moi 5 phut den khi log thay du tat ca file.
        # === Co giai han MAX_RETRY_ATTEMPTS de tranh loop vo tan.
        # ===========================================================
        all_required_files = get_required_files(brand, current_date)
        retry_attempt = 0
        # Trang thai chia se giua cac retry:
        recreate_count = {}                # {(product, days): so lan re-create Search Term}
        creating_since = {}                # {(product, days): retry_attempt khi bat dau Creating}

        while True:
            downloaded_files = get_successfully_downloaded_files(log_file, brand, all_required_files)
            files_to_download = [f for f in all_required_files if f not in downloaded_files]

            if not files_to_download:
                download_end_time = time.time()
                download_duration = download_end_time - download_start_time
                minutes, seconds = divmod(download_duration, 60)
                logging.info(
                    f"--- Hoàn thành tải đủ file cho store {brand} trong "
                    f"{int(minutes)} phút {int(seconds)} giây ---")
                msg = (f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n"
                       f"🎉 _Hoàn thành tải đủ file_\n"
                       f"Thời gian: `{int(minutes)} phút {int(seconds)} giây`")
                send_telegram_message(msg)
                return 'SUCCESS'

            # GIAI HAN MAX RETRY: tranh loop vo tan khi report stuck mai
            if retry_attempt >= MAX_RETRY_ATTEMPTS:
                logging.error(
                    f"[{brand}] Da thu {retry_attempt} lan (max={MAX_RETRY_ATTEMPTS}). "
                    f"Con thieu {len(files_to_download)} file. Bo brand nay.")
                msg = (f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n"
                       f"⏱️ *Timeout sau {retry_attempt} lần retry*\n"
                       f"_Còn thiếu {len(files_to_download)} file_\n"
                       f"`{escape_markdown(', '.join(files_to_download)[:300])}`")
                send_telegram_message(msg)
                return 'TIMEOUT'

            retry_attempt += 1
            logging.info(
                f"[{brand}] Lần thử #{retry_attempt}/{MAX_RETRY_ATTEMPTS}: "
                f"còn thiếu {len(files_to_download)} file.")
            logging.info(f"[{brand}] Các file cần tải lại: {files_to_download}")
            msg = (f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n"
                   f"🔄 _Lần thử \\#{retry_attempt}/{MAX_RETRY_ATTEMPTS} cho "
                   f"{len(files_to_download)} file thiếu\\._")
            send_telegram_message(msg)

            # PERIODIC RE-LOGIN: cookie/session co the het han sau nhieu retry
            if retry_attempt > 1 and (retry_attempt - 1) % LOGIN_RECHECK_EVERY_N_RETRIES == 0:
                logging.info(f"[{brand}] Re-check login tai retry #{retry_attempt}.")
                try:
                    driver.get("https://advertising.amazon.com/reports")
                    time.sleep(5)
                    if not login_if_needed_advertising(driver, wait, profile_id, brand):
                        logging.warning(f"[{brand}] Re-login fail, chờ retry sau.")
                        msg = (f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n"
                               f"⚠️ _Re\\-login fail tại retry \\#{retry_attempt}, chờ retry sau\\._")
                        send_telegram_message(msg)
                        time.sleep(300)
                        continue
                except Exception as e:
                    logging.error(f"[{brand}] Loi khi re-check login: {e}", exc_info=True)

            # Tai bulksheet qua trang OLD (?noRedirect=true)
            try:
                row_status = download_bulksheet_via_oldpage(
                    driver, bulk_mapping, brand, current_date,
                    download_dir, files_to_download)
            except Exception as e:
                logging.error(f"[{brand}] Loi khi xu ly OLD bulksheet page: {e}", exc_info=True)
                row_status = {}

            # Track Creating-stuck: row "Creating" qua BULKSHEET_CREATING_TIMEOUT_RETRIES lan
            # -> treat la Failure de Amz-01 cascade re-request.
            escalate_keys = []  # list of ((p, d), reason)
            for k in required_keys:
                s = row_status.get(k)
                if s == 'Failure':
                    escalate_keys.append((k, 'Failure'))
                    creating_since.pop(k, None)
                elif s == 'NO_ROW':
                    escalate_keys.append((k, 'NO_ROW (mapping co request nhung khong co row tren OLD page)'))
                    creating_since.pop(k, None)
                elif s == 'Creating':
                    if k not in creating_since:
                        creating_since[k] = retry_attempt
                    elif retry_attempt - creating_since[k] >= BULKSHEET_CREATING_TIMEOUT_RETRIES:
                        escalate_keys.append(
                            (k, f"Creating stuck >{BULKSHEET_CREATING_TIMEOUT_RETRIES} retries"))
                elif s == 'Download':
                    creating_since.pop(k, None)

            if escalate_keys:
                labels = [f"{p} {d}d [{reason}]" for ((p, d), reason) in escalate_keys]
                err = (f"Bulksheet bat buoc co van de: {', '.join(labels)}. "
                       f"Bat dau lai Amz-01-request.")
                logging.error(f"[{brand}] {err}")
                msg = (f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n"
                       f"☠️ *Lỗi nghiêm trọng bulksheet*\n"
                       f"`{escape_markdown(err)}`\n"
                       f"⏳ _Sẽ chạy lại Amz\\-01 sau 3\\-5 giây \\(co anti\\-loop guard\\)\\._")
                send_telegram_message(msg)
                return 'CRITICAL_FAILURE'

            # Tai Search Term reports (recreate_count share giua cac retry)
            try:
                download_additional_reports(driver, wait, brand, download_dir,
                                             files_to_download, recreate_count)
            except Exception as e:
                logging.error(f"[{brand}] Loi khi tai Search Term reports: {e}", exc_info=True)

            # Sleep 2 phut roi kiem tra log + retry (cac file con pending se san sang sau)
            logging.info(
                f"[{brand}] Hoàn thành retry #{retry_attempt}/{MAX_RETRY_ATTEMPTS}. "
                f"Chờ 2 phút rồi kiểm tra lại...")
            time.sleep(120)

    except Exception as e:
        error_msg = f"Lỗi nghiêm trọng khi xử lý store {brand}: {e}"
        logging.error(f"[{brand}] {error_msg}", exc_info=True)
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"💥 _Lỗi nghiêm trọng khi xử lý_\n" \
              f"Lỗi: `{escape_markdown(e)}`"
        send_telegram_message(msg)
        return 'GENERAL_ERROR'
    finally:
        if driver is not None:
            driver.quit()
        stop_profile(api_url, profile_id, brand)
        time.sleep(2)


if __name__ == "__main__":
    start_msg = f"🚀 *{escape_markdown(SCRIPT_NAME)}* \\- _Bắt đầu chạy script_"
    send_telegram_message(start_msg)
    logging.info(f"=============================================")
    logging.info(f"BẮT ĐẦU CHẠY SCRIPT: {SCRIPT_NAME}")
    logging.info(f"=============================================")

    api_url = read_local_api_file(LOCAL_API_PATH) or API_URL_DEFAULT
    while not check_api_status(api_url):
        logging.error("[SYSTEM] API AdsPower không hoạt động. Thử mở AdsPower...")
        send_telegram_message(
            f"⚠️ *{escape_markdown(SCRIPT_NAME)}* \\- _API AdsPower không hoạt động. Đang thử khởi động\\.\\.\\._")
        subprocess.Popen(ADDSPOWER_PATH)
        time.sleep(10)

    profile_data = get_sheet_data(GOOGLE_API_KEYFILE)
    if not profile_data:
        logging.critical("[SYSTEM] Không thể lấy dữ liệu từ Google Sheet. Dừng script.")
        msg = f"☠️ *{escape_markdown(SCRIPT_NAME)}* \\- _Không thể lấy dữ liệu từ Google Sheet. Dừng script._"
        send_telegram_message(msg)
        sys.exit()

    args_list = [(api_url, profile_id, brand) for profile_id, brand in profile_data.items()]

    overall_start_time = time.time()
    results = []
    with Pool(processes=6) as pool:
        results = pool.map(process_profile, args_list)

    # Bao cao cac store thieu mapping (khong escalate vi se gay vong lap voi Amz-01)
    if 'MAPPING_MISSING' in results:
        missing_count = results.count('MAPPING_MISSING')
        logging.warning(
            f"[SYSTEM] Co {missing_count} store thieu mapping bulksheet. "
            f"Chay Amz-01-request.py thu cong cho cac store nay.")
        send_telegram_message(
            f"⚠️ *{escape_markdown(SCRIPT_NAME)}* \\- "
            f"_{missing_count} store thiếu mapping bulksheet_\n"
            f"_Chạy {escape_markdown('Amz-01-request.py')} thủ công để tạo lại mapping\\._"
        )

    # Bao cao cac store timeout (khong escalate)
    if 'TIMEOUT' in results:
        timeout_count = results.count('TIMEOUT')
        logging.warning(
            f"[SYSTEM] Co {timeout_count} store timeout sau {MAX_RETRY_ATTEMPTS} retries.")
        send_telegram_message(
            f"⏱️ *{escape_markdown(SCRIPT_NAME)}* \\- "
            f"_{timeout_count} store hết max retries \\({MAX_RETRY_ATTEMPTS} lần\\), "
            f"chưa tải đủ file_"
        )

    if 'CRITICAL_FAILURE' in results:
        # Anti-loop guard: neu Amz-02 nay duoc trigger boi Amz-01 (qua chuoi re-entry)
        # thi KHONG goi Amz-01 nua de tranh vong lap vo tan
        # Amz-02 (CF) -> Amz-01 -> os.system(Amz-02) -> Amz-02 (CF) -> ...
        reentry_depth = int(os.environ.get('AMZ_REENTRY_DEPTH', '0'))
        max_depth = 1

        if reentry_depth >= max_depth:
            logging.critical(
                f"CRITICAL_FAILURE tiep dien sau {reentry_depth} lan re-entry. "
                f"DUNG chuoi chay de tranh vong lap vo tan.")
            send_telegram_message(
                f"☠️ *{escape_markdown(SCRIPT_NAME)}* \\- "
                f"_CRITICAL\\_FAILURE lặp lại sau {reentry_depth} lần re\\-entry\\. "
                f"Dừng chuỗi chạy để tránh loop vô tận\\. Kiểm tra log\\._"
            )
            sys.exit(1)

        logging.critical("Phát hiện lỗi nghiêm trọng ở một hoặc nhiều store. Bắt đầu lại Amz-01-request.")
        restart_msg = (
            f"☠️ *{escape_markdown(SCRIPT_NAME)}* \\- "
            f"_Phát hiện lỗi nghiêm trọng, chạy lại {escape_markdown('Amz-01-request.py')} "
            f"\\(re\\-entry depth {reentry_depth+1}/{max_depth}\\)_"
        )
        send_telegram_message(restart_msg)

        time.sleep(random.uniform(3, 5))

        amz_01_script_path = "E:\\PythonProject1\\Amz-01-request.py"
        logging.info(f"Đang chạy lại script: {amz_01_script_path} (depth -> {reentry_depth+1})")
        child_env = os.environ.copy()
        child_env['AMZ_REENTRY_DEPTH'] = str(reentry_depth + 1)
        try:
            subprocess.run([sys.executable, amz_01_script_path], check=True, env=child_env)
        except FileNotFoundError:
            logging.error(f"Không tìm thấy file script: {amz_01_script_path}")
        except subprocess.CalledProcessError as e:
            logging.error(f"Script Amz-01-request.py chạy bị lỗi: {e}")

        logging.info("Script Amz-02-download sẽ dừng lại.")
        sys.exit()

    overall_end_time = time.time()
    overall_total_time = overall_end_time - overall_start_time
    minutes, seconds = divmod(overall_total_time, 60)

    logging.info(f"TỔNG THỜI GIAN CHO TẤT CẢ STORES: {int(minutes)} phút {int(seconds)} giây")
    end_msg = f"✅ *{escape_markdown(SCRIPT_NAME)}* \\- _Hoàn thành tải file cho tất cả stores_\n" \
              f"Tổng thời gian: `{int(minutes)} phút {int(seconds)} giây`"
    send_telegram_message(end_msg)

    scripts = [
        "E:\\PythonProject1\\Amz-03-searchterm.py",
        "E:\\PythonProject1\\Amz-04-bulkfile.py",
        "E:\\PythonProject1\\Amz-05-campaign.py"
    ]

    processes = []
    for script in scripts:
        script_name_only = os.path.basename(script)
        script_name_no_ext, _ = os.path.splitext(script_name_only)
        logging.info(f"Bắt đầu chạy script {script_name_no_ext}")
        msg = f"🚀 _Bắt đầu chạy script tiếp theo: {escape_markdown(script_name_no_ext)}_"
        send_telegram_message(msg)
        process = subprocess.Popen([sys.executable, script])
        processes.append(process)

    # Đợi tất cả các script 03, 04, 05 hoàn thành
    for process in processes:
        process.wait()

    logging.info("Các script Amz-03, Amz-04, Amz-05 đã chạy xong.")
    msg_part1_done = f"✅ _Các script 03, 04, 05 đã hoàn thành\\._"
    send_telegram_message(msg_part1_done)

    # Đợi 2 phút
    logging.info("Đang đợi 2 phút trước khi chạy script Amz-06-move...")
    wait_msg = f"⏳ _Đợi 2 phút trước khi di chuyển file\\._"
    send_telegram_message(wait_msg)
    time.sleep(120)

    # Chạy script Amz-06-move.py
    amz_06_script_path = "E:\\PythonProject1\\Amz-06-move.py"
    logging.info(f"Bắt đầu chạy script {os.path.basename(amz_06_script_path)}...")
    run_06_msg = f"🚀 _Bắt đầu chạy script {escape_markdown('Amz-06-move.py')}\\_"
    send_telegram_message(run_06_msg)

    try:
        # Sử dụng subprocess.run để đợi script 06 chạy xong và bắt lỗi nếu có
        result = subprocess.run(
            [sys.executable, amz_06_script_path],
            check=True,
            capture_output=True,
            text=True,
            encoding='utf-8'
        )
        logging.info(f"Script {os.path.basename(amz_06_script_path)} đã hoàn thành thành công.")
        if result.stdout:
            logging.info("Output của script 06:\n" + result.stdout)
    except FileNotFoundError:
        logging.error(f"Lỗi: Không tìm thấy file script: {amz_06_script_path}")
        error_06_msg = f"☠️ _Không tìm thấy file {escape_markdown('Amz-06-move.py')}\\_"
        send_telegram_message(error_06_msg)
    except subprocess.CalledProcessError as e:
        logging.error(f"Lỗi: Script {os.path.basename(amz_06_script_path)} chạy bị lỗi.")
        # Ghi lại cả stdout và stderr để debug dễ hơn
        if e.stdout:
            logging.error("Output:\n" + e.stdout)
        if e.stderr:
            logging.error("Error Output:\n" + e.stderr)
        error_06_msg = f"☠️ _Script {escape_markdown('Amz-06-move.py')} chạy bị lỗi\\._\n`{escape_markdown(e.stderr)}`"
        send_telegram_message(error_06_msg)

    # Thông báo kết thúc toàn bộ quy trình
    logging.info("Tất cả các script đã hoàn thành.")
    final_msg = f"🎉 *Toàn bộ quy trình đã hoàn tất thành công\\!* 🎉"
    send_telegram_message(final_msg)
    # --- BẮT ĐẦU CODE GỬI THÔNG BÁO HOÀN TẤT NAS ---
    try:
        logging.info("Đang gửi thông báo HOÀN TẤT (NAS) đến group FINISH...")

        # Thông tin bot và group mới
        FINISH_BOT_TOKEN = "8126001939:AAEWHvMKQH8ap_vFyqnsBxFSuDSFIXzr1Hc"
        FINISH_GROUP_CHAT_ID = -1002644654888
        FINISH_MESSAGE = "🎉 *Đã bóc xong bulkfile và chuyển thành công vào NAS\\!* 🎉"
        # Sử dụng lại proxy đã có

        # Mã hóa tin nhắn (vì 'requests' và 'quote' đã được import ở đầu file)
        encoded_msg = quote(FINISH_MESSAGE)

        # Tạo URL và gửi
        url = f"{TELEGRAM_PROXY_URL}/bot{FINISH_BOT_TOKEN}/sendMessage?chat_id={FINISH_GROUP_CHAT_ID}&text={encoded_msg}&parse_mode=MarkdownV2"

        requests.get(url, timeout=10)  # Gửi tin nhắn

        logging.info("Đã gửi thông báo HOÀN TẤT (NAS) thành công.")

    except Exception as e:
        # Quan trọng: Bắt lỗi để đảm bảo script không bị dừng nếu thông báo này thất bại
        logging.error(f"Lỗi khi gửi thông báo HOÀN TẤT (NAS): {e}")
    # --- KẾT THÚC CODE GỬI THÔNG BÁO HOÀN TẤT NAS ---