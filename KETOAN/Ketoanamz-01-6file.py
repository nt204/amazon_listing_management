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
from selenium.webdriver.common.keys import Keys
from selenium.common.exceptions import TimeoutException, NoSuchElementException, StaleElementReferenceException
import time
import random
from datetime import datetime, timedelta
import pytz
from urllib.parse import quote
import subprocess
import sys
import gspread
from oauth2client.service_account import ServiceAccountCredentials
import logging
from multiprocessing import Pool
import locale
import shutil
import re

# --- CẤU HÌNH TỔNG HỢP ---

# >>> CÔNG TẮC TÍNH NĂNG CHUNG <<<
# Chạy song song nhiều profile.
# Đã chuyển thành True theo yêu cầu.
USE_MULTIPROCESSING = True

# >>> CÔNG TẮC TÍNH NĂNG TỪNG FILE <<<
# Đặt thành True để bật, False để tắt tác vụ tương ứng
ENABLE_FILE_01 = True # File Portfolios Report
ENABLE_FILE_02 = True  # File All Orders Report
ENABLE_FILE_03 = True  # File Return Report
ENABLE_FILE_04 = True  # File Service Fees Report
ENABLE_FILE_05 = False  # File Campaigns Report
ENABLE_FILE_06 = True  # File FBA Inventory Report
ENABLE_FILE_07 = True  # File Shipment Report

# >>> GIỚI HẠN RETRY <<<
# [FIX] Trước đây vòng lặp retry tác vụ là `while True` -> khi profile bị lỗi đăng nhập
# vĩnh viễn, script lặp vô hạn (11/08/2026: Warmstorey lặp 49+ lần trong ~3 tiếng và
# không bao giờ chạy tới file 02-07). Nay giới hạn lại và bỏ qua tác vụ để chạy tiếp.
MAX_TASK_RETRIES = 5
MAX_HISTORICAL_RETRIES = 3
MAX_MISSING_FILE_LOOPS = 3  # Giai đoạn 2: số vòng kiểm tra & tải lại file thiếu

# [FIX] Cờ đánh dấu profile bị lỗi ĐĂNG NHẬP không thể tự khắc phục (sai pass, captcha,
# account bị challenge...). Khi login đã hỏng thì CẢ 6 tác vụ đều fail cùng một lý do,
# nên thử lại 5 lượt x 6 tác vụ là vô nghĩa (12/08/2026: Warmstorey lẽ ra cày 5-6 tiếng).
# Dùng biến toàn cục vì mỗi profile chạy trong 1 process riêng của Pool.
# Vẫn phải reset ở đầu process_tasks_for_profile vì worker của Pool có thể bị tái sử dụng.
LOGIN_BROKEN = {"flag": False, "reason": ""}

# --- CẤU HÌNH CHUNG ---
# Thiết lập logging
SCRIPT_NAME = "Ketoanamz-01-6file"
VN_TZ = pytz.timezone('Asia/Ho_Chi_Minh')
current_date_str = datetime.now(VN_TZ).strftime("%Y%m%d")
log_file = f"E:\\PythonProject1\\{SCRIPT_NAME}-{current_date_str}.txt"
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
TOPIC_ID = 17016
TELEGRAM_PROXY_URL = "https://nce-telegram-proxy.ntthanhnce.workers.dev"
SCRIPT_NAME = "Ketoanamz-01-6file"

# Cấu hình đầu vào
LOCAL_API_PATH = r"C:\Users\Administrator\AppData\Roaming\adspower_global\cwd_global\source\local_api"
GOOGLE_API_KEYFILE = r"E:\PythonProject1\NCE_googleapi.json"
SPREADSHEET_URL = "https://docs.google.com/spreadsheets/d/1CBZuKZOjG9zxNrfdh3qgeofkwW1758ruZl-yT77_IeI/edit?gid=0#gid=0"
WORKSHEET_NAME = "02-ketoan"
API_URL_DEFAULT = "http://127.0.0.1:50325"
ADDSPOWER_PATH = r"C:\Program Files\AdsPower Global\AdsPower Global.exe"

# Cấu hình file/thư mục
# DOWNLOAD_DIR cũ không còn dùng làm nơi tìm file chính nữa,
# nhưng vẫn giữ để tránh lỗi reference nếu có chỗ nào sót,
# logic chính sẽ dùng DESTINATION_ROOT_DIR\{Brand}
DOWNLOAD_DIR = r"C:\Users\Administrator\Downloads"
DESTINATION_ROOT_DIR = r"E:\Kế toán"

# Global gspread client
gc = None


# --- CÁC HÀM HỖ TRỢ ---

def escape_markdown(text):
    """Hàm hỗ trợ escape các ký tự đặc biệt của MarkdownV2."""
    escape_chars = r'_*[]()~`>#+-=|{}.!'
    return ''.join(f'\\{char}' if char in escape_chars else char for char in str(text))


def clean_for_log(markdown_text): 
    """Làm sạch tin nhắn Markdown để ghi log cho dễ đọc."""
    emojis_to_remove = ['🚀', '✅', '❌', '📄', '💥', '🎉', '⚠️', '🔐', '🔄', '🔍']
    clean_text = markdown_text
    for emoji in emojis_to_remove:
        clean_text = clean_text.replace(emoji, '')
    chars_to_remove = ['*', '`', '~']
    for char in chars_to_remove:
        clean_text = clean_text.replace(char, '')

    placeholder = "___PATH_SEPARATOR___"
    clean_text = clean_text.replace('\\\\', placeholder)
    clean_text = clean_text.replace('\\', '')
    clean_text = clean_text.replace(placeholder, '\\')

    return clean_text.strip()


def send_telegram_message(message, parse_mode="MarkdownV2", script_name_override=None):
    """Gửi tin nhắn Telegram (Fix lỗi lặp vô tận khi gặp lỗi 400)."""
    display_script_name = script_name_override if script_name_override else SCRIPT_NAME
    full_message = f"*{escape_markdown(display_script_name)}* \n{message}"

    url = f"{TELEGRAM_PROXY_URL}/bot{BOT_TOKEN}/sendMessage?chat_id={GROUP_CHAT_ID}&text={quote(full_message)}&message_thread_id={TOPIC_ID}&parse_mode={parse_mode}"
    retry_count = 0
    max_retries = 3

    while retry_count < max_retries:
        try:
            response = requests.get(url, timeout=15)
            clean_message = clean_for_log(message).replace('\n', ' | ').strip()

            if response.status_code == 200:
                logging.info(f"[{display_script_name}][TELEGRAM] Đã gửi: {clean_message}")
                break  # Gửi thành công -> Thoát
            elif 400 <= response.status_code < 500:
                # Lỗi 400 (Bad Request) do sai format Markdown -> KHÔNG retry, log lỗi và thoát luôn
                logging.error(
                    f"[{display_script_name}][TELEGRAM] Lỗi Format (Không gửi lại): {response.status_code} {response.text}")
                break
            else:
                # Lỗi 5xx (Server) hoặc khác -> Thử lại
                logging.warning(
                    f"[{display_script_name}][TELEGRAM] Gửi thất bại: {response.status_code}. Đang thử lại...")
                retry_count += 1
                time.sleep(5)

        except Exception as e:
            retry_count += 1
            logging.error(f"[{display_script_name}][TELEGRAM] Lỗi kết nối (thử {retry_count}): {str(e)}")
            time.sleep(5)


def get_password_from_gsheet(profile_id, brand):
    """Lấy mật khẩu từ Google Sheet 'accInfo'."""
    global gc
    if not gc:
        logging.error(f"[{brand}] gspread client chưa được khởi tạo.")
        return None
    try:
        acc_info_sheet = gc.open_by_url(SPREADSHEET_URL).worksheet("accInfo")
        all_accounts = acc_info_sheet.get_all_records()

        for account in all_accounts:
            if str(account.get('idAdsPowers')).strip() == str(profile_id).strip():
                password = account.get('pass amazon')
                if password:
                    logging.info(f"[{brand}] Đã tìm thấy mật khẩu cho profile ID: {profile_id} trong Google Sheet.")
                    return str(password)
                else:
                    logging.error(
                        f"[{brand}] Tìm thấy profile ID {profile_id} nhưng không có mật khẩu trong cột 'pass amazon'.")
                    break

        logging.error(f"[{brand}] Không tìm thấy profile ID: {profile_id} trong sheet 'accInfo'.")
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"❌ _Không tìm thấy mật khẩu trong Google Sheet_\n" \
              f"Profile ID: `{profile_id}`"
        send_telegram_message(msg)
        return None
    except gspread.exceptions.WorksheetNotFound:
        logging.error(f"[{brand}] Không tìm thấy worksheet 'accInfo' trong Google Sheet.")
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"❌ _Không tìm thấy sheet 'accInfo'_\n"
        send_telegram_message(msg)
        return None
    except Exception as e:
        logging.error(f"[{brand}] Lỗi khi đọc Google Sheet 'accInfo': {e}")
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"❌ _Lỗi khi đọc Google Sheet 'accInfo'_\n" \
              f"Lỗi: `{escape_markdown(e)}`"
        send_telegram_message(msg)
        return None


def get_email_from_gsheet(profile_id, brand):
    """Lấy email đăng nhập Amazon từ Google Sheet 'accInfo' (cột 'email')."""
    global gc
    if not gc:
        logging.error(f"[{brand}] gspread client chưa được khởi tạo.")
        return None
    try:
        acc_info_sheet = gc.open_by_url(SPREADSHEET_URL).worksheet("accInfo")
        all_accounts = acc_info_sheet.get_all_records()

        for account in all_accounts:
            if str(account.get('idAdsPowers')).strip() == str(profile_id).strip():
                email = account.get('email')
                if email:
                    logging.info(f"[{brand}] Đã tìm thấy email cho profile ID: {profile_id} trong Google Sheet.")
                    return str(email).strip()
                else:
                    logging.error(
                        f"[{brand}] Tìm thấy profile ID {profile_id} nhưng không có email trong cột 'email'.")
                    break

        logging.error(f"[{brand}] Không tìm thấy profile ID: {profile_id} để lấy email trong sheet 'accInfo'.")
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"❌ _Không tìm thấy email trong Google Sheet_\n" \
              f"Profile ID: `{profile_id}`"
        send_telegram_message(msg)
        return None
    except Exception as e:
        logging.error(f"[{brand}] Lỗi khi đọc Google Sheet 'accInfo' để lấy email: {e}")
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"❌ _Lỗi khi đọc Google Sheet 'accInfo' \\(email\\)_\n" \
              f"Lỗi: `{escape_markdown(str(e).splitlines()[0])}`"
        send_telegram_message(msg)
        return None


def get_2fa_secret(profile_id, brand):
    """Lấy mã 2FA secret từ Google Sheet 'accInfo'."""
    global gc
    if not gc:
        logging.error(f"[{brand}] gspread client chưa được khởi tạo.")
        return None
    try:
        acc_info_sheet = gc.open_by_url(SPREADSHEET_URL).worksheet("accInfo")
        all_accounts = acc_info_sheet.get_all_records()

        for account in all_accounts:
            if str(account.get('idAdsPowers')).strip() == str(profile_id).strip():
                secret_2fa = account.get('2FA')
                if secret_2fa:
                    logging.info(f"[{brand}] Đã tìm thấy mã 2FA cho profile ID: {profile_id}.")
                    return str(secret_2fa)
                else:
                    logging.error(f"[{brand}] Tìm thấy profile ID {profile_id} nhưng không có mã trong cột '2FA'.")
                    break

        logging.error(f"[{brand}] Không tìm thấy profile ID: {profile_id} để lấy mã 2FA trong sheet 'accInfo'.")
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"❌ _Không tìm thấy mã 2FA trong Google Sheet_\n" \
              f"Profile ID: `{profile_id}`"
        send_telegram_message(msg)
        return None
    except gspread.exceptions.WorksheetNotFound:
        logging.error(f"[{brand}] Không tìm thấy worksheet 'accInfo' trong Google Sheet.")
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"❌ _Không tìm thấy sheet 'accInfo'_"
        send_telegram_message(msg)
        return None
    except Exception as e:
        logging.error(f"[{brand}] Lỗi khi đọc Google Sheet 'accInfo' để lấy mã 2FA: {e}")
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"❌ _Lỗi khi đọc Google Sheet 'accInfo'_\n" \
              f"Lỗi: `{escape_markdown(e)}`"
        send_telegram_message(msg)
        return None


def read_local_api_file(file_path):
    try:
        with open(file_path, 'r') as file:
            return file.read().strip()
    except FileNotFoundError:
        logging.info(f"Không tìm thấy file {file_path}. Sử dụng URL mặc định.")
        return None
    except Exception as e:
        logging.error(f"Lỗi khi đọc file {file_path}: {e}")
        return None


def check_api_status(api_url):
    try:
        response = requests.get(f"{api_url}/status", timeout=5)
        response.raise_for_status()
        data = response.json()
        if data.get("code") == 0:
            logging.info("API AdsPower đang hoạt động.")
            return True
        logging.warning(f"API không sẵn sàng: {data.get('msg', 'Không có thông báo lỗi')}")
        return False
    except requests.exceptions.RequestException as e:
        logging.error(f"Lỗi kết nối API AdsPower: {e}")
        return False


def open_profile(api_url, profile_id, brand, api_key=None):
    """
    Mở profile AdsPower với cơ chế thử lại liên tục (Lì lợm) từ Amz-01.
    Sẽ không bao giờ trả về None/thất bại, mà cứ thử lại cho đến khi được.
    """
    open_url = f"{api_url}/api/v2/browser-profile/start"
    payload = {"profile_id": profile_id}
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}

    while True:
        try:
            response = requests.post(open_url, json=payload, headers=headers, timeout=10)
            response.raise_for_status()
            data = response.json()

            if data.get("code") == 0:
                debug_port = data['data']['debug_port']
                driver_path = data['data']['webdriver']
                logging.info(f"[{brand}] Mở profile thành công. Port: {debug_port}")
                time.sleep(5)  # Chờ một chút cho chắc chắn
                return debug_port, driver_path
            else:
                error_msg = data.get('msg', 'Không có thông báo lỗi')
                logging.error(f"[{brand}] Lỗi khi mở profile: {error_msg}")
                msg = f"\\- *{escape_markdown(brand)}*\n" \
                      f"❌ _Lỗi khi mở profile_\n" \
                      f"Lỗi: `{escape_markdown(error_msg)}`"
                send_telegram_message(msg)

                # Thử lại: Stop trước rồi chờ tí
                stop_profile(api_url, profile_id, brand)
                time.sleep(random.uniform(2, 4))

        except requests.exceptions.RequestException as e:
            logging.error(f"[{brand}] Lỗi gửi yêu cầu mở profile: {e}")
            msg = f"\\- *{escape_markdown(brand)}*\n" \
                  f"❌ _Lỗi gửi yêu cầu mở profile_\n" \
                  f"Lỗi: `{escape_markdown(e)}`"
            send_telegram_message(msg)
            stop_profile(api_url, profile_id, brand)
            time.sleep(random.uniform(2, 4))

        except json.JSONDecodeError:
            logging.error(f"[{brand}] Phản hồi không phải JSON hợp lệ.")
            msg = f"\\- *{escape_markdown(brand)}*\n" \
                  f"❌ _Phản hồi không phải JSON hợp lệ khi mở profile_"
            send_telegram_message(msg)
            stop_profile(api_url, profile_id, brand)
            time.sleep(random.uniform(2, 4))

        except Exception as e:
            logging.error(f"[{brand}] Lỗi không xác định khi mở profile: {e}")
            stop_profile(api_url, profile_id, brand)
            time.sleep(5)


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
    scope = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]
    try:
        if not gc:
            creds = ServiceAccountCredentials.from_json_keyfile_name(keyfile, scope)
            gc = gspread.authorize(creds)
        sheet = gc.open_by_url(SPREADSHEET_URL).worksheet(WORKSHEET_NAME)
        rows = sheet.get_all_records()
        # Lấy cả ID và Brand để dùng cho việc retry
        profile_configs = [
            {"id": row["id"], "brand": row["BRAND"]}
            for row in rows if row.get("id") and row.get("BRAND")
        ]
        logging.info(f"Đã đọc {len(profile_configs)} profiles từ Google Sheet '{WORKSHEET_NAME}'.")
        return profile_configs
    except Exception as e:
        logging.error(f"Lỗi khi truy cập Google Sheet: {e}")
        return None


