import os
import shutil
import sys
import logging
import time
import requests
from urllib.parse import quote
from datetime import datetime
import pytz

# --- CẤU HÌNH ---
# Tên script để định danh trong log và Telegram
SCRIPT_NAME = "Ketoanamz-03-move"

# Đường dẫn thư mục nguồn và đích
SOURCE_ROOT = r"E:\Kế toán"
DEST_ROOT = r"\\Nceglobal\design tong hop\Kế toán"

# Cấu hình Logging (THEO ĐÚNG CẤU TRÚC BẠN GỬI)
LOG_FILE_PATH = r"E:\PythonProject1"
VN_TZ = pytz.timezone('Asia/Ho_Chi_Minh')
current_date_str = datetime.now(VN_TZ).strftime("%Y%m%d")
log_file = os.path.join(LOG_FILE_PATH, f"{SCRIPT_NAME}-{current_date_str}.txt")

# Đảm bảo thư mục log tồn tại
os.makedirs(LOG_FILE_PATH, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
    handlers=[
        logging.FileHandler(log_file, 'a', 'utf-8'),
        logging.StreamHandler()
    ]
)


# Cấu hình Telegram (LẤY TỪ FILE CỦA BẠN)
BOT_TOKEN = "7319056820:AAGnHjcTzqWlS6QU4OjEiP3mPnXCejGnXqw"
GROUP_CHAT_ID = -1002462247213
TOPIC_ID = 17022
TELEGRAM_PROXY_URL = "https://nce-telegram-proxy.ntthanhnce.workers.dev"

# Cấu hình Retry
MAX_RETRIES = 4  # Tổng số lần thử (1 lần đầu + 3 lần thử lại)


# --- CÁC HÀM HỖ TRỢ ---

def escape_markdown(text):
    """Hàm hỗ trợ escape các ký tự đặc biệt của MarkdownV2."""
    escape_chars = r'_*[]()~`>#+-=|{}.!'
    return ''.join(f'\\{char}' if char in escape_chars else char for char in str(text))


def send_telegram_message(message, is_error=False):
    """Gửi tin nhắn Telegram với format và proxy."""
    emoji = "💥" if is_error else "✅"
    # Sử dụng SCRIPT_NAME đã định nghĩa ở trên
    full_message = f"{emoji} *{escape_markdown(SCRIPT_NAME)}*\n{message}"

    encoded_message = quote(full_message)

    # Sử dụng proxy URL
    url = f"{TELEGRAM_PROXY_URL}/bot{BOT_TOKEN}/sendMessage?chat_id={GROUP_CHAT_ID}&text={encoded_message}&parse_mode=MarkdownV2"
    if TOPIC_ID:
        url += f"&message_thread_id={TOPIC_ID}"

    try:
        response = requests.get(url, timeout=15)
        if response.status_code == 200:
            logging.info(f"[TELEGRAM] Đã gửi tin nhắn thành công.")
        else:
            logging.error(f"[TELEGRAM] Gửi thất bại: {response.status_code} - {response.text}")
    except Exception as e:
        logging.error(f"[TELEGRAM] Lỗi khi gửi tin nhắn: {e}")


# --- HÀM LOGIC CHÍNH ---

def move_files_with_retry(source_path, dest_path):
    """
    Di chuyển một file với cơ chế thử lại.
    Trả về True nếu thành công, False nếu thất bại sau tất cả các lần thử.
    """
    for attempt in range(MAX_RETRIES):
        try:
            # Đảm bảo thư mục đích tồn tại trước khi di chuyển
            os.makedirs(os.path.dirname(dest_path), exist_ok=True)
            shutil.move(source_path, dest_path)
            logging.info(f"Thành công: Di chuyển '{os.path.basename(source_path)}' tới '{os.path.dirname(dest_path)}'")
            return True
        except Exception as e:
            logging.error(f"Lỗi Lần {attempt + 1}/{MAX_RETRIES} khi di chuyển '{source_path}': {e}")

            if attempt == 0:
                error_msg = (
                    f"⚠️ Lỗi khi di chuyển file: `{escape_markdown(os.path.basename(source_path))}`\n"
                    f"Lỗi: `{escape_markdown(str(e))}`\n"
                    f"Đang thử lại..."
                )
                send_telegram_message(error_msg, is_error=True)

            if attempt < MAX_RETRIES - 1:
                time.sleep(5)
            else:
                final_error_msg = (
                    f"❌ DI CHUYỂN THẤT BẠI\n"
                    f"File: `{escape_markdown(os.path.basename(source_path))}`\n"
                    f"Từ: `{escape_markdown(source_path)}`\n"
                    f"Tới: `{escape_markdown(dest_path)}`\n"
                    f"Lỗi sau {MAX_RETRIES} lần thử: `{escape_markdown(str(e))}`\n\n"
                    f"🛑 Dừng script."
                )
                send_telegram_message(final_error_msg, is_error=True)
                return False
    return False


