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
SCRIPT_NAME = "Amzdata-06-move"

# Thiết lập logging
VN_TZ = pytz.timezone('Asia/Ho_Chi_Minh')
current_date = datetime.now(VN_TZ).strftime("%Y%m%d")
log_file = f"E:\\PythonProject1\\{SCRIPT_NAME}-{current_date}.txt"

# Xóa log cũ trước khi chạy
if os.path.exists(log_file):
    with open(log_file, 'w', encoding='utf-8') as f:
        f.write('')

# Cấu hình logging chi tiết để ghi ra file và hiển thị trên console
logging.basicConfig(
    filename=log_file,
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
    encoding='utf-8'
)
console = logging.StreamHandler(sys.stdout)
console.setLevel(logging.INFO)
console.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s', datefmt='%Y-%m-%d %H:%M:%S'))
logging.getLogger('').addHandler(console)

# Danh sách các cặp thư mục nguồn và đích cần xử lý
PATHS_TO_PROCESS = [
    {
        "name": "DỮ LIỆU ĐẦU VÀO",
        "source": r"E:\PPC\DỮ LIỆU ĐẦU VÀO",
        "dest": r"\\Nceglobal\design tong hop\1. DỮ LIỆU PPC\DỮ LIỆU ĐẦU VÀO"
    },
    {
        "name": "DỮ LIỆU ĐẦU RA",
        "source": r"E:\PPC\DỮ LIỆU ĐẦU RA",
        "dest": r"\\Nceglobal\design tong hop\1. DỮ LIỆU PPC\DỮ LIỆU ĐẦU RA"
    }
]

# Cấu hình Telegram
BOT_TOKEN = "7319056820:AAGnHjcTzqWlS6QU4OjEiP3mPnXCejGnXqw"
GROUP_CHAT_ID = -1002462247213
TOPIC_ID = 14962
TELEGRAM_PROXY_URL = "https://nce-telegram-proxy.ntthanhnce.workers.dev"

# Cấu hình Retry
MAX_RETRIES = 3
RETRY_DELAY = 10  # Tăng thời gian chờ cho các thao tác mạng


# --- CÁC HÀM HỖ TRỢ ---

def escape_markdown(text):
    """Hàm hỗ trợ escape các ký tự đặc biệt của MarkdownV2."""
    escape_chars = r'_*[]()~`>#+-=|{}.!'
    return ''.join(f'\\{char}' if char in escape_chars else char for char in str(text))


def clean_for_log(markdown_text):
    """Làm sạch tin nhắn Markdown để ghi log cho dễ đọc."""
    emojis_to_remove = ['🚀', '✅', '❌', '🔑', '💥', '⚠️', '🛑', '🎉', '⏳', '☠️', '📁', '📄']
    clean_text = markdown_text
    for emoji in emojis_to_remove:
        clean_text = clean_text.replace(emoji, '')
    chars_to_remove = ['*', '_', '`', '~']
    for char in chars_to_remove:
        clean_text = clean_text.replace(char, '')
    clean_text = clean_text.replace('\\', '')
    return clean_text.strip()


def send_telegram_message(message, is_error=False):
    """Gửi tin nhắn Telegram với format và proxy."""
    prefix = f"*{escape_markdown(SCRIPT_NAME)}* \\- "
    if is_error:
        prefix = f"☠️ {prefix}"

    full_message = f"{prefix}{message}"
    encoded_message = quote(full_message)

    url = f"{TELEGRAM_PROXY_URL}/bot{BOT_TOKEN}/sendMessage?chat_id={GROUP_CHAT_ID}&text={encoded_message}&parse_mode=MarkdownV2"
    if TOPIC_ID:
        url += f"&message_thread_id={TOPIC_ID}"

    clean_message = clean_for_log(message)
    log_message = clean_message.replace('\n', ' | ').strip()
    for attempt in range(1, 4):
        try:
            response = requests.get(url, timeout=15)
            if response.status_code == 200:
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
            logging.error(
                f"[TELEGRAM] Gửi thất bại: {response.status_code} - {response.text} | Nội dung: {log_message}")
            return
        except Exception as e:
            logging.error(f"[TELEGRAM] Lỗi khi gửi tin nhắn: {e}")
            return


# --- HÀM LOGIC CHÍNH ---