def setup_webdriver(debug_port, driver_path):
    service = Service(executable_path=driver_path)
    chrome_options = Options()
    chrome_options.add_argument("--disable-blink-features=AutomationControlled")
    chrome_options.add_experimental_option("debuggerAddress", f"127.0.0.1:{debug_port}")
    driver = webdriver.Chrome(service=service, options=chrome_options)
    driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument",
                           {"source": "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"})
    return driver


def reinitialize_driver(driver, api_url, profile_id, brand, download_path):
    """Dừng driver cũ, khởi động lại profile AdsPower và tạo driver mới."""
    logging.warning(f"[{brand}] Phiên WebDriver không hợp lệ. Đang khởi động lại trình duyệt...")
    try:
        driver.quit()
    except Exception:
        pass
    stop_profile(api_url, profile_id, brand)
    time.sleep(5)
    new_debug_port, new_driver_path = open_profile(api_url, profile_id, brand)
    new_driver = setup_webdriver(new_debug_port, new_driver_path)
    new_wait = WebDriverWait(new_driver, 45)
    new_driver.execute_cdp_cmd("Page.setDownloadBehavior", {"behavior": "allow", "downloadPath": download_path})
    logging.info(f"[{brand}] Đã khởi động lại trình duyệt thành công.")
    return new_driver, new_wait


def get_shadow_root(driver, element):
    return driver.execute_script('return arguments[0].shadowRoot', element)


# --- CÁC HÀM ĐĂNG NHẬP VÀ OTP (LOGIC TỪ NEW-CLICK) ---

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
        msg = f"\\- *{escape_markdown(brand)}*\n" \
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
        msg = f"\\- *{escape_markdown(brand)}*\n" \
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


def submit_email_if_needed(driver, profile_id, brand, timeout=8):
    """
    [FIX] Xử lý trường hợp profile bị Amazon đăng xuất HOÀN TOÀN: trang login hiện
    ô EMAIL trước, chưa có ô mật khẩu. Trước đây script chỉ chờ 'ap_password' nên
    timeout 45s rồi fail vô ích.

    Trả về True nếu đã điền email + bấm Continue, False nếu không thấy trang email.
    """
    email_field = None
    for locator in ((By.ID, "ap_email"), (By.ID, "ap_email_login")):
        try:
            email_field = WebDriverWait(driver, timeout).until(
                EC.visibility_of_element_located(locator))
            break
        except TimeoutException:
            timeout = 2  # chỉ chờ lâu ở locator đầu tiên
            continue

    if email_field is None:
        return False

    logging.warning(f"[{brand}] Phát hiện trang nhập EMAIL (session đã bị đăng xuất hoàn toàn).")
    msg = f"\\- *{escape_markdown(brand)}*\n" \
          f"📧 _Session bị đăng xuất, đang điền email để đăng nhập lại\\.\\.\\._"
    send_telegram_message(msg)

    email = get_email_from_gsheet(profile_id, brand)
    if not email:
        raise Exception("Không lấy được email từ Google Sheet để đăng nhập lại.")

    email_field.clear()
    email_field.send_keys(email)
    time.sleep(random.uniform(1, 2))

    # Nút Continue: Amazon dùng nhiều id/selector khác nhau tùy layout
    clicked = False
    for locator in ((By.ID, "continue"), (By.ID, "continue-announce"),
                    (By.CSS_SELECTOR, "input#continue[type='submit']"),
                    (By.CSS_SELECTOR, "span#continue input[type='submit']")):
        try:
            WebDriverWait(driver, 5).until(EC.element_to_be_clickable(locator)).click()
            clicked = True
            break
        except Exception:
            continue

    if not clicked:
        # Một số layout cho submit thẳng bằng Enter
        email_field.send_keys(Keys.RETURN)
        logging.info(f"[{brand}] Không thấy nút Continue, đã submit email bằng Enter.")
    else:
        logging.info(f"[{brand}] Đã điền email và bấm Continue.")

    time.sleep(random.uniform(2, 4))
    return True


def login_if_needed_seller_central(driver, wait, profile_id, brand):
    try:
        # Check for password field first
        WebDriverWait(driver, 3).until(EC.presence_of_element_located((By.ID, "ap_password")))
        logging.info(f"[{brand}] Phát hiện trang yêu cầu đăng nhập.")
    except TimeoutException:
        # If no password field, check for OTP screen directly
        logging.info(f"[{brand}] Không thấy màn hình đăng nhập, kiểm tra màn hình OTP...")
        try:
            WebDriverWait(driver, 3).until(EC.visibility_of_element_located((By.ID, "auth-mfa-otpcode")))
            logging.info(f"[{brand}] Phát hiện trực tiếp màn hình OTP, tiến hành xử lý.")
            if not handle_two_step_verification(driver, profile_id, brand):
                raise Exception("Xử lý Two-Step Verification thất bại.")
            return verify_login_success(driver, brand)
        except TimeoutException:
            # [FIX] Trước khi kết luận "đã đăng nhập", phải kiểm tra trang nhập EMAIL.
            # Nếu bị đăng xuất hẳn thì ở đây chỉ có ô email -> trước đây báo sai là đã login.
            if driver.find_elements(By.ID, "ap_email") or driver.find_elements(By.ID, "ap_email_login"):
                logging.warning(f"[{brand}] Thấy trang nhập email -> session đã bị đăng xuất, cần đăng nhập lại.")
            else:
                # If no OTP screen either, assume we are already logged in
                logging.info(f"[{brand}] Không thấy màn hình OTP, đã đăng nhập.")
                return True

    # If password field was found, proceed with the normal login flow
    login_attempts = 0
    while login_attempts < 3:
        try:
            msg = f"\\- *{escape_markdown(brand)}*\n" \
                  f"🔑 _Yêu cầu đăng nhập Seller Central, đang tiến hành \\(Lần {login_attempts + 1}\\)\\.\\.\\._"
            send_telegram_message(msg)

            password = get_password_from_gsheet(profile_id, brand)
            if not password:
                # [FIX] Thiếu mật khẩu trong Sheet -> retry cũng không bao giờ khắc phục được
                LOGIN_BROKEN["flag"] = True
                LOGIN_BROKEN["reason"] = "Không lấy được mật khẩu từ Google Sheet"
                return False

            # [FIX] Nếu chưa có ô mật khẩu, có thể đang ở trang nhập EMAIL (bị đăng xuất hẳn)
            if not driver.find_elements(By.ID, "ap_password"):
                submit_email_if_needed(driver, profile_id, brand)

            try:
                password_field = wait.until(EC.visibility_of_element_located((By.ID, "ap_password")))
            except TimeoutException:
                logging.error(f"[{brand}] Không tìm thấy ô mật khẩu. URL hiện tại: {driver.current_url} "
                              f"| Tiêu đề trang: {driver.title}")
                raise Exception("Không tìm thấy ô mật khẩu (trang đăng nhập lạ: captcha/challenge/email?).")

            password_field.clear()
            password_field.send_keys(password)
            time.sleep(random.uniform(1, 2))

            wait.until(EC.element_to_be_clickable((By.ID, "signInSubmit"))).click()
            logging.info(f"[{brand}] Đã điền mật khẩu và nhấn Sign In.")

            if not handle_two_step_verification(driver, profile_id, brand):
                raise Exception("Xử lý Two-Step Verification thất bại.")

            if not verify_login_success(driver, brand):
                raise Exception("Xác minh đăng nhập thất bại.")

            logging.info(f"[{brand}] Đăng nhập Seller Central thành công (đã xác minh).")
            return True

        except Exception as e:
            login_attempts += 1
            logging.error(f"[{brand}] Lỗi đăng nhập Seller Central (lần {login_attempts}): {e}. Thử lại sau 5s...")
            time.sleep(5)
            driver.get(driver.current_url)

    logging.error(f"[{brand}] Đăng nhập Seller Central thất bại sau {login_attempts} lần thử.")
    LOGIN_BROKEN["flag"] = True
    LOGIN_BROKEN["reason"] = "Đăng nhập Seller Central thất bại"
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
        try:
            msg = f"\\- *{escape_markdown(brand)}*\n" \
                  f"🔑 _Yêu cầu đăng nhập Advertising, đang tiến hành \\(Lần {login_attempts + 1}\\)\\.\\.\\._"
            send_telegram_message(msg)

            password = get_password_from_gsheet(profile_id, brand)
            if not password:
                # [FIX] Thiếu mật khẩu trong Sheet -> retry cũng không bao giờ khắc phục được
                LOGIN_BROKEN["flag"] = True
                LOGIN_BROKEN["reason"] = "Không lấy được mật khẩu từ Google Sheet"
                return False

            # [FIX] Nếu chưa có ô mật khẩu, có thể đang ở trang nhập EMAIL (bị đăng xuất hẳn)
            if not driver.find_elements(By.ID, "ap_password"):
                submit_email_if_needed(driver, profile_id, brand)

            try:
                password_field = wait.until(EC.presence_of_element_located((By.ID, "ap_password")))
            except TimeoutException:
                # Log chẩn đoán thay vì chỉ ném TimeoutException rỗng như trước
                logging.error(f"[{brand}] Không tìm thấy ô mật khẩu. URL hiện tại: {driver.current_url} "
                              f"| Tiêu đề trang: {driver.title}")
                raise Exception("Không tìm thấy ô mật khẩu (trang đăng nhập lạ: captcha/challenge/email?).")

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
            login_attempts += 1
            logging.error(f"[{brand}] Lỗi đăng nhập Advertising (lần {login_attempts}): {e}. Thử lại sau 5s...")
            if "NoSuchElementException" in str(e) or "StaleElementReferenceException" in str(e):
                logging.info(f"[{brand}] Trang có thể đã tải lại, thử truy cập lại URL...")
                current_url = driver.current_url
                driver.get(current_url)
            time.sleep(5)

    logging.error(f"[{brand}] Đăng nhập Advertising thất bại sau {login_attempts} lần thử.")
    LOGIN_BROKEN["flag"] = True
    LOGIN_BROKEN["reason"] = "Đăng nhập Advertising thất bại"
    return False


# --- CÁC HÀM CHỨC NĂNG CHO TỪNG LOẠI FILE (LOGIC TỪ ORIGINAL) ---

# ==================== FILE 01: PORTFOLIOS REPORT ====================
def request_and_download_file01_portfolio_report(driver, wait, profile_id, brand, target_date):
    logging.info(f"[{brand}] Bắt đầu: Yêu cầu và Tải File 01 (Portfolios).")
    try:
        driver.get("https://advertising.amazon.com/cm/portfolios")
        time.sleep(random.uniform(2, 3))

        if not login_if_needed_advertising(driver, wait, profile_id, brand):
            raise Exception("Đăng nhập Advertising thất bại.")

        date_picker_button = wait.until(
            EC.element_to_be_clickable((By.CSS_SELECTOR, 'button[data-e2e-id="dateRangePickerButton"]')))
        date_picker_button.click()
        logging.info(f"[{brand}] [File 01] Đã mở bảng chọn ngày.")
        time.sleep(random.uniform(1, 2))

        day_number = target_date.day
        formatted_date_string = target_date.strftime(f"%A, %B {day_number}, %Y")
        date_element_xpath = f"//td[contains(@aria-label, '{formatted_date_string}') and not(@aria-disabled='true')]"
        date_element = WebDriverWait(driver, 10).until(EC.element_to_be_clickable((By.XPATH, date_element_xpath)))
        date_element.click()
        logging.info(f"[{brand}] [File 01] Đã chọn ngày: {target_date.strftime('%Y-%m-%d')}.")
        time.sleep(random.uniform(2, 3))

        save_button = wait.until(
            EC.element_to_be_clickable((By.XPATH, "//*[@id='AACChromePortal']//button[text()='Save']")))
        save_button.click()
        logging.info(f"[{brand}] [File 01] Đã click Save để áp dụng ngày.")
        time.sleep(random.uniform(2, 3))

        try:
            logging.info(f"[{brand}] [File 01] Bắt đầu chọn 300 kết quả/trang.")
            dropdown_button = wait.until(EC.element_to_be_clickable(
                (By.CSS_SELECTOR, 'button[data-e2e-id="dropdown"]')))
            dropdown_button.click()
            logging.info(f"[{brand}] [File 01] Đã click dropdown chọn số kết quả.")
            time.sleep(random.uniform(1, 2))

            option_300 = wait.until(EC.element_to_be_clickable(
                (By.CSS_SELECTOR, 'button[data-e2e-id="dropdownItem"][value="300"]')))
            option_300.click()
            logging.info(f"[{brand}] [File 01] Đã chọn 300 kết quả/trang.")
            time.sleep(random.uniform(5, 7))
        except TimeoutException:
            logging.warning(f"[{brand}] [File 01] Không tìm thấy hoặc không thể click nút chọn 300 kết quả. Bỏ qua.")

        try:
            reset_button = WebDriverWait(driver, 10).until(
                EC.element_to_be_clickable((By.CSS_SELECTOR, 'button[data-e2e-id="resetButton"]')))
            driver.execute_script("arguments[0].click();", reset_button)
            logging.info(f"[{brand}] [File 01] Đã click nút 'Reset'.")
            time.sleep(random.uniform(2, 3))
        except TimeoutException:
            logging.warning(f"[{brand}] [File 01] Không tìm thấy nút 'Reset', bỏ qua và đi tiếp.")
            msg = f"\\- *{escape_markdown(brand)}*\n" \
                  f"⚠️ _Không tìm thấy nút 'Reset' cho File 01, script vẫn tiếp tục\\._"
            send_telegram_message(msg, script_name_override="BO-amz-01-Portfolios")

        try:
            clear_button_selector = "//input[@id='UCM-CM-APP:ALL_PORTFOLIOS:searchInput']/following-sibling::button"
            clear_button = WebDriverWait(driver, 5).until(
                EC.element_to_be_clickable((By.XPATH, clear_button_selector))
            )
            driver.execute_script("arguments[0].click();", clear_button)
            logging.info(f"[{brand}] [File 01] Đã click nút 'Clear search terms' để xóa nội dung tìm kiếm.")
            time.sleep(random.uniform(1, 2))
        except TimeoutException:
            logging.info(f"[{brand}] [File 01] Không tìm thấy nút 'Clear search terms'. Có thể ô tìm kiếm đã trống.")

        export_button = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, 'button[data-e2e-id="export"]')))

        wait_time = random.uniform(10, 15)
        logging.info(f"[{brand}] [File 01] Đã tìm thấy nút Export. Chờ {wait_time:.2f} giây trước khi bấm tải...")
        time.sleep(wait_time)

        driver.execute_script("arguments[0].click();", export_button)
        logging.info(f"[{brand}] [File 01] Đã click nút Export.")
        return True
    except Exception as e:
        logging.error(f"[{brand}] Lỗi khi yêu cầu/tải File 01: {e}", exc_info=True)
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"💥 _Lỗi khi yêu cầu/tải File 01_\n" \
              f"Lỗi: `{escape_markdown(str(e).splitlines()[0])}`"
        send_telegram_message(msg, script_name_override="BO-amz-01-Portfolios")
        return False