def run_move_process():
    """
    Quét thư mục nguồn và thực hiện di chuyển file.
    """
    logging.info("===================================================================")
    logging.info(f"  BẮT ĐẦU SCRIPT: {SCRIPT_NAME}")
    logging.info("===================================================================")
    logging.info(f"Thư mục nguồn: {SOURCE_ROOT}")
    logging.info(f"Thư mục đích: {DEST_ROOT}\n")

    any_errors_occurred = False
    total_files_moved = 0
    total_stores_processed = 0

    if not os.path.isdir(SOURCE_ROOT):
        logging.critical(f"Lỗi nghiêm trọng: Không tìm thấy thư mục nguồn: {SOURCE_ROOT}")
        send_telegram_message(
            f"Lỗi nghiêm trọng: Không tìm thấy thư mục nguồn:\n`{escape_markdown(SOURCE_ROOT)}`\n\n🛑 Dừng script.",
            is_error=True)
        sys.exit(1)

    try:
        store_folders = [d for d in os.listdir(SOURCE_ROOT) if os.path.isdir(os.path.join(SOURCE_ROOT, d))]
        if not store_folders:
            logging.warning("Thư mục nguồn trống, không có store nào để xử lý.")
            send_telegram_message("Thư mục nguồn trống, không có gì để di chuyển.", is_error=False)
            sys.exit(0)

        for store_name in store_folders:
            source_store_path = os.path.join(SOURCE_ROOT, store_name)
            logging.info(f"[---] Đang xử lý store: {store_name}")

            files_found_in_store = False
            for subfolder_name in os.listdir(source_store_path):
                source_subfolder_path = os.path.join(source_store_path, subfolder_name)

                if os.path.isdir(source_subfolder_path):
                    files_to_move = [f for f in os.listdir(source_subfolder_path) if
                                     os.path.isfile(os.path.join(source_subfolder_path, f))]

                    if not files_to_move:
                        continue

                    files_found_in_store = True
                    logging.info(
                        f"  -> Tìm thấy {len(files_to_move)} file trong '{subfolder_name}'. Bắt đầu di chuyển...")
                    for file_name in files_to_move:
                        source_file_path = os.path.join(source_subfolder_path, file_name)
                        dest_subfolder_path = os.path.join(DEST_ROOT, store_name, subfolder_name)
                        dest_file_path = os.path.join(dest_subfolder_path, file_name)

                        if not move_files_with_retry(source_file_path, dest_file_path):
                            any_errors_occurred = True
                            sys.exit(1)
                        else:
                            total_files_moved += 1

            if not files_found_in_store:
                logging.info(f"  -> Không tìm thấy file nào trong store '{store_name}'.")

            total_stores_processed += 1
            logging.info(f"[OK] Hoàn tất store: {store_name}\n")

    except Exception as e:
        logging.critical(f"\nLỗi không xác định trong quá trình xử lý: {e}", exc_info=True)
        send_telegram_message(f"Lỗi không xác định trong script:\n`{escape_markdown(str(e))}`\n\n🛑 Dừng script.",
                              is_error=True)
        any_errors_occurred = True
        sys.exit(1)

    if not any_errors_occurred:
        logging.info("===================================================================")
        logging.info("  HOÀN TẤT TOÀN BỘ QUÁ TRÌNH MÀ KHÔNG CÓ LỖI!")
        logging.info(f"  Tổng số file đã di chuyển: {total_files_moved}")
        logging.info(f"  Tổng số store đã xử lý: {total_stores_processed}")
        logging.info("===================================================================")

        success_message = (
            f"Di chuyển file hoàn tất\n"
            f"Tổng số file đã chuyển: `{total_files_moved}`"
        )
        send_telegram_message(success_message, is_error=False)


if __name__ == "__main__":
    run_move_process()