def merge_and_delete_folder(source_folder, dest_folder):
    """
    Trộn nội dung từ source_folder vào dest_folder.
    - Ghi đè các file trùng tên.
    - Tạo các thư mục/file chưa có.
    - Sau khi sao chép thành công, xóa source_folder.
    """
    folder_name = os.path.basename(source_folder)
    for attempt in range(MAX_RETRIES):
        try:
            logging.info(f"Bắt đầu quá trình trộn từ '{source_folder}' vào '{dest_folder}'")

            files_copied = 0
            dirs_created = 0

            # Duyệt qua tất cả các thư mục và file trong thư mục nguồn
            for src_dir, dirs, files in os.walk(source_folder):
                # Tạo đường dẫn tương ứng ở đích
                dst_dir = src_dir.replace(source_folder, dest_folder, 1)

                # Nếu thư mục đích chưa tồn tại, tạo nó
                if not os.path.exists(dst_dir):
                    os.makedirs(dst_dir)
                    dirs_created += 1
                    logging.info(f"-> Đã tạo thư mục đích: {dst_dir}")

                # Sao chép và ghi đè tất cả các file
                for file_ in files:
                    src_file = os.path.join(src_dir, file_)
                    dst_file = os.path.join(dst_dir, file_)

                    # shutil.copy2 sẽ tự động ghi đè nếu file đích đã tồn tại
                    shutil.copy2(src_file, dst_file)
                    files_copied += 1

            logging.info(f"Đã sao chép {files_copied} files và tạo {dirs_created} thư mục mới cho '{folder_name}'.")

            # Nếu sao chép thành công, xóa toàn bộ thư mục nguồn
            logging.info(f"Sao chép thành công. Bắt đầu xóa thư mục nguồn: {source_folder}")
            shutil.rmtree(source_folder)
            logging.info(f"Đã xóa thành công thư mục nguồn.")

            return True  # Trả về True nếu thành công

        except Exception as e:
            logging.error(f"Lỗi Lần {attempt + 1}/{MAX_RETRIES} khi trộn thư mục '{folder_name}': {e}", exc_info=True)

            if attempt < MAX_RETRIES - 1:
                logging.info(f"Sẽ thử lại sau {RETRY_DELAY} giây...")
                time.sleep(RETRY_DELAY)
            else:
                error_msg = (
                    f"❌ _TRỘN THƯ MỤC THẤT BẠI_\n"
                    f"📁 Thư mục: `{escape_markdown(folder_name)}`\n"
                    f"💥 Lỗi sau {MAX_RETRIES} lần thử: `{escape_markdown(str(e))}`\n\n"
                    f"🛑 Dừng script để kiểm tra thủ công."
                )
                send_telegram_message(error_msg, is_error=True)
                return False
    return False


def run_process():
    """
    Quét các thư mục nguồn và thực hiện trộn/di chuyển các thư mục con.
    """
    logging.info("===================================================================")
    logging.info(f"  BẮT ĐẦU SCRIPT: {SCRIPT_NAME} (phiên bản MERGE)")
    logging.info("===================================================================")
    send_telegram_message(f"🚀 _Bắt đầu di chuyển & trộn file đã xử lý\\._")

    total_folders_processed = 0

    try:
        for path_info in PATHS_TO_PROCESS:
            name = path_info["name"]
            source_root = path_info["source"]
            dest_root = path_info["dest"]

            logging.info(f"\n[---] Bắt đầu xử lý: {name} [---]")
            logging.info(f"Thư mục nguồn: {source_root}")
            logging.info(f"Thư mục đích: {dest_root}")

            if not os.path.isdir(source_root):
                logging.warning(f"Không tìm thấy thư mục nguồn: {source_root}. Bỏ qua.")
                continue

            # Đảm bảo thư mục đích gốc tồn tại
            try:
                os.makedirs(dest_root, exist_ok=True)
            except OSError as e:
                logging.critical(f"Lỗi nghiêm trọng: Không thể truy cập hoặc tạo thư mục đích: {dest_root}. Lỗi: {e}")
                send_telegram_message(
                    f"Lỗi nghiêm trọng khi truy cập đích: `{escape_markdown(dest_root)}`\n\n🛑 Dừng script\\.",
                    is_error=True)
                sys.exit(1)

            # Lấy danh sách các thư mục con trong nguồn để xử lý
            try:
                folders_to_process = [d for d in os.listdir(source_root) if os.path.isdir(os.path.join(source_root, d))]
            except Exception as e:
                logging.critical(f"Lỗi nghiêm trọng: Không thể đọc thư mục nguồn: {source_root}. Lỗi: {e}")
                send_telegram_message(
                    f"Lỗi nghiêm trọng khi đọc nguồn: `{escape_markdown(source_root)}`\n\n🛑 Dừng script\\.",
                    is_error=True)
                sys.exit(1)

            if not folders_to_process:
                logging.info("-> Thư mục nguồn không có thư mục con nào để xử lý.")
                continue

            logging.info(f"-> Tìm thấy {len(folders_to_process)} thư mục con. Bắt đầu xử lý...")

            for folder_name in folders_to_process:
                source_folder_path = os.path.join(source_root, folder_name)
                dest_folder_path = os.path.join(dest_root, folder_name)  # Đường dẫn thư mục đích tương ứng

                logging.info(f"\nĐang xử lý thư mục: '{folder_name}'")

                if not merge_and_delete_folder(source_folder_path, dest_folder_path):
                    # Nếu hàm merge thất bại, nó đã gửi tin nhắn và ghi log. Dừng toàn bộ script.
                    sys.exit(1)

                total_folders_processed += 1

            logging.info(f"[OK] Hoàn tất xử lý cho: {name}")

    except Exception as e:
        logging.critical(f"\nLỗi không xác định trong quá trình xử lý: {e}", exc_info=True)
        send_telegram_message(f"_Lỗi không xác định_: `{escape_markdown(str(e))}`\n\n🛑 Dừng script\\.", is_error=True)
        sys.exit(1)

    # Nếu script chạy đến đây mà không thoát, nghĩa là mọi thứ thành công
    logging.info("===================================================================")
    if total_folders_processed > 0:
        logging.info("  HOÀN TẤT TOÀN BỘ QUÁ TRÌNH MÀ KHÔNG CÓ LỖI!")
        logging.info(f"  Tổng số thư mục gốc đã xử lý và di chuyển: {total_folders_processed}")
        success_message = (
            f"✅ _Di chuyển & trộn thư mục hoàn tất_\n"
            f"Tổng số thư mục đã xử lý: `{total_folders_processed}`"
        )
    else:
        logging.info("  Hoàn tất. Không có thư mục mới nào để xử lý trong tất cả các nguồn.")
        success_message = "✅ _Hoàn tất\\. Không có thư mục mới nào để di chuyển\\._"

    logging.info("===================================================================")
    send_telegram_message(success_message, is_error=False)


if __name__ == "__main__":
    run_process()