def rename_and_move_file01_portfolio_report(brand, target_date, destination_path):
    logging.info(f"[{brand}] Bắt đầu: Đổi tên và Di chuyển File 01 (Portfolios).")
    # --- CẬP NHẬT ĐƯỜNG DẪN TẢI VỀ THEO BRAND ---
    download_dir = os.path.join(DESTINATION_ROOT_DIR, brand)

    try:
        time.sleep(random.uniform(7, 10))

        today_start_timestamp = datetime.now(VN_TZ).replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
        latest_file = None
        for _ in range(12):  # Chờ tối đa 60 giây
            files = [
                os.path.join(download_dir, f)
                for f in os.listdir(download_dir)
                if f.lower().startswith('portfolios_') and f.lower().endswith('.csv') and os.path.getmtime(
                    os.path.join(download_dir, f)) >= today_start_timestamp
            ]
            if files:
                latest_file = max(files, key=os.path.getctime)
                logging.info(f"[{brand}] [File 01] Đã tìm thấy file: {latest_file}")
                break
            logging.warning(f"[{brand}] [File 01] Chưa tìm thấy file Portfolios. Chờ 5 giây và thử lại...")
            time.sleep(5)

        if not latest_file:
            raise FileNotFoundError("Không tìm thấy file Portfolios đã tải về.")

        if os.path.exists(destination_path):
            os.remove(destination_path)

        # Đảm bảo thư mục đích tồn tại
        os.makedirs(os.path.dirname(destination_path), exist_ok=True)

        shutil.move(latest_file, destination_path)
        logging.info(f"[{brand}] [File 01] Đã di chuyển file thành công tới: {destination_path}")

        telegram_path = destination_path.replace('\\', '\\\\')
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"📄 _File 01 \\(Portfolios\\) đã được tải và chuyển thành công_\\.\n" \
              f"Đường dẫn: `{telegram_path}`"
        send_telegram_message(msg, script_name_override="BO-amz-01-Portfolios")
        return True

    except Exception as e:
        logging.error(f"[{brand}] Lỗi khi đổi tên/di chuyển File 01: {e}")
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"💥 _Lỗi khi đổi tên/di chuyển File 01_\n" \
              f"Lỗi: `{escape_markdown(str(e).splitlines()[0])}`"
        send_telegram_message(msg, script_name_override="BO-amz-01-Portfolios")
        return False


# ==================== FILE 02: ALL ORDERS REPORT ====================
def request_and_download_file02_all_orders_report(driver, wait, profile_id, brand, target_date):
    logging.info(f"[{brand}] Bắt đầu: Yêu cầu và Tải File 02 (All Orders).")
    task_name = "File 02"
    url = "https://sellercentral.amazon.com/reportcentral/FlatFileAllOrdersReport/1"
    try:
        driver.get(url)

        if not login_if_needed_seller_central(driver, wait, profile_id, brand):
            raise Exception("Đăng nhập Seller Central thất bại.")

        max_retries = 2
        for attempt in range(max_retries):
            try:
                header = wait.until(EC.presence_of_element_located((By.ID, "app-header-text-style")))
                if "Amazon Fulfillment Reports" in header.text:
                    logging.info(f"[{brand}] [{task_name}] Đã xác minh trang 'Amazon Fulfillment Reports' thành công.")
                    break
                else:
                    raise Exception("Header không chứa 'Amazon Fulfillment Reports'.")
            except Exception as e:
                logging.warning(
                    f"[{brand}] [{task_name}] Kiểm tra trang thất bại (Lần {attempt + 1}/{max_retries}). Lỗi: {e}. Thử tải lại URL...")
                driver.get(url)
                time.sleep(5)
                if attempt + 1 == max_retries:
                    raise Exception("Không vào được trang Amazon Fulfillment Reports sau nhiều lần thử.")

        # [FIX 06/10/2026] Amazon đổi id nút dropdown ngày trong Shadow DOM (katal-id-25 -> katal-id-24)
        # nên click giao diện hỏng. Gọi thẳng API reportcentral giống trang web (lấy từ HAR),
        # không phụ thuộc giao diện nữa.
        report_date = target_date.strftime("%Y/%m/%d")
        driver.set_script_timeout(60)

        submit_js = """
            const done = arguments[arguments.length - 1];
            const meta = document.querySelector('meta[name="anti-csrftoken-a2z"]');
            if (!meta) { done({error: 'Không tìm thấy anti-csrftoken-a2z trên trang'}); return; }
            const qs = 'reportFileFormat=TSV&reportStartDate=' + encodeURIComponent(arguments[0]) +
                       '&reportEndDate=' + encodeURIComponent(arguments[0]) +
                       '&xdaysBeforeUntilToday=-1&startDateTimeOffset=0&endDateTimeOffset=0' +
                       '&specialDateOptions=&reportFRPId=2400&language=&disableTimezone=true';
            fetch('/reportcentral/api/v1/submitDownloadReport?' + qs,
                  {method: 'POST', credentials: 'include', headers: {'anti-csrftoken-a2z': meta.content}})
                .then(r => r.text().then(t => done({status: r.status, body: t})))
                .catch(e => done({error: String(e)}));
        """
        result = driver.execute_async_script(submit_js, report_date)
        if result.get("error") or result.get("status") != 200:
            raise Exception(f"Gửi yêu cầu báo cáo thất bại: {result}")
        report_info = json.loads(result["body"])
        reference_id = report_info.get("reportReferenceId")
        if not reference_id:
            raise Exception(f"API không trả về reportReferenceId: {result['body'][:300]}")
        if not str(report_info.get("reportStartDateTime", "")).startswith(report_date):
            raise Exception(f"Ngày báo cáo không khớp: yêu cầu {report_date}, Amazon trả về "
                            f"{report_info.get('reportStartDateTime')}")
        logging.info(f"[{brand}] [{task_name}] Đã gửi yêu cầu báo cáo ngày {report_date}. Reference ID: {reference_id}")

        status_js = """
            const done = arguments[arguments.length - 1];
            const meta = document.querySelector('meta[name="anti-csrftoken-a2z"]');
            fetch('/reportcentral/api/v1/getDownloadReportStatus?referenceIds=' + arguments[0],
                  {credentials: 'include', headers: meta ? {'anti-csrftoken-a2z': meta.content} : {}})
                .then(r => r.text().then(t => done({status: r.status, body: t})))
                .catch(e => done({error: String(e)}));
        """
        logging.info(f"[{brand}] [{task_name}] Đang chờ Amazon tạo báo cáo...")
        report_status = None
        for _ in range(36):  # tối đa ~3 phút
            time.sleep(5)
            result = driver.execute_async_script(status_js, reference_id)
            if result.get("error") or result.get("status") != 200:
                logging.warning(f"[{brand}] [{task_name}] Lỗi khi kiểm tra trạng thái: {result}")
                continue
            report_status = (json.loads(result["body"]) or [None])[0]
            if report_status == "Done":
                break
            if report_status not in ("InQueue", "InProgress"):
                raise Exception(f"Báo cáo kết thúc với trạng thái lạ: {report_status}")
        else:
            raise Exception(f"Báo cáo chưa xong sau 3 phút (trạng thái cuối: {report_status}).")

        wait_time = random.uniform(3, 6)
        logging.info(f"[{brand}] [{task_name}] Báo cáo đã sẵn sàng. Chờ {wait_time:.2f} giây trước khi tải...")
        time.sleep(wait_time)

        driver.get(f"https://sellercentral.amazon.com/reportcentral/api/v1/downloadFile"
                   f"?referenceId={reference_id}&fileFormat=TSV")
        logging.info(f"[{brand}] [{task_name}] Đã gửi lệnh tải file (Reference ID: {reference_id}).")
        return True
    except Exception as e:
        logging.error(f"[{brand}] Lỗi khi yêu cầu/tải File 02: {e}", exc_info=True)
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"💥 _Lỗi khi yêu cầu/tải File 02_\n" \
              f"Lỗi: `{escape_markdown(str(e).splitlines()[0])}`"
        send_telegram_message(msg, script_name_override="BO-amz-02-AllOrders")
        return False


def rename_and_move_file02_all_orders_report(brand, target_date, destination_path):
    logging.info(f"[{brand}] Bắt đầu: Đổi tên và Di chuyển File 02 (All Orders).")
    # --- CẬP NHẬT ĐƯỜNG DẪN TẢI VỀ THEO BRAND ---
    download_dir = os.path.join(DESTINATION_ROOT_DIR, brand)

    try:
        time.sleep(random.uniform(5, 10))
        files_in_download_dir = [os.path.join(download_dir, f) for f in os.listdir(download_dir) if f.endswith('.txt')]
        if not files_in_download_dir:
            raise FileNotFoundError("Không tìm thấy file .txt nào trong thư mục Downloads.")

        latest_file = max(files_in_download_dir, key=os.path.getctime)
        logging.info(f"[{brand}] [File 02] Đã xác định file mới nhất là: {latest_file}")

        initial_size = -1
        for _ in range(60):
            if os.path.exists(latest_file):
                current_size = os.path.getsize(latest_file)
                if current_size > 0 and current_size == initial_size:
                    logging.info(f"[{brand}] [File 02] File đã tải về hoàn tất.")
                    break
                initial_size = current_size
            time.sleep(1)
        else:
            raise Exception("File không tải xong sau 60s.")

        if os.path.exists(destination_path):
            os.remove(destination_path)

        # Đảm bảo thư mục đích tồn tại
        os.makedirs(os.path.dirname(destination_path), exist_ok=True)

        shutil.move(latest_file, destination_path)
        logging.info(f"[{brand}] [File 02] Đã di chuyển file thành công tới: {destination_path}")

        telegram_path = destination_path.replace('\\', '\\\\')
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"📄 _File 02 \\(All Orders\\) đã được tải và chuyển thành công_\\.\n" \
              f"Đường dẫn: `{telegram_path}`"
        send_telegram_message(msg, script_name_override="BO-amz-02-AllOrders")
        return True

    except Exception as e:
        logging.error(f"[{brand}] Lỗi khi đổi tên/di chuyển File 02: {e}")
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"💥 _Lỗi khi đổi tên/di chuyển File 02_\n" \
              f"Lỗi: `{escape_markdown(str(e).splitlines()[0])}`"
        send_telegram_message(msg, script_name_override="BO-amz-02-AllOrders")
        return False


# ==================== FILE 03: RETURN REPORT ====================
def request_and_download_file03_return_report(driver, wait, profile_id, brand, target_date):
    logging.info(f"[{brand}] Bắt đầu: Yêu cầu và Tải File 03 (Return).")
    task_name = "File 03"
    url = "https://sellercentral.amazon.com/payments/event/view?accountType=PAYABLE&eventType=AffordabilityExpenseReversal&eventType=AmazonShippingReimbursement&eventType=FulfillmentFeeRefund&eventType=Refund&eventType=RetrochargeReversal&eventType=PerformanceBondRefund&resultsPerPage=10&pageNumber=1"

    date_to_str = target_date.strftime("%m/%d/%Y")
    date_from = target_date - timedelta(days=6)
    date_from_str = date_from.strftime("%m/%d/%Y")

    try:
        driver.get(url)

        if not login_if_needed_seller_central(driver, wait, profile_id, brand):
            raise Exception("Đăng nhập Seller Central thất bại.")

        max_retries = 2
        for attempt in range(max_retries):
            try:
                header = wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, "h1.transaction-view-title")))
                if "Transaction View" in header.text:
                    logging.info(f"[{brand}] [{task_name}] Đã xác minh trang 'Transaction View' thành công.")
                    break
                else:
                    raise Exception("Header không chứa 'Transaction View'.")
            except Exception as e:
                logging.warning(
                    f"[{brand}] [{task_name}] Kiểm tra trang thất bại (Lần {attempt + 1}/{max_retries}). Lỗi: {e}. Thử tải lại URL...")
                driver.get(url)
                time.sleep(5)
                if attempt + 1 == max_retries:
                    raise Exception("Không vào được trang Transaction View sau nhiều lần thử.")

        from_date_host = wait.until(EC.presence_of_element_located(
            (By.CSS_SELECTOR, "div.time-range-selection > kat-date-picker:nth-child(1)")))
        from_date_root = get_shadow_root(driver, from_date_host)
        from_date_input_host = from_date_root.find_element(By.CSS_SELECTOR, "kat-input")
        from_date_input_root = get_shadow_root(driver, from_date_input_host)
        from_date_input = from_date_input_root.find_element(By.CSS_SELECTOR, "input")
        from_date_input.clear()
        from_date_input.send_keys(date_from_str)

        to_date_host = wait.until(EC.presence_of_element_located(
            (By.CSS_SELECTOR, "div.time-range-selection > kat-date-picker:nth-child(2)")))
        to_date_root = get_shadow_root(driver, to_date_host)
        to_date_input_host = to_date_root.find_element(By.CSS_SELECTOR, "kat-input")
        to_date_input_root = get_shadow_root(driver, to_date_input_host)
        to_date_input = to_date_input_root.find_element(By.CSS_SELECTOR, "input")
        to_date_input.clear()
        to_date_input.send_keys(date_to_str)
        logging.info(f"[{brand}] [{task_name}] Đã điền ngày: {date_from_str} - {date_to_str}.")

        time.sleep(random.uniform(1, 2))
        try:
            wait.until(EC.element_to_be_clickable((By.XPATH, "//*[@id='root']/div/article[2]/section[2]"))).click()
            time.sleep(random.uniform(0.2, 0.5))
        except Exception:
            pass

        kat_button = wait.until(
            EC.element_to_be_clickable((By.XPATH, "//*[@id='root']/div/article[2]/section[2]/div/form/kat-button")))
        driver.execute_script("arguments[0].click();", kat_button)
        logging.info(f"[{brand}] [{task_name}] Đã click kat-button (Update).")

        try:
            submit_wait = WebDriverWait(driver, 5)
            submit_button = submit_wait.until(
                EC.element_to_be_clickable((By.XPATH, "//*[@id='root']/div/article[2]/section[2]/div/form/button")))
            driver.execute_script("arguments[0].click();", submit_button)
        except TimeoutException:
            pass

        time.sleep(random.uniform(5, 7))

        # SỬA LỖI LOGIC: KIỂM TRA TRẠNG THÁI NÚT DOWNLOAD
        download_button_host_locator = (By.XPATH,
                                        "//*[@id='root']/div/article[3]/section[3]/div/kat-card/kat-button[2]")
        download_button_host = WebDriverWait(driver, 20).until(
            EC.presence_of_element_located(download_button_host_locator)
        )
        is_disabled = download_button_host.get_attribute('disabled')

        if is_disabled and str(is_disabled).lower() == 'true':
            logging.warning(
                f"[{brand}] [{task_name}] Nút Download bị vô hiệu hóa. Kiểm tra alert 'No results found'...")
            try:
                no_results_alert = WebDriverWait(driver, 5).until(
                    EC.visibility_of_element_located((By.CSS_SELECTOR, 'kat-alert[variant="info"]'))
                )
                alert_header = no_results_alert.find_element(By.CSS_SELECTOR, "span[slot='header']")
                if "No results found" in alert_header.text:
                    logging.warning(f"[{brand}] [{task_name}] Xác nhận không có dữ liệu: 'No results found'.")
                    return "NO_DATA", date_from_str, date_to_str
                else:
                    raise Exception(
                        f"Nút Download bị vô hiệu hóa nhưng không tìm thấy thông báo 'No results found'. Tìm thấy alert: {alert_header.text}")
            except TimeoutException:
                raise Exception("Nút Download bị vô hiệu hóa và không tìm thấy bất kỳ alert nào.")
        else:
            logging.info(f"[{brand}] [{task_name}] Nút Download đã được kích hoạt. Tiến hành tải file.")
            wait_time = random.uniform(5, 10)
            logging.info(f"[{brand}] [{task_name}] Chờ {wait_time:.2f} giây trước khi bấm tải...")
            time.sleep(wait_time)

            download_button_root = get_shadow_root(driver, download_button_host)
            download_button_root.find_element(By.CSS_SELECTOR, "button").click()
            logging.info(f"[{brand}] [{task_name}] Đã click nút 'Download'.")
            return "DOWNLOAD_INITIATED", date_from_str, date_to_str

    except Exception as e:
        logging.error(f"[{brand}] Lỗi khi yêu cầu/tải File 03: {e}", exc_info=True)
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"💥 _Lỗi khi yêu cầu/tải File 03_\n" \
              f"Lỗi: `{escape_markdown(str(e).splitlines()[0])}`"
        send_telegram_message(msg, script_name_override="BO-amz-03-ReturnReport")
        return False, None, None


def rename_and_move_file03_return_report(brand, target_date, destination_path):
    logging.info(f"[{brand}] Bắt đầu: Đổi tên và Di chuyển File 03 (Return).")
    # --- CẬP NHẬT ĐƯỜNG DẪN TẢI VỀ THEO BRAND ---
    download_dir = os.path.join(DESTINATION_ROOT_DIR, brand)

    try:
        time.sleep(random.uniform(5, 10))
        latest_file = None
        for _ in range(12):  # Chờ tối đa 60 giây
            files = [os.path.join(download_dir, f) for f in os.listdir(download_dir) if
                     f.startswith('Transactions') and f.endswith('.csv')]
            if files:
                latest_file = max(files, key=os.path.getctime)
                logging.info(f"[{brand}] [File 03] Đã xác định file mới nhất là: {latest_file}")
                break
            logging.warning(f"[{brand}] [File 03] Chưa tìm thấy file Transactions. Chờ 5 giây và thử lại...")
            time.sleep(5)

        if not latest_file:
            raise FileNotFoundError("Không tìm thấy file .csv (Transactions) trong thư mục Downloads.")

        if os.path.exists(destination_path):
            os.remove(destination_path)

        # Đảm bảo thư mục đích tồn tại
        os.makedirs(os.path.dirname(destination_path), exist_ok=True)

        shutil.move(latest_file, destination_path)
        logging.info(f"[{brand}] [File 03] Đã di chuyển file thành công tới: {destination_path}")

        telegram_path = destination_path.replace('\\', '\\\\')
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"📄 _File 03 \\(Return Report\\) đã được tải và chuyển thành công_\\.\n" \
              f"Đường dẫn: `{telegram_path}`"
        send_telegram_message(msg, script_name_override="BO-amz-03-ReturnReport")
        return True
    except Exception as e:
        logging.error(f"[{brand}] Lỗi khi đổi tên/di chuyển File 03: {e}")
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"💥 _Lỗi khi đổi tên/di chuyển File 03_\n" \
              f"Lỗi: `{escape_markdown(str(e).splitlines()[0])}`"
        send_telegram_message(msg, script_name_override="BO-amz-03-ReturnReport")
        return False


# ==================== FILE 04: SERVICE FEES REPORT ====================
def request_and_download_file04_service_fee_report(driver, wait, profile_id, brand, target_date):
    logging.info(f"[{brand}] Bắt đầu: Yêu cầu và Tải File 04 (Service Fees).")
    task_name = "File 04"
    url = "https://sellercentral.amazon.com/payments/event/view?accountType=PAYABLE&eventType=ProductAdsPayment&eventType=SellerDealPayment&eventType=SellerReviewEnrollmentPayment&eventType=SellerCouponPayment&eventType=ServiceFee&eventType=AmazonUpstreamProcessingFee&eventType=AmazonUpstreamStorageTransportationFee&eventType=StorageReservationBilling&eventType=STARStorageBilling&eventType=StandardFeeTransaction&eventType=EPRFeeChargeback&resultsPerPage=10&pageNumber=1"

    date_to_str = target_date.strftime("%m/%d/%Y")
    date_from = target_date - timedelta(days=6)
    date_from_str = date_from.strftime("%m/%d/%Y")

    try:
        driver.get(url)

        if not login_if_needed_seller_central(driver, wait, profile_id, brand):
            raise Exception("Đăng nhập Seller Central thất bại.")

        max_retries = 2
        for attempt in range(max_retries):
            try:
                header = wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, "h1.transaction-view-title")))
                if "Transaction View" in header.text:
                    logging.info(f"[{brand}] [{task_name}] Đã xác minh trang 'Transaction View' thành công.")
                    break
                else:
                    raise Exception("Header không chứa 'Transaction View'.")
            except Exception as e:
                logging.warning(
                    f"[{brand}] [{task_name}] Kiểm tra trang thất bại (Lần {attempt + 1}/{max_retries}). Lỗi: {e}. Thử tải lại URL...")
                driver.get(url)
                time.sleep(5)
                if attempt + 1 == max_retries:
                    raise Exception("Không vào được trang Transaction View sau nhiều lần thử.")

        from_date_host = wait.until(EC.presence_of_element_located(
            (By.CSS_SELECTOR, "div.time-range-selection > kat-date-picker:nth-child(1)")))
        from_date_root = get_shadow_root(driver, from_date_host)
        from_date_input_host = from_date_root.find_element(By.CSS_SELECTOR, "kat-input")
        from_date_input_root = get_shadow_root(driver, from_date_input_host)
        from_date_input = from_date_input_root.find_element(By.CSS_SELECTOR, "input")
        from_date_input.clear()
        from_date_input.send_keys(date_from_str)

        to_date_host = wait.until(EC.presence_of_element_located(
            (By.CSS_SELECTOR, "div.time-range-selection > kat-date-picker:nth-child(2)")))
        to_date_root = get_shadow_root(driver, to_date_host)
        to_date_input_host = to_date_root.find_element(By.CSS_SELECTOR, "kat-input")
        to_date_input_root = get_shadow_root(driver, to_date_input_host)
        to_date_input = to_date_input_root.find_element(By.CSS_SELECTOR, "input")
        to_date_input.clear()
        to_date_input.send_keys(date_to_str)
        logging.info(f"[{brand}] [{task_name}] Đã điền ngày: {date_from_str} - {date_to_str}.")

        time.sleep(random.uniform(1, 2))
        try:
            wait.until(EC.element_to_be_clickable((By.XPATH, "//*[@id='root']/div/article[2]/section[2]"))).click()
            time.sleep(random.uniform(0.2, 0.5))
        except Exception:
            pass

        kat_button = wait.until(
            EC.element_to_be_clickable((By.XPATH, "//*[@id='root']/div/article[2]/section[2]/div/form/kat-button")))
        driver.execute_script("arguments[0].click();", kat_button)
        logging.info(f"[{brand}] [{task_name}] Đã click kat-button (Update).")

        try:
            submit_wait = WebDriverWait(driver, 5)
            submit_button = submit_wait.until(
                EC.element_to_be_clickable((By.XPATH, "//*[@id='root']/div/article[2]/section[2]/div/form/button")))
            driver.execute_script("arguments[0].click();", submit_button)
        except TimeoutException:
            pass

        time.sleep(random.uniform(5, 7))

        # SỬA LỖI LOGIC: KIỂM TRA TRẠNG THÁI NÚT DOWNLOAD
        download_button_host_locator = (By.XPATH,
                                        "//*[@id='root']/div/article[3]/section[3]/div/kat-card/kat-button[2]")
        download_button_host = WebDriverWait(driver, 20).until(
            EC.presence_of_element_located(download_button_host_locator)
        )
        is_disabled = download_button_host.get_attribute('disabled')

        if is_disabled and str(is_disabled).lower() == 'true':
            logging.warning(
                f"[{brand}] [{task_name}] Nút Download bị vô hiệu hóa. Kiểm tra alert 'No results found'...")
            try:
                no_results_alert = WebDriverWait(driver, 5).until(
                    EC.visibility_of_element_located((By.CSS_SELECTOR, 'kat-alert[variant="info"]'))
                )
                alert_header = no_results_alert.find_element(By.CSS_SELECTOR, "span[slot='header']")
                if "No results found" in alert_header.text:
                    logging.warning(f"[{brand}] [{task_name}] Xác nhận không có dữ liệu: 'No results found'.")
                    return "NO_DATA", date_from_str, date_to_str
                else:
                    raise Exception(
                        f"Nút Download bị vô hiệu hóa nhưng không tìm thấy thông báo 'No results found'. Tìm thấy alert: {alert_header.text}")
            except TimeoutException:
                raise Exception("Nút Download bị vô hiệu hóa và không tìm thấy bất kỳ alert nào.")
        else:
            logging.info(f"[{brand}] [{task_name}] Nút Download đã được kích hoạt. Tiến hành tải file.")
            wait_time = random.uniform(5, 10)
            logging.info(f"[{brand}] [{task_name}] Chờ {wait_time:.2f} giây trước khi bấm tải...")
            time.sleep(wait_time)

            download_button_root = get_shadow_root(driver, download_button_host)
            download_button_root.find_element(By.CSS_SELECTOR, "button").click()
            logging.info(f"[{brand}] [{task_name}] Đã click nút 'Download'.")
            return "DOWNLOAD_INITIATED", date_from_str, date_to_str

    except Exception as e:
        logging.error(f"[{brand}] Lỗi khi yêu cầu/tải File 04: {e}", exc_info=True)
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"💥 _Lỗi khi yêu cầu/tải File 04_\n" \
              f"Lỗi: `{escape_markdown(str(e).splitlines()[0])}`"
        send_telegram_message(msg, script_name_override="BO-amz-04-ServiceFee")
        return False, None, None


def rename_and_move_file04_service_fee_report(brand, target_date, destination_path):
    logging.info(f"[{brand}] Bắt đầu: Đổi tên và Di chuyển File 04 (Service Fees).")
    # --- CẬP NHẬT ĐƯỜNG DẪN TẢI VỀ THEO BRAND ---
    download_dir = os.path.join(DESTINATION_ROOT_DIR, brand)

    try:
        time.sleep(random.uniform(5, 10))
        latest_file = None
        for _ in range(12):  # Chờ tối đa 60 giây
            files = [
                os.path.join(download_dir, f)
                for f in os.listdir(download_dir)
                if f.startswith('Transactions') and f.endswith('.csv')
            ]
            if files:
                latest_file = max(files, key=os.path.getctime)
                logging.info(f"[{brand}] [File 04] Đã xác định file mới nhất là: {latest_file}")
                break
            logging.warning(f"[{brand}] [File 04] Chưa tìm thấy file Transactions. Chờ 5 giây và thử lại...")
            time.sleep(5)

        if not latest_file:
            raise FileNotFoundError("Không tìm thấy file .csv (Transactions) trong thư mục Downloads.")

        if os.path.exists(destination_path):
            os.remove(destination_path)

        # Đảm bảo thư mục đích tồn tại
        os.makedirs(os.path.dirname(destination_path), exist_ok=True)

        shutil.move(latest_file, destination_path)
        logging.info(f"[{brand}] [File 04] Đã di chuyển file thành công tới: {destination_path}")

        telegram_path = destination_path.replace('\\', '\\\\')
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"📄 _File 04 \\(Service Fees\\) đã được tải và chuyển thành công_\\.\n" \
              f"Đường dẫn: `{telegram_path}`"
        send_telegram_message(msg, script_name_override="BO-amz-04-ServiceFee")
        return True
    except Exception as e:
        logging.error(f"[{brand}] Lỗi khi đổi tên/di chuyển File 04: {e}")
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"💥 _Lỗi khi đổi tên/di chuyển File 04_\n" \
              f"Lỗi: `{escape_markdown(str(e).splitlines()[0])}`"
        send_telegram_message(msg, script_name_override="BO-amz-04-ServiceFee")
        return False


# ==================== FILE 05: CAMPAIGNS REPORT (MODIFIED) ====================
def _wait_and_rename_immediate(brand, new_filename, timeout=60):
    """
    Chờ file mới nhất xuất hiện và đổi tên ngay lập tức để tránh bị ghi đè.
    """
    download_dir = os.path.join(DESTINATION_ROOT_DIR, brand)
    start_time = time.time()

    # Lấy mốc thời gian hiện tại để chỉ tìm file sinh ra SAU lúc này
    check_timestamp = datetime.now(VN_TZ).timestamp() - 10  # Trừ hao 10s cho chắc

    logging.info(f"[{brand}] [File 05] Đang chờ file tải về để đổi tên thành: {new_filename}...")

    while time.time() - start_time < timeout:
        try:
            # Tìm tất cả file csv có tên bắt đầu bằng 'campaign' hoặc 'sponsored' (tên gốc Amazon)
            files = [
                os.path.join(download_dir, f)
                for f in os.listdir(download_dir)
                if (f.lower().startswith('campaign') or f.lower().startswith('sponsored'))
                   and f.lower().endswith('.csv')
                   and os.path.getmtime(os.path.join(download_dir, f)) > check_timestamp
            ]

            if files:
                # Lấy file mới nhất
                latest_file = max(files, key=os.path.getctime)

                # Chờ file hết bị lock (tải xong hoàn toàn)
                prev_size = -1
                for _ in range(10):
                    curr_size = os.path.getsize(latest_file)
                    if curr_size > 0 and curr_size == prev_size:
                        break
                    prev_size = curr_size
                    time.sleep(1)

                # Thực hiện đổi tên
                dest_path = os.path.join(download_dir, new_filename)
                if os.path.exists(dest_path):
                    os.remove(dest_path)  # Xóa nếu file temp cũ còn tồn tại

                shutil.move(latest_file, dest_path)
                logging.info(f"[{brand}] [File 05] Đã tải và đổi tên thành công: {new_filename}")
                return True

        except Exception as e:
            # logging.warning(f"Checking file error: {e}")
            pass

        time.sleep(2)

    logging.error(f"[{brand}] [File 05] Timeout khi chờ file để đổi tên.")
    return False


def _wait_for_download_completion(brand, expected_count, timeout=60):
    """
    Hàm chờ (Wait) cho đến khi số lượng file .csv trong thư mục download đạt yêu cầu.
    Dùng cho trường hợp tải 1 file duy nhất (< 50 campaigns) hoặc file placeholder.
    """
    # Đường dẫn thư mục download của Brand
    download_dir = os.path.join(DESTINATION_ROOT_DIR, brand)

    logging.info(f"[{brand}] [File 05] Đang chờ xác nhận tải đủ {expected_count} file...")

    start_time = time.time()
    # Chỉ tính các file được tạo ra trong khoảng 5 phút gần đây để tránh lấy nhầm file cũ
    check_timestamp = datetime.now(VN_TZ).timestamp() - 300

    while time.time() - start_time < timeout:
        try:
            # Lọc các file csv có tên liên quan đến Campaign (Tên gốc Amazon trả về)
            # Thường bắt đầu bằng 'Sponsored' hoặc 'Campaign' hoặc 'temp_'
            files = [
                os.path.join(download_dir, f)
                for f in os.listdir(download_dir)
                if f.lower().endswith('.csv')
                   and (f.lower().startswith('campaign') or f.lower().startswith('sponsored') or f.lower().startswith(
                    'temp_'))
                   and os.path.getmtime(os.path.join(download_dir, f)) > check_timestamp
            ]

            # Nếu số lượng file tìm thấy >= số lượng mong đợi (thường là 1)
            if len(files) >= expected_count:
                # Kiểm tra kỹ file cuối cùng xem đã tải xong hẳn chưa (check size ổn định)
                latest_file = max(files, key=os.path.getctime)

                prev_size = -1
                stable_check_pass = False

                # Check độ ổn định file trong 3 giây liên tiếp
                for _ in range(3):
                    if not os.path.exists(latest_file): break  # File bị xóa hoặc lỗi
                    curr_size = os.path.getsize(latest_file)
                    if curr_size > 0 and curr_size == prev_size:
                        stable_check_pass = True
                    else:
                        stable_check_pass = False
                    prev_size = curr_size
                    time.sleep(1)

                if stable_check_pass:
                    logging.info(
                        f"[{brand}] [File 05] Đã tải đủ {len(files)}/{expected_count} file và file đã ổn định.")

                    # --- ĐOẠN NÀY QUAN TRỌNG ĐỂ KHỚP VỚI LOGIC CŨ ---
                    # Nếu tải 1 file lẻ, ta đổi tên nó thành temp_campaign_part_1.csv
                    # để đoạn code Gộp File (rename_and_move) phía sau nhận diện được.
                    if expected_count == 1:
                        temp_name = os.path.join(download_dir, "temp_campaign_part_1.csv")
                        # Xóa file temp cũ nếu có
                        if os.path.exists(temp_name): os.remove(temp_name)
                        # Đổi tên file vừa tải xong thành file temp chuẩn
                        try:
                            shutil.move(latest_file, temp_name)
                            logging.info(
                                f"[{brand}] [File 05] Đã đổi tên file lẻ thành chuẩn: temp_campaign_part_1.csv")
                        except Exception as e:
                            logging.warning(f"[{brand}] Không thể đổi tên file lẻ (có thể đã đúng tên): {e}")

                    return True

        except Exception as e:
            # logging.warning(f"Checking file error: {e}") # Có thể bỏ qua log lỗi nhỏ khi đang check
            pass

        time.sleep(2)  # Chờ 2s rồi check lại

    logging.error(f"[{brand}] Timeout: Không tìm thấy đủ {expected_count} file sau {timeout}s.")
    return False


def request_and_download_file05_campaigns_report(driver, wait, profile_id, brand, target_date):
    logging.info(f"[{brand}] Bắt đầu: Yêu cầu và Tải File 05 (Campaigns) - Luồng mới.")
    url = "https://advertising.amazon.com/campaign-manager"

    # --- CẬP NHẬT ĐƯỜNG DẪN TẢI VỀ THEO BRAND ĐỂ CLEAN UP ---
    download_dir = os.path.join(DESTINATION_ROOT_DIR, brand)

    try:
        driver.get(url)
        time.sleep(random.uniform(2, 4))
        logging.info(f"[{brand}] [File 05] Đã tải lại trang để đảm bảo trạng thái mới và chờ ngẫu nhiên.")

        if not login_if_needed_advertising(driver, wait, profile_id, brand):
            raise Exception("Đăng nhập Advertising thất bại.")

        logging.info(f"[{brand}] [File 05] Áp dụng luồng xử lý cho giao diện mới.")
        date_picker_button_2 = wait.until(EC.element_to_be_clickable(
            (By.ID, "UCM-CM-APP:globalBetaAllCampaigns:dateRangeFilter:openContainer")))
        date_picker_button_2.click()
        logging.info(f"[{brand}] [File 05] Đã mở bảng chọn ngày.")
        time.sleep(random.uniform(2, 3))

        # *** YÊU CẦU DUY NHẤT ĐƯỢC THÊM VÀO ***
        # BẤM NÚT LÙI THÁNG
        try:
            time.sleep(random.uniform(0.5, 1.0))
            prev_month_button_xpath = "//*[@id='UCM-CM-APP:globalBetaAllCampaigns:dateRangeFilter:container']/div/div/div/div/div/div[2]/div/div/div/button"
            prev_month_button = wait.until(EC.element_to_be_clickable((By.XPATH, prev_month_button_xpath)))
            prev_month_button.click()
            logging.info(f"[{brand}] [File 05] Đã bấm nút lùi tháng.")
            time.sleep(random.uniform(1, 2))
        except Exception as e:
            logging.warning(f"[{brand}] [File 05] Không bấm được nút lùi tháng, có thể không cần thiết. Lỗi: {e}")
        # *** KẾT THÚC PHẦN THÊM VÀO ***

        target_date_iso_str = target_date.strftime('%Y-%m-%d')
        date_element_xpath_2 = f"//button[@data-iso-date='{target_date_iso_str}']"
        date_element_2 = WebDriverWait(driver, 10).until(
            EC.element_to_be_clickable((By.XPATH, date_element_xpath_2)))
        date_element_2.click()
        logging.info(f"[{brand}] [File 05] Đã chọn ngày: {target_date.strftime('%d/%m/%Y')}.")
        time.sleep(random.uniform(1, 2))

        apply_button_date_2 = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR,
                                                                     "button[data-takt-id='UCM-CM-APP:globalBetaAllCampaigns:dateRangeFilter:dateRange-save']")))
        apply_button_date_2.click()
        logging.info(f"[{brand}] [File 05] Đã click Apply để áp dụng ngày.")
        time.sleep(random.uniform(3, 5))

        try:
            remove_all_button_2 = WebDriverWait(driver, 10).until(EC.element_to_be_clickable((By.CSS_SELECTOR,
                                                                                              "button[data-e2e-id='UCM-CM-APP:globalBetaAllCampaigns:filterBar:removeAll']")))
            remove_all_button_2.click()
            logging.info(f"[{brand}] [File 05] Đã click nút 'Remove all'.")
            time.sleep(random.uniform(1, 2))
        except TimeoutException:
            logging.warning(f"[{brand}] [File 05] Không tìm thấy nút 'Remove all', bỏ qua.")

        try:
            clear_search_button_2 = WebDriverWait(driver, 5).until(
                EC.element_to_be_clickable((By.CSS_SELECTOR, "button[aria-label='Clear search terms']")))
            clear_search_button_2.click()
            logging.info(f"[{brand}] [File 05] Đã xóa nội dung trong ô tìm kiếm.")
            time.sleep(random.uniform(1, 2))
        except TimeoutException:
            logging.info(f"[{brand}] [File 05] Không có trường tìm kiếm để xóa.")

        wait.until(EC.element_to_be_clickable(
            (By.ID, "UCM-CM-APP:globalBetaAllCampaigns:addFilterSelector:optionSelector"))).click()
        time.sleep(1)
        wait.until(EC.element_to_be_clickable(
            (By.ID, "UCM-CM-APP:globalBetaAllCampaigns:addFilterSelector:option-impressions"))).click()
        time.sleep(1)
        wait.until(EC.element_to_be_clickable(
            (By.ID, "UCM-CM-APP:globalBetaAllCampaigns:filter:impressions:options"))).click()
        time.sleep(1)
        wait.until(EC.element_to_be_clickable(
            (By.ID, "UCM-CM-APP:globalBetaAllCampaigns:filter:impressions:option-greaterThan"))).click()
        time.sleep(1)
        impression_input_2 = wait.until(EC.visibility_of_element_located(
            (By.ID, "UCM-CM-APP:globalBetaAllCampaigns:filter:impressions:input")))
        impression_input_2.clear()
        impression_input_2.send_keys("0")
        time.sleep(1)
        wait.until(EC.element_to_be_clickable(
            (By.ID, "UCM-CM-APP:globalBetaAllCampaigns:filter:impressions:apply"))).click()
        logging.info(f"[{brand}] [File 05] Đã áp dụng filter 'Impression > 0'.")

        logging.info(f"[{brand}] [File 05] Chờ dữ liệu và pagination tải lại sau khi filter...")
        time.sleep(5)

        # --- START: MODIFICATION - Check for "No data available" ---
        try:
            no_data_element_xpath = "//*[@id='UCM-CM-APP:globalBetaAllCampaigns:overlay:noRows']/h3"
            no_data_element = WebDriverWait(driver, 5).until(
                EC.visibility_of_element_located((By.XPATH, no_data_element_xpath))
            )
            if "No data available" in no_data_element.text:
                logging.warning(f"[{brand}] [File 05] Phát hiện 'No data available'. Tải file placeholder.")
                msg = f"\\- *{escape_markdown(brand)}*\n" \
                      f"⚠️ _File 05 \\(Campaigns\\): Placeholder \\(No data available\\)_"
                send_telegram_message(msg, script_name_override="BO-amz-05-Campaigns")

                # Click export as requested to download the empty/placeholder file
                export_button = wait.until(
                    EC.element_to_be_clickable((By.ID, "UCM-CM-APP:globalBetaAllCampaigns:export")))
                driver.execute_script("arguments[0].click();", export_button)

                # Wait for the single placeholder file to download
                if not _wait_for_download_completion(brand, 1, timeout=60):
                    raise Exception(f"Tải file placeholder thất bại.")

                # Return success with 1 file to process
                return True, 1
        except TimeoutException:
            logging.info(f"[{brand}] [File 05] Không tìm thấy 'No data available'. Tiếp tục xử lý bình thường.")
            pass  # Continue to the pagination check
        # --- END: MODIFICATION ---

        try:
            pagination_dropdown = WebDriverWait(driver, 15).until(
                EC.element_to_be_clickable((By.ID, "UCM-CM-APP:globalBetaAllCampaigns:pagination-dropdown"))
            )
            pagination_dropdown.click()
            logging.info(f"[{brand}] [File 05] Đã tìm thấy pagination, xử lý nhiều file...")
            time.sleep(random.uniform(1, 2))

            results_300_option = wait.until(
                EC.element_to_be_clickable((By.ID, "UCM-CM-APP:globalBetaAllCampaigns:pagination-dropdown-300"))
            )
            results_300_option.click()
            logging.info(f"[{brand}] [File 05] Đã chọn hiển thị 300 kết quả/trang.")

            wait_time_for_300 = random.uniform(10, 15)
            logging.info(f"[{brand}] [File 05] Chờ {wait_time_for_300:.2f} giây để load tất cả dữ liệu...")
            time.sleep(wait_time_for_300)

            status_element = wait.until(
                EC.visibility_of_element_located((By.ID, "UCM-CM-APP:globalBetaAllCampaigns:pagination-page-status")))
            status_text = status_element.text
            logging.info(f"[{brand}] [File 05] Pagination status: {status_text}")

            match = re.search(r'of\s+([\d,]+)', status_text)
            if not match:
                match = re.search(r'(\d[\d,]*)\s+results', status_text)
            if not match:
                raise Exception(f"Không thể trích xuất tổng số kết quả từ chuỗi: '{status_text}'")

            total_results = int(match.group(1).replace(',', ''))
            logging.info(f"[{brand}] [File 05] Tổng số kết quả: {total_results}")

            if total_results == 0:
                logging.warning(f"[{brand}] [File 05] Không có kết quả nào để tải. Bỏ qua.")
                return True, 0

            total_files_to_download = (total_results + 299) // 300

            today_start_timestamp = datetime.now(VN_TZ).replace(hour=0, minute=0, second=0, microsecond=0).timestamp()

            # CLEAN UP OLD FILES IN BRAND FOLDER
            if os.path.exists(download_dir):
                for f in os.listdir(download_dir):
                    if f.lower().startswith('campaign') and f.lower().endswith('.csv'):
                        file_path = os.path.join(download_dir, f)
                        if os.path.getmtime(file_path) >= today_start_timestamp:
                            os.remove(file_path)

            for i in range(total_files_to_download):
                current_file_num = i + 1
                logging.info(f"[{brand}] [File 05] Bắt đầu tải file {current_file_num}/{total_files_to_download}...")
                if i > 0:
                    next_button = wait.until(
                        EC.element_to_be_clickable((By.ID, "UCM-CM-APP:globalBetaAllCampaigns:pagination-next")))
                    next_button.click()
                    logging.info(f"[{brand}] [File 05] Đã bấm Next Page.")

                    wait_next_page = random.uniform(9, 12)
                    logging.info(f"[{brand}] [File 05] Chờ {wait_next_page:.2f} giây để tải trang tiếp theo...")
                    time.sleep(wait_next_page)

                export_button = wait.until(
                    EC.element_to_be_clickable((By.ID, "UCM-CM-APP:globalBetaAllCampaigns:export")))
                driver.execute_script("arguments[0].click();", export_button)

                # --- SỬA 2: GỌI HÀM ĐỔI TÊN NGAY LẬP TỨC ---
                temp_filename = f"temp_campaign_part_{current_file_num}.csv"
                if not _wait_and_rename_immediate(brand, temp_filename):
                    raise Exception(f"Tải và đổi tên file thứ {current_file_num} thất bại.")

            logging.info(f"[{brand}] [File 05] Đã hoàn tất tải {total_files_to_download} file.")
            return True, total_files_to_download

        except TimeoutException:
            logging.warning(
                f"[{brand}] [File 05] Không tìm thấy dropdown pagination. Thử check số lượng campaign thủ công.")
            total_campaigns = -1
            total_span_xpaths = [
                "//div[4]/div/span/div/span",
                "//div[3]/div/span/div/span"
            ]

            for i, xpath in enumerate(total_span_xpaths):
                try:
                    total_element = WebDriverWait(driver, 5).until(
                        EC.visibility_of_element_located((By.XPATH, xpath))
                    )
                    text_content = total_element.text
                    logging.info(f"[{brand}] [File 05] Tìm thấy element total tại xpath {i + 1}: '{text_content}'")
                    match = re.search(r'(\d+)', text_content)
                    if match:
                        total_campaigns = int(match.group(1))
                        logging.info(f"[{brand}] [File 05] Số campaign được trích xuất: {total_campaigns}")
                        break
                    else:
                        logging.warning(f"[{brand}] [File 05] Không trích xuất được số từ: '{text_content}'")

                except TimeoutException:
                    logging.info(f"[{brand}] [File 05] Không tìm thấy element total tại xpath {i + 1}.")
                    if i == 0:
                        pause_duration = random.uniform(2, 3)
                        logging.info(f"[{brand}] [File 05] Pause {pause_duration:.3f}s trước khi thử xpath tiếp theo.")
                        time.sleep(pause_duration)
                    continue

            if total_campaigns != -1:
                if total_campaigns == 0:
                    logging.info(f"[{brand}] [File 05] Không có dữ liệu nào được tìm thấy (Total: 0). Bỏ qua tải file.")
                    return True, 0

                if total_campaigns < 50:
                    logging.info(f"[{brand}] [File 05] Số campaign ({total_campaigns}) < 50. Xử lý như 1 file.")
                else:
                    logging.warning(
                        f"[{brand}] [File 05] Số campaign ({total_campaigns}) >= 50 nhưng không có pagination. Vẫn xử lý như 1 file.")

                export_button = wait.until(
                    EC.element_to_be_clickable((By.ID, "UCM-CM-APP:globalBetaAllCampaigns:export")))
                driver.execute_script("arguments[0].click();", export_button)
                if not _wait_for_download_completion(brand, 1):
                    raise Exception("Tải file duy nhất thất bại sau khi check total count.")
                logging.info(f"[{brand}] [File 05] Đã hoàn tất tải 1 file.")
                return True, 1
            else:
                logging.error(
                    f"[{brand}] [File 05] Lỗi không tải được file: Không thể xác định số lượng campaign sau khi filter.")
                raise Exception("Lỗi không tải được file: Không thể xác định số lượng campaign sau khi filter.")


    except Exception as e:
        logging.error(f"[{brand}] Lỗi nghiêm trọng khi xử lý File 05: {e}", exc_info=True)
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"💥 _Lỗi khi yêu cầu/tải File 05_\n" \
              f"Lỗi: `{escape_markdown(str(e).splitlines()[0])}`"
        send_telegram_message(msg, script_name_override="BO-amz-05-Campaigns")
        return False, 0


def rename_and_move_file05_campaigns_report(brand, target_date, expected_file_count, destination_path):
    logging.info(f"[{brand}] Bắt đầu: Gộp, Đổi tên và Di chuyển File 05 (Campaigns) bằng Pandas.")
    # --- CẬP NHẬT ĐƯỜNG DẪN TẢI VỀ THEO BRAND ---
    download_dir = os.path.join(DESTINATION_ROOT_DIR, brand)

    try:
        if expected_file_count == 0:
            logging.info(f"[{brand}] [File 05] Không có file nào được tải về, bỏ qua bước này.")
            # Xóa file cũ nếu có và tạo file trống để báo hiệu không có data
            if os.path.exists(destination_path):
                os.remove(destination_path)
            # Đảm bảo thư mục đích tồn tại
            os.makedirs(os.path.dirname(destination_path), exist_ok=True)
            with open(destination_path, 'w') as f:
                f.write('')  # Tạo file trống
            logging.info(f"[{brand}] [File 05] Đã tạo file trống tại đích để đánh dấu không có dữ liệu.")
            return True

        time.sleep(5)
        # today_start_timestamp = datetime.now(VN_TZ).replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
        downloaded_files = sorted(
            [os.path.join(download_dir, f) for f in os.listdir(download_dir)
             if f.startswith('temp_campaign_part_') and f.endswith('.csv')],
            key=lambda x: int(re.search(r'part_(\d+)', x).group(1)) if re.search(r'part_(\d+)', x) else 0
        )

        if len(downloaded_files) < expected_file_count:
            logging.error(
                f"[{brand}] [File 05] Số file tìm thấy ({len(downloaded_files)}) ít hơn số file dự kiến ({expected_file_count}).")
            # Di chuyển những gì đã tải được
            if downloaded_files:
                logging.warning(f"[{brand}] [File 05] Sẽ vẫn xử lý {len(downloaded_files)} file đã tải được.")
            else:
                return False  # Không có file nào để xử lý

        if not downloaded_files:
            raise FileNotFoundError("Không tìm thấy file Campaigns .csv nào dù đã xác nhận tải xuống.")

        if os.path.exists(destination_path):
            os.remove(destination_path)

        # Đảm bảo thư mục đích tồn tại
        os.makedirs(os.path.dirname(destination_path), exist_ok=True)

        if len(downloaded_files) > 1:
            logging.info(f"[{brand}] [File 05] Bắt đầu gộp {len(downloaded_files)} file CSV bằng Pandas...")
            df_list = [pd.read_csv(f) for f in downloaded_files]
            combined_df = pd.concat(df_list, ignore_index=True)
            combined_df.to_csv(destination_path, index=False, encoding='utf-8')
            logging.info(f"[{brand}] [File 05] Đã gộp và lưu file thành công vào: {destination_path}")
            for f in downloaded_files:
                os.remove(f)
        elif len(downloaded_files) == 1:
            logging.info(f"[{brand}] [File 05] Chỉ có 1 file, di chuyển trực tiếp...")
            shutil.move(downloaded_files[0], destination_path)

        telegram_path = destination_path.replace('\\', '\\\\')
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"📄 _File 05 \\(Campaigns\\) đã được tải, gộp và chuyển thành công_\\.\n" \
              f"Đường dẫn: `{telegram_path}`"
        send_telegram_message(msg, script_name_override="BO-amz-05-Campaigns")
        return True

    except Exception as e:
        logging.error(f"[{brand}] Lỗi khi gộp/đổi tên/di chuyển File 05: {e}", exc_info=True)
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"💥 _Lỗi khi gộp/đổi tên/di chuyển File 05_\n" \
              f"Lỗi: `{escape_markdown(str(e).splitlines()[0])}`"
        send_telegram_message(msg, script_name_override="BO-amz-05-Campaigns")
        return False


# ==================== FILE 06: FBA INVENTORY REPORT ====================
def request_and_download_file06_inventory_report(driver, wait, profile_id, brand, target_date):
    logging.info(f"[{brand}] Bắt đầu: Yêu cầu và Tải File 06 (FBA Inventory).")
    task_name = "File 06"
    url = "https://sellercentral.amazon.com/reportcentral/MANAGE_INVENTORY_HEALTH/1"
    try:
        driver.get(url)

        if not login_if_needed_seller_central(driver, wait, profile_id, brand):
            raise Exception("Đăng nhập Seller Central thất bại.")

        max_retries = 2
        for attempt in range(max_retries):
            try:
                header = wait.until(EC.presence_of_element_located((By.ID, "content-float-and-padding")))
                if "FBA Inventory" in header.text:
                    logging.info(f"[{brand}] [{task_name}] Đã xác minh trang 'FBA Inventory' thành công.")
                    break
                else:
                    raise Exception("Header không chứa 'FBA Inventory'.")
            except Exception as e:
                logging.warning(
                    f"[{brand}] [{task_name}] Kiểm tra trang thất bại (Lần {attempt + 1}/{max_retries}). Lỗi: {e}. Thử tải lại URL...")
                driver.get(url)
                time.sleep(5)
                if attempt + 1 == max_retries:
                    raise Exception("Không vào được trang FBA Inventory sau nhiều lần thử.")

        request_button = wait.until(EC.element_to_be_clickable(
            (By.CSS_SELECTOR, "#report-page-kat-box > kat-button.download-report-page-kat-button-secondary")))
        request_button.click()
        logging.info(f"[{brand}] [{task_name}] Đã click 'Request .txt Download'.")
        time.sleep(random.uniform(2, 3))

        logging.info(f"[{brand}] [{task_name}] Đang chờ nút 'Download' xuất hiện...")
        download_cell_locator_str = "#report-page-margin-style > kat-table > kat-table-body > kat-table-row:nth-child(1) > kat-table-cell:nth-child(5)"
        download_button_locator = (By.CSS_SELECTOR, f"{download_cell_locator_str} > kat-button[label='Download']")
        download_button = WebDriverWait(driver, 300).until(
            EC.presence_of_element_located(download_button_locator)
        )

        wait_time = random.uniform(10, 15)
        logging.info(f"[{brand}] [{task_name}] Đã tìm thấy nút Download. Chờ {wait_time:.2f} giây trước khi bấm tải...")
        time.sleep(wait_time)

        wait.until(EC.element_to_be_clickable(download_button)).click()
        logging.info(f"[{brand}] [{task_name}] Đã click nút 'Download'.")
        return True
    except Exception as e:
        logging.error(f"[{brand}] Lỗi khi yêu cầu/tải File 06: {e}", exc_info=True)
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"💥 _Lỗi khi yêu cầu/tải File 06_\n" \
              f"Lỗi: `{escape_markdown(str(e).splitlines()[0])}`"
        send_telegram_message(msg, script_name_override="BO-amz-06-Inventory")
        return False


def rename_and_move_file06_inventory_report(brand, target_date, destination_path):
    logging.info(f"[{brand}] Bắt đầu: Đổi tên và Di chuyển File 06 (Inventory).")
    # --- CẬP NHẬT ĐƯỜNG DẪN TẢI VỀ THEO BRAND ---
    download_dir = os.path.join(DESTINATION_ROOT_DIR, brand)

    try:
        time.sleep(random.uniform(7, 10))
        latest_file = None
        for _ in range(12):  # Chờ tối đa 60 giây
            today_start_timestamp = datetime.now(VN_TZ).replace(hour=0, minute=0, second=0,
                                                                microsecond=0).timestamp()
            files = [os.path.join(download_dir, f) for f in os.listdir(download_dir) if
                     f.lower().endswith('.txt') and os.path.getmtime(
                         os.path.join(download_dir, f)) >= today_start_timestamp]
            if files:
                non_order_files = [f for f in files if "Order" not in os.path.basename(f)]
                if non_order_files:
                    latest_file = max(non_order_files, key=os.path.getctime)
                    logging.info(f"[{brand}] [File 06] Đã tìm thấy file .txt (Inventory): {latest_file}")
                    break
            logging.warning(f"[{brand}] [File 06] Chưa tìm thấy file Inventory. Chờ 5 giây và thử lại...")
            time.sleep(5)

        if not latest_file:
            raise FileNotFoundError("Không tìm thấy file Inventory sau khi kiểm tra.")

        if os.path.exists(destination_path): os.remove(destination_path)

        # Đảm bảo thư mục đích tồn tại
        os.makedirs(os.path.dirname(destination_path), exist_ok=True)

        shutil.move(latest_file, destination_path)
        logging.info(f"[{brand}] [File 06] Đã di chuyển file thành công tới: {destination_path}")

        telegram_path = destination_path.replace('\\', '\\\\')
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"📄 _File 06 \\(Inventory\\) đã được tải và chuyển thành công_\\.\n" \
              f"Đường dẫn: `{telegram_path}`"
        send_telegram_message(msg, script_name_override="BO-amz-06-Inventory")
        return True
    except Exception as e:
        logging.error(f"[{brand}] Lỗi khi đổi tên/di chuyển File 06: {e}")
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"💥 _Lỗi khi đổi tên/di chuyển File 06_\n" \
              f"Lỗi: `{escape_markdown(str(e).splitlines()[0])}`"
        send_telegram_message(msg, script_name_override="BO-amz-06-Inventory")
        return False


# ==================== FILE 07: SHIPMENT REPORT (SHIPPING QUEUE) ====================
def request_and_download_file07_shipment_report(driver, wait, profile_id, brand, target_date):
    logging.info(f"[{brand}] Bắt đầu: Yêu cầu và Tải File 07 (Shipment).")
    task_name = "File 07"
    # Amazon ~2026-06 chuyen Shipping Queue sang giao dien moi
    # (/amazonsell/shipments) co DOM hoan toan khac — khong con id
    # `content-float-and-padding`. Query string `sc_shipments_redirect=0`
    # opt-out redirect, giu giao dien cu de DOM script da viet van match.
    url = "https://sellercentral.amazon.com/gp/ssof/shipping-queue.html?sc_shipments_redirect=0#fbashipment"

    try:
        driver.get(url)

        if not login_if_needed_seller_central(driver, wait, profile_id, brand):
            raise Exception("Đăng nhập Seller Central thất bại.")

        # 1. Check load trang
        try:
            wait.until(EC.presence_of_element_located((By.ID, "content-float-and-padding")))
            logging.info(f"[{brand}] [{task_name}] Đã truy cập trang Shipping Queue thành công.")
        except TimeoutException:
            driver.refresh()
            time.sleep(5)
            wait.until(EC.presence_of_element_located((By.ID, "content-float-and-padding")))

        time.sleep(random.uniform(3, 5))

        # 2. Chọn '100 results per page' BẰNG JAVASCRIPT (FIX LỖI SHADOW DOM)
        try:
            logging.info(f"[{brand}] [{task_name}] Đang thực hiện click dropdown chọn 100 bằng JS...")

            # Bước A: Click vào Header của Dropdown để mở menu
            # Script này tìm shadowRoot của kat-dropdown và click vào header
            js_click_dropdown = """
            try {
                var dropdown = document.querySelector("#pagination-dropdown > kat-dropdown");
                if (dropdown && dropdown.shadowRoot) {
                    var header = dropdown.shadowRoot.querySelector(".select-header");
                    if (header) {
                        header.click();
                        return true;
                    }
                }
                return false;
            } catch(e) { return false; }
            """
            driver.execute_script(js_click_dropdown)
            time.sleep(1.5)  # Chờ menu xổ xuống

            # Bước B: Click vào option 100
            # Script này duyệt qua các option trong shadowRoot, tìm cái nào chứa số "100" thì click
            js_select_100 = """
            try {
                var dropdown = document.querySelector("#pagination-dropdown > kat-dropdown");
                if (dropdown && dropdown.shadowRoot) {
                    var options = dropdown.shadowRoot.querySelectorAll("kat-option");
                    for (var i = 0; i < options.length; i++) {
                        // Kiểm tra text bên trong option hoặc thuộc tính value/label
                        if (options[i].textContent.includes("100") || options[i].getAttribute("value") == "100") {
                            options[i].click();
                            return true;
                        }
                        // Fallback: Kiểm tra div con bên trong (như cấu trúc bạn gửi)
                        var innerDiv = options[i].querySelector(".standard-option-name");
                        if (innerDiv && innerDiv.textContent.includes("100")) {
                            options[i].click();
                            return true;
                        }
                    }
                }
                return false;
            } catch(e) { return e.message; }
            """
            result = driver.execute_script(js_select_100)
            logging.info(f"[{brand}] [{task_name}] Kết quả JS chọn 100: {result}")

            # Chờ trang reload sau khi chọn 100
            time.sleep(random.uniform(4, 6))

        except Exception as e:
            logging.warning(f"[{brand}] [{task_name}] Lỗi bước chọn 100 (JS): {e}")

        # 3. Check Sort Arrow (Giữ nguyên logic cũ của bạn)
        try:
            header_container_xpath = "//*[@id='toggle-header-container']"
            icon_xpath = "//*[@id='toggle-header-icon']/kat-icon"
            check_count = 0
            while True:
                check_count += 1
                if check_count > 5: break  # Tránh lặp vô tận nếu kẹt
                try:
                    icon_element = driver.find_element(By.XPATH, icon_xpath)
                    icon_name = icon_element.get_attribute("name")
                    if icon_name == "arrow-down":
                        logging.info(f"[{brand}] [{task_name}] Sort Order OK (arrow-down).")
                        break
                    else:
                        logging.info(f"[{brand}] [{task_name}] Đổi sort sang arrow-down...")
                        driver.find_element(By.XPATH, header_container_xpath).click()
                        time.sleep(3)
                except Exception:
                    time.sleep(2)
        except Exception as e:
            logging.error(f"[{brand}] [{task_name}] Lỗi check Arrow: {e}")

        # 4. Click Export
        export_btn = wait.until(EC.element_to_be_clickable((By.XPATH, "//*[@id='export-link-container']/a/kat-link")))
        time.sleep(1)
        export_btn.click()
        logging.info(f"[{brand}] [{task_name}] Đã click Export table data.")
        return True

    except Exception as e:
        logging.error(f"[{brand}] Lỗi khi yêu cầu/tải File 07: {e}", exc_info=True)
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"💥 _Lỗi khi yêu cầu/tải File 07_\n" \
              f"Lỗi: `{escape_markdown(str(e).splitlines()[0])}`"
        send_telegram_message(msg, script_name_override="BO-amz-07-Shipment")
        return False


def rename_and_move_file07_shipment_report(brand, target_date, destination_path):
    logging.info(f"[{brand}] Bắt đầu: Đổi tên và Di chuyển File 07 (Shipment).")
    # --- CẬP NHẬT ĐƯỜNG DẪN TẢI VỀ THEO BRAND ---
    download_dir = os.path.join(DESTINATION_ROOT_DIR, brand)

    try:
        time.sleep(random.uniform(5, 10))
        latest_file = None

        # Tìm file .csv mới nhất (File Shipping Queue tải về là .csv)
        for _ in range(12):  # Chờ tối đa 60 giây
            today_start_timestamp = datetime.now(VN_TZ).replace(hour=0, minute=0, second=0, microsecond=0).timestamp()

            # Lọc các file .csv được tạo từ đầu ngày hôm nay
            files = [
                os.path.join(download_dir, f)
                for f in os.listdir(download_dir)
                if
                f.lower().endswith('.csv') and os.path.getmtime(os.path.join(download_dir, f)) >= today_start_timestamp
            ]

            if files:
                # Lấy file mới nhất
                latest_file = max(files, key=os.path.getctime)
                logging.info(f"[{brand}] [File 07] Đã tìm thấy file .csv (Shipment): {latest_file}")
                break

            logging.warning(f"[{brand}] [File 07] Chưa tìm thấy file Shipment. Chờ 5 giây và thử lại...")
            time.sleep(5)

        if not latest_file:
            raise FileNotFoundError("Không tìm thấy file Shipment (.csv) sau khi tải.")

        # Xóa file đích nếu đã tồn tại
        if os.path.exists(destination_path):
            os.remove(destination_path)

        # Đảm bảo thư mục đích tồn tại
        os.makedirs(os.path.dirname(destination_path), exist_ok=True)

        # Di chuyển và đổi tên
        shutil.move(latest_file, destination_path)
        logging.info(f"[{brand}] [File 07] Đã di chuyển file thành công tới: {destination_path}")

        telegram_path = destination_path.replace('\\', '\\\\')
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"📄 _File 07 \\(Shipment\\) đã được tải và chuyển thành công_\\.\n" \
              f"Đường dẫn: `{telegram_path}`"
        send_telegram_message(msg, script_name_override="BO-amz-07-Shipment")
        return True

    except Exception as e:
        logging.error(f"[{brand}] Lỗi khi đổi tên/di chuyển File 07: {e}")
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"💥 _Lỗi khi đổi tên/di chuyển File 07_\n" \
              f"Lỗi: `{escape_markdown(str(e).splitlines()[0])}`"
        send_telegram_message(msg, script_name_override="BO-amz-07-Shipment")
        return False


# --- HÀM MỚI ĐỂ TẠO FILE TRỐNG ---
def create_empty_report_file(brand, destination_path, file_type_str, date_from_str, date_to_str):
    """Tạo một file báo cáo trống khi không có dữ liệu."""
    logging.warning(f"[{brand}] [{file_type_str}] Không có dữ liệu. Tạo file placeholder.")
    try:
        # Xác định đúng tên script override cho telegram
        script_override = ""
        if "Return" in file_type_str:
            script_override = "BO-amz-03-ReturnReport"
        elif "Service Fee" in file_type_str:
            script_override = "BO-amz-04-ServiceFee"

        content = f"Không có data {file_type_str} trong khoảng thời gian từ {date_from_str} đến {date_to_str}."

        # Đảm bảo thư mục tồn tại
        os.makedirs(os.path.dirname(destination_path), exist_ok=True)

        # Xóa file cũ nếu có
        if os.path.exists(destination_path):
            os.remove(destination_path)

        with open(destination_path, 'w', encoding='utf-8') as f:
            f.write(content)

        logging.info(f"[{brand}] [{file_type_str}] Đã tạo file placeholder thành công tại: {destination_path}")

        telegram_path = destination_path.replace('\\', '\\\\')
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"⚠️ _Không có dữ liệu {file_type_str}, đã tạo file trống thay thế_\\.\n" \
              f"Đường dẫn: `{telegram_path}`"
        send_telegram_message(msg, script_name_override=script_override)
        return True
    except Exception as e:
        logging.error(f"[{brand}] [{file_type_str}] Lỗi khi tạo file placeholder: {e}", exc_info=True)
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"💥 _Lỗi khi tạo file {file_type_str} trống_\n" \
              f"Lỗi: `{escape_markdown(str(e).splitlines()[0])}`"
        send_telegram_message(msg, script_name_override=script_override)
        return False


# --- CÁC HÀM GỘP LOGIC ---

def get_target_filepaths(brand, target_date):
    date_str = target_date.strftime('%b_%d_%Y')
    return {
        "01": os.path.join(DESTINATION_ROOT_DIR, brand, "1-Ads", f"{brand}_Portfolios_{date_str}.csv"),
        "02": os.path.join(DESTINATION_ROOT_DIR, brand, "2-Order", f"{brand}_Order_{date_str}.txt"),
        "03": os.path.join(DESTINATION_ROOT_DIR, brand, "3-Return", f"{brand}_Return_{date_str}.csv"),
        "04": os.path.join(DESTINATION_ROOT_DIR, brand, "4-Service Fees", f"{brand}_ServiceFee_{date_str}.csv"),
        "05": os.path.join(DESTINATION_ROOT_DIR, brand, "5-Campaign Ads", f"{brand}_Campaigns_{date_str}.csv"),
        "06": os.path.join(DESTINATION_ROOT_DIR, brand, "6-Inventory", f"{brand}_Inventory_{date_str}.txt"),
        "07": os.path.join(DESTINATION_ROOT_DIR, brand, "7-Shipment", f"{brand}_Shipment_{date_str}.csv"), # Thêm dòng này
    }


def process_file_01(driver, wait, profile_id, brand, target_date):
    dest_path = get_target_filepaths(brand, target_date)["01"]
    if request_and_download_file01_portfolio_report(driver, wait, profile_id, brand, target_date):
        return rename_and_move_file01_portfolio_report(brand, target_date, dest_path)
    return False


def process_file_02(driver, wait, profile_id, brand, target_date):
    dest_path = get_target_filepaths(brand, target_date)["02"]
    if request_and_download_file02_all_orders_report(driver, wait, profile_id, brand, target_date):
        return rename_and_move_file02_all_orders_report(brand, target_date, dest_path)
    return False


def process_file_03(driver, wait, profile_id, brand, target_date):
    dest_path = get_target_filepaths(brand, target_date)["03"]
    status, date_from, date_to = request_and_download_file03_return_report(driver, wait, profile_id, brand, target_date)

    if status == "DOWNLOAD_INITIATED":
        return rename_and_move_file03_return_report(brand, target_date, dest_path)
    elif status == "NO_DATA":
        return create_empty_report_file(brand, dest_path, "Return Report", date_from, date_to)
    else:  # status is False
        return False


def process_file_04(driver, wait, profile_id, brand, target_date):
    dest_path = get_target_filepaths(brand, target_date)["04"]
    status, date_from, date_to = request_and_download_file04_service_fee_report(driver, wait, profile_id, brand,
                                                                                target_date)

    if status == "DOWNLOAD_INITIATED":
        return rename_and_move_file04_service_fee_report(brand, target_date, dest_path)
    elif status == "NO_DATA":
        return create_empty_report_file(brand, dest_path, "Service Fee", date_from, date_to)
    else:  # status is False
        return False


def process_file_05(driver, wait, profile_id, brand, target_date):
    dest_path = get_target_filepaths(brand, target_date)["05"]
    success, file_count = request_and_download_file05_campaigns_report(driver, wait, profile_id, brand, target_date)
    if success:
        return rename_and_move_file05_campaigns_report(brand, target_date, file_count, dest_path)
    return False


def process_file_06(driver, wait, profile_id, brand, target_date):
    dest_path = get_target_filepaths(brand, target_date)["06"]
    if request_and_download_file06_inventory_report(driver, wait, profile_id, brand, target_date):
        return rename_and_move_file06_inventory_report(brand, target_date, dest_path)
    return False


def process_file_07(driver, wait, profile_id, brand, target_date):
    dest_path = get_target_filepaths(brand, target_date)["07"]
    if request_and_download_file07_shipment_report(driver, wait, profile_id, brand, target_date):
        return rename_and_move_file07_shipment_report(brand, target_date, dest_path)
    return False


TASK_MAPPING = {
    "01": (process_file_01, ENABLE_FILE_01, "Portfolios Report"),
    "02": (process_file_02, ENABLE_FILE_02, "All Orders Report"),
    "03": (process_file_03, ENABLE_FILE_03, "Return Report"),
    "04": (process_file_04, ENABLE_FILE_04, "Service Fees Report"),
    "05": (process_file_05, ENABLE_FILE_05, "Campaigns Report"),
    "06": (process_file_06, ENABLE_FILE_06, "FBA Inventory Report"),
    "07": (process_file_07, ENABLE_FILE_07, "Shipment Report"),
}


# --- LUỒNG XỬ LÝ CHÍNH (ĐÃ NÂNG CẤP: FIX GSPREAD + CHỜ THEO THỨ TỰ) ---
def process_tasks_for_profile(api_url, profile_config, target_date, tasks_to_run=None, explicit_delay=0):
    """
    Xử lý một danh sách các tác vụ cụ thể cho một profile.
    """
    # [FIX] Reset cờ lỗi đăng nhập cho profile này (worker Pool có thể dùng lại process)
    LOGIN_BROKEN["flag"] = False
    LOGIN_BROKEN["reason"] = ""

    # --- [FIX] TỰ KẾT NỐI LẠI GSPREAD ---
    global gc
    if gc is None:
        try:
            scope = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]
            creds = ServiceAccountCredentials.from_json_keyfile_name(GOOGLE_API_KEYFILE, scope)
            gc = gspread.authorize(creds)
        except Exception as e:
            logging.error(f"[{profile_config['brand']}] Lỗi khởi tạo Gspread: {e}")
    # ------------------------------------

    profile_id = profile_config['id']
    brand = profile_config['brand']

    # --- [NEW] CHỜ THEO THỨ TỰ (TRÁNH TRÙNG LẶP TUYỆT ĐỐI) ---
    if USE_MULTIPROCESSING and tasks_to_run is None:
        # Nếu có tham số delay truyền vào thì ưu tiên dùng
        if explicit_delay > 0:
            logging.info(f"[{brand}] ⏳ Đang chờ xếp hàng: {explicit_delay}s để tránh login đồng loạt...")
            time.sleep(explicit_delay)
        else:
            # Fallback: Nếu không có delay truyền vào thì mới random + seed lại theo PID
            random.seed(os.getpid() + time.time())
            sleep_time = random.uniform(5, 40)
            logging.info(f"[{brand}] ⏳ Đang chờ ngẫu nhiên: {sleep_time:.2f}s...")
            time.sleep(sleep_time)
    # ----------------------------------------------------------

    logging.info(f"--- Bắt đầu xử lý cho Profile ID: {profile_id}, Brand: {brand} ---")
    if tasks_to_run is None:
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"🚀 _Bắt đầu xử lý store_"
        send_telegram_message(msg)
    else:
        task_names = [TASK_MAPPING[t][2] for t in tasks_to_run]
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"🔄 _Bắt đầu tải lại các file thiếu: {escape_markdown(', '.join(task_names))}_"
        send_telegram_message(msg)

    profile_start_time = time.time()
    driver = None
    try:
        debug_port, driver_path = open_profile(api_url, profile_id, brand)
        if not debug_port or not driver_path:
            raise Exception("Không thể mở profile từ AdsPower (Lỗi không xác định).")

        driver = setup_webdriver(debug_port, driver_path)
        wait = WebDriverWait(driver, 45)

        # --- CẤU HÌNH DOWNLOAD PATH ---
        download_path = os.path.join(DESTINATION_ROOT_DIR, brand)
        if not os.path.exists(download_path):
            os.makedirs(download_path, exist_ok=True)

        params = {
            "behavior": "allow",
            "downloadPath": download_path
        }
        driver.execute_cdp_cmd("Page.setDownloadBehavior", params)
        logging.info(f"[{brand}] Đã thiết lập thư mục tải xuống riêng: {download_path}")
        # ------------------------------

        if tasks_to_run is None:
            tasks_to_run = [task_id for task_id, (_, is_enabled, _) in TASK_MAPPING.items() if is_enabled]

        skipped_tasks = []  # [FIX] các tác vụ bị bỏ qua do login hỏng

        for task_id in tasks_to_run:
            task_func, _, task_name = TASK_MAPPING[task_id]
            task_retry_count = 0
            while task_retry_count < MAX_TASK_RETRIES:
                task_retry_count += 1
                logging.info(f"[{brand}] === Bắt đầu Tác vụ: {task_name} "
                             f"(Lần thử {task_retry_count}/{MAX_TASK_RETRIES}) ===")
                success = False
                try:
                    if task_id in ["01", "02", "03", "04", "05", "06", "07"]:
                        success = task_func(driver, wait, profile_id, brand, target_date)

                        # --- [NEW] TẢI BỔ SUNG NGÀY CŨ CHO FILE 02 (MUST DOWNLOAD MODE) ---
                        if success and task_id == "02":
                            past_date = target_date - timedelta(days=3)
                            historical_retry_count = 0
                            while historical_retry_count < MAX_HISTORICAL_RETRIES:
                                historical_retry_count += 1
                                logging.info(
                                    f"[{brand}] [File 02 Historical] Bắt đầu tải file ngày {past_date.strftime('%Y-%m-%d')} (Lần {historical_retry_count}/{MAX_HISTORICAL_RETRIES})...")
                                try:
                                    hist_success = task_func(driver, wait, profile_id, brand, past_date)
                                    if hist_success:
                                        logging.info(f"[{brand}] [File 02 Historical] Tải thành công.")
                                        break  # Thoát vòng lặp Historical để đi tiếp
                                    else:
                                        raise Exception("Hàm tải trả về False (Lỗi trong quá trình tải).")
                                except Exception as e:
                                    if historical_retry_count >= MAX_HISTORICAL_RETRIES:
                                        logging.error(
                                            f"[{brand}] [File 02 Historical] Thất bại sau {MAX_HISTORICAL_RETRIES} lần. BỎ QUA. Lỗi: {e}")
                                        send_telegram_message(
                                            f"\\- *{escape_markdown(brand)}*\n"
                                            f"⛔ _Bỏ qua File 02 Lịch sử sau {MAX_HISTORICAL_RETRIES} lần thử_",
                                            script_name_override="BO-amz-02-AllOrders")
                                        break
                                    logging.warning(
                                        f"[{brand}] [File 02 Historical] Lỗi tải file lịch sử: {e}. Retry sau 20s...")
                                    msg = f"\\- *{escape_markdown(brand)}*\n" \
                                          f"⚠️ _Lỗi tải File 02 Lịch sử, đang thử lại \\(Lần {historical_retry_count}\\)_"
                                    send_telegram_message(msg, script_name_override="BO-amz-02-AllOrders")
                                    try:
                                        driver.current_url  # Kiểm tra session còn sống
                                        driver.refresh()
                                        time.sleep(10)
                                    except Exception:
                                        driver, wait = reinitialize_driver(driver, api_url, profile_id, brand, download_path)
                                    time.sleep(20)
                        # ------------------------------------------------------------------

                    else:
                        success = task_func(driver, wait, profile_id, brand)
                except Exception as e:
                    logging.error(f"[{brand}] Lỗi không mong muốn khi chạy tác vụ {task_name}: {e}", exc_info=True)
                    success = False

                if success:
                    logging.info(f"[{brand}] === Hoàn thành thành công Tác vụ: {task_name} ===")
                    break

                # [FIX] Login hỏng (sai pass / captcha / account bị challenge) -> CẢ 6 tác vụ
                # đều sẽ fail cùng lý do. Bỏ qua NGAY toàn bộ profile thay vì cày
                # 5 lượt x 6 tác vụ (vốn mất 5-6 tiếng và spam Telegram).
                if LOGIN_BROKEN["flag"]:
                    logging.error(f"[{brand}] ⛔ LỖI ĐĂNG NHẬP không thể tự khắc phục "
                                  f"({LOGIN_BROKEN['reason']}). BỎ QUA TOÀN BỘ PROFILE.")
                    break

                # [FIX] Hết lượt thử -> bỏ qua tác vụ này để các tác vụ sau vẫn được chạy,
                # thay vì lặp vô hạn và chặn toàn bộ profile như trước.
                if task_retry_count >= MAX_TASK_RETRIES:
                    logging.error(f"[{brand}] Tác vụ {task_name} THẤT BẠI sau {MAX_TASK_RETRIES} lần thử. "
                                  f"BỎ QUA để chạy tác vụ tiếp theo.")
                    msg = f"\\- *{escape_markdown(brand)}*\n" \
                          f"⛔ _Bỏ qua *{escape_markdown(task_name)}* sau {MAX_TASK_RETRIES} lần thử thất bại_\n" \
                          f"_Cần kiểm tra thủ công profile này\\._"
                    send_telegram_message(msg)
                    break

                logging.warning(f"[{brand}] Tác vụ {task_name} thất bại "
                                f"(lần {task_retry_count}/{MAX_TASK_RETRIES}). Sẽ thử lại sau 30 giây...")
                try:
                    driver.current_url  # Kiểm tra session còn sống
                    driver.refresh()
                    time.sleep(10)
                except Exception:
                    driver, wait = reinitialize_driver(driver, api_url, profile_id, brand, download_path)
                time.sleep(20)

            # [FIX] Login hỏng -> dừng luôn các tác vụ còn lại của profile này
            if LOGIN_BROKEN["flag"]:
                remaining = tasks_to_run[tasks_to_run.index(task_id):]
                skipped_tasks = [TASK_MAPPING[t][2] for t in remaining]
                logging.error(f"[{brand}] Bỏ qua {len(skipped_tasks)} tác vụ còn lại: {skipped_tasks}")
                break

            time.sleep(random.uniform(3, 5))

        if skipped_tasks:
            msg = f"\\- *{escape_markdown(brand)}*\n" \
                  f"⛔ *BỎ QUA PROFILE* \\- lỗi đăng nhập\n" \
                  f"Lý do: `{escape_markdown(LOGIN_BROKEN['reason'])}`\n" \
                  f"Chưa tải \\({len(skipped_tasks)}\\): `{escape_markdown(', '.join(skipped_tasks))}`\n" \
                  f"_Cần cập nhật lại tài khoản rồi chạy lại profile này\\._"
            send_telegram_message(msg)

    except Exception as e:
        logging.error(f"[{brand}] Lỗi nghiêm trọng: {e}", exc_info=True)
        msg = f"\\- *{escape_markdown(brand)}*\n" \
              f"💥 _Lỗi nghiêm trọng khi xử lý_\n" \
              f"Lỗi: `{escape_markdown(str(e).splitlines()[0])}`"
        send_telegram_message(msg)
    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass
        stop_profile(api_url, profile_id, brand)
        time.sleep(2)
        profile_end_time = time.time()
        logging.info(
            f"--- Hoàn thành lượt xử lý cho {brand} trong {int((profile_end_time - profile_start_time) / 60)} phút ---")


def check_missing_files(profile_configs, target_date):
    """Kiểm tra tất cả các file cần thiết và trả về danh sách các tác vụ bị thiếu."""
    logging.info("--- Bắt đầu kiểm tra các file còn thiếu ---")
    missing_tasks = []
    for profile in profile_configs:
        brand = profile['brand']
        target_paths = get_target_filepaths(brand, target_date)
        for task_id, (_, is_enabled, task_name) in TASK_MAPPING.items():
            if is_enabled:
                if not os.path.exists(target_paths[task_id]):
                    missing_tasks.append({'profile': profile, 'task_id': task_id, 'task_name': task_name})
                    logging.warning(f"[{brand}] File THIẾU: {task_name} (ID: {task_id})")
    if not missing_tasks:
        logging.info("--- Không tìm thấy file nào bị thiếu. ---")
    return missing_tasks


if __name__ == "__main__":
    start_msg = f"🚀 _Bắt đầu chạy script tổng hợp_"
    send_telegram_message(start_msg)
    logging.info("=============================================")
    logging.info(f"BẮT ĐẦU CHẠY SCRIPT: {SCRIPT_NAME.upper()}")
    logging.info(f"Chế độ Multiprocessing: {'BẬT' if USE_MULTIPROCESSING else 'TẮT (An toàn)'}")
    logging.info("=============================================")
    overall_start_time = time.time()

    try:
        locale.setlocale(locale.LC_TIME, 'en_US.UTF-8')
    except locale.Error:
        locale.setlocale(locale.LC_TIME, 'English_United States.1252')

    api_url = read_local_api_file(LOCAL_API_PATH) or API_URL_DEFAULT


    # --- HÀM KIỂM TRA PROCESS (NỘI BỘ) ---
    def is_process_running(process_name):
        try:
            call = 'tasklist /FI "IMAGENAME eq %s" /FO CSV /NH' % process_name
            output = subprocess.check_output(call, shell=True).decode('utf-8', errors='ignore')
            return process_name.lower() in output.lower()
        except Exception:
            return False


    # --- LOGIC KHỞI ĐỘNG "LÌ LỢM" & AN TOÀN ---
    logging.info("Kiểm tra trạng thái AdsPower...")
    retry_count = 0
    process_exe_name = "AdsPower Global.exe"

    while True:
        # 1. Ưu tiên kiểm tra API trước
        if check_api_status(api_url):
            logging.info("✅ API AdsPower ĐÃ KẾT NỐI THÀNH CÔNG! Sẵn sàng làm việc.")
            break

        # 2. Nếu API chưa thông, phân tích nguyên nhân
        retry_count += 1
        logging.warning(f"⚠️ [Lần {retry_count}] API chưa phản hồi. Đang kiểm tra Process...")

        if is_process_running(process_exe_name):
            # CASE A: App đang chạy -> Chờ
            logging.info(
                f"⏳ Phát hiện Process '{process_exe_name}' ĐANG CHẠY. Hệ thống đang chờ API khởi động... (Không mở lại)")
            time.sleep(15)
        else:
            # CASE B: App tắt -> Bật
            logging.info(f"🔌 Process không tồn tại. Đang gửi lệnh KHỞI ĐỘNG AdsPower...")
            try:
                subprocess.Popen(ADDSPOWER_PATH)
                logging.info("⏳ Đã kích hoạt file .exe, chờ 45s cho quá trình khởi động ban đầu...")
                time.sleep(45)
            except Exception as e:
                logging.error(f"❌ Lỗi khi gọi lệnh mở file: {e}")
                time.sleep(10)

        if retry_count % 20 == 0:
            send_telegram_message(
                f"⚠️ *{escape_markdown(SCRIPT_NAME)}* \\- Script đang chờ AdsPower quá lâu (Lần {retry_count}).")

    profile_configs = get_sheet_data(GOOGLE_API_KEYFILE)
    if not profile_configs:
        logging.critical("Không thể lấy dữ liệu từ Google Sheet. Dừng script.")
        exit()

    now_vn = datetime.now(VN_TZ)
    target_date = now_vn.date() - timedelta(days=(2 if now_vn.hour < 15 else 1))

    # --- GIAI ĐOẠN 1: TẢI FILE LẦN ĐẦU ---
    logging.info(f"\n{'=' * 20} GIAI ĐOẠN 1: TẢI FILE LẦN ĐẦU CHO TẤT CẢ STORES {'=' * 20}")
    if USE_MULTIPROCESSING:
        # Chạy song song với Pool (6 processes)
        pool_args = []
        for index, profile in enumerate(profile_configs):
            # Tính thời gian chờ: Store 1 chờ 0s, Store 2 chờ 40s, Store 3 chờ 80s...
            # Công thức: (Số thứ tự * 40 giây) + (một chút lẻ 1-5s cho tự nhiên)
            delay = (index * 2) + random.uniform(10, 25)

            # Truyền thêm 2 tham số cuối: tasks_to_run=None, explicit_delay=delay
            pool_args.append((api_url, profile, target_date, None, delay))

        with Pool(processes=6) as pool:
            pool.starmap(process_tasks_for_profile, pool_args)
    else:
        for profile in profile_configs:
            process_tasks_for_profile(api_url, profile, target_date)

    # --- GIAI ĐOẠN 2: KIỂM TRA VÀ TẢI LẠI FILE THIẾU ---
    logging.info(f"\n{'=' * 20} GIAI ĐOẠN 2: KIỂM TRA VÀ TẢI LẠI FILE THIẾU {'=' * 20}")
    retry_loop_count = 0
    while retry_loop_count < MAX_MISSING_FILE_LOOPS:
        retry_loop_count += 1
        logging.info(f"--- Vòng lặp kiểm tra và tải lại lần thứ {retry_loop_count}/{MAX_MISSING_FILE_LOOPS} ---")
        missing_tasks = check_missing_files(profile_configs, target_date)

        if not missing_tasks:
            logging.info("🎉 Tất cả các file đã được tải thành công. Hoàn tất.")
            break

        # [FIX] Trước đây vòng này là `while True` -> nếu 1 profile không bao giờ tải được
        # thì script treo vĩnh viễn. Nay hết lượt thì báo cáo và dừng.
        if retry_loop_count >= MAX_MISSING_FILE_LOOPS:
            still_missing = [f"{t['profile']['brand']}: {t['task_name']}" for t in missing_tasks]
            logging.error(f"Hết {MAX_MISSING_FILE_LOOPS} vòng tải lại. Vẫn còn thiếu: {still_missing}")
            send_telegram_message(
                f"⛔ *Dừng sau {MAX_MISSING_FILE_LOOPS} vòng tải lại\\. Vẫn còn thiếu:*\n" +
                "\n".join(f"\\- `{escape_markdown(s)}`" for s in still_missing))
            break

        tasks_by_profile = {}
        for task in missing_tasks:
            pid = task['profile']['id']
            if pid not in tasks_by_profile:
                tasks_by_profile[pid] = {'profile': task['profile'], 'tasks': []}
            tasks_by_profile[pid]['tasks'].append(task['task_id'])

        msg_parts = ["*🔍 Phát hiện các file còn thiếu, bắt đầu tải lại:*"]
        for pid, job in tasks_by_profile.items():
            brand_name = job['profile']['brand']
            task_names = [TASK_MAPPING[t_id][2] for t_id in job['tasks']]
            msg_parts.append(f"\\- *{escape_markdown(brand_name)}*: `{escape_markdown(', '.join(task_names))}`")
        send_telegram_message("\n".join(msg_parts))

        # Xử lý retry (vẫn giữ tuần tự cho an toàn khi fix lỗi, hoặc có thể sửa thành song song nếu muốn)
        for profile_id, job in tasks_by_profile.items():
            process_tasks_for_profile(api_url, job['profile'], target_date, tasks_to_run=job['tasks'])

        logging.info("--- Hoàn thành vòng lặp tải lại. Chờ 30 giây trước khi kiểm tra lại. ---")
        time.sleep(30)

    # --- GIAI ĐOẠN 3: KẾT THÚC ---
    total_time = time.time() - overall_start_time
    minutes, seconds = divmod(total_time, 60)
    time_str = f"{int(minutes)} phút {int(seconds)} giây"
    logging.info(f"HOÀN THÀNH TẤT CẢ. TỔNG THỜI GIAN: {time_str}")
    end_msg = f"✅ _Hoàn thành tất cả stores_\n" \
              f"Tổng thời gian: `{escape_markdown(time_str)}`"
    send_telegram_message(end_msg)

    run_next_msg = f"✅ *{escape_markdown(SCRIPT_NAME)}* \\- _Hoàn thành tất cả stores_\n" \
                   f"Tổng thời gian: `{escape_markdown(time_str)}`\n\n" \
                   f"⏳ _Đang chuẩn bị chạy {escape_markdown('Ketoanamz-02-6sheet')} sau khi chờ...\\.\\.\\.\\._"
    send_telegram_message(run_next_msg)

    wait_seconds = 60
    logging.info(f"Bắt đầu chờ {wait_seconds} giây trước khi chạy script Ketoanamz-02-6sheet")
    time.sleep(wait_seconds)

    next_script_path = "E:\\PythonProject1\\Ketoanamz-02-6sheet.py"
    logging.info(f"Bắt đầu chạy script: {next_script_path}")
    try:
        subprocess.run([sys.executable, next_script_path], check=True)
        logging.info(f"Đã chạy xong script {next_script_path}")
    except Exception as e:
        logging.error(f"Lỗi khi chạy script {next_script_path}: {e}")

