import subprocess
import sys
import os
import time
import logging
import pytz
import requests
from urllib.parse import quote
from datetime import datetime

# --- CẤU HÌNH ---

# Thiết lập logging
VN_TZ = pytz.timezone('Asia/Ho_Chi_Minh')
current_date = datetime.now(VN_TZ).strftime("%Y%m%d")
# Đặt tên file log riêng cho script điều phối này
log_file = f"E:\\PythonProject1\\Amz-coordinator-{current_date}.txt"

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

# Cấu hình Telegram (giữ nguyên từ script gốc)
BOT_TOKEN = "7319056820:AAGnHjcTzqWlS6QU4OjEiP3mPnXCejGnXqw"
GROUP_CHAT_ID = -1002462247213
TOPIC_ID = 1153
TELEGRAM_PROXY_URL = "https://nce-telegram-proxy.ntthanhnce.workers.dev"
SCRIPT_NAME = "Amz-Coordinator" # Đổi tên script để dễ nhận biết

# --- CÁC HÀM HỖ TRỢ TELEGRAM (giữ nguyên từ script gốc) ---

def escape_markdown(text):
    """Hàm hỗ trợ escape các ký tự đặc biệt của MarkdownV2."""
    escape_chars = r'_*[]()~`>#+-=|{}.!'
    return ''.join(f'\\{char}' if char in escape_chars else char for char in str(text))

def send_telegram_message(message, parse_mode="MarkdownV2"):
    """Gửi tin nhắn Telegram. Tự retry khi gặp 429 (rate limit)."""
    url = f"{TELEGRAM_PROXY_URL}/bot{BOT_TOKEN}/sendMessage?chat_id={GROUP_CHAT_ID}&text={quote(message)}&message_thread_id={TOPIC_ID}&parse_mode={parse_mode}"
    for attempt in range(1, 4):
        try:
            response = requests.get(url, timeout=10)
            if response.status_code == 200:
                logging.info(f"[TELEGRAM] Đã gửi tin nhắn.")
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


# --- HÀM CHÍNH ĐỂ CHẠY SCRIPT ---

def run_scripts_pipeline():
    """
    Hàm chính điều phối việc chạy các script theo thứ tự:
    1. Chạy song song các script 03, 04, 05.
    2. Đợi tất cả hoàn thành.
    3. Đợi thêm 2 phút.
    4. Chạy script 06.
    """
    start_msg = f"🚀 *{escape_markdown(SCRIPT_NAME)}* \\- _Bắt đầu quy trình xử lý dữ liệu_"
    send_telegram_message(start_msg)
    logging.info("=============================================")
    logging.info(f"BẮT ĐẦU CHẠY SCRIPT ĐIỀU PHỐI: {SCRIPT_NAME}")
    logging.info("=============================================")

    # Danh sách các script cần chạy song song
    scripts_to_run_in_parallel = [
        "E:\\PythonProject1\\Amz-03-searchterm.py",
        "E:\\PythonProject1\\Amz-04-bulkfile.py",
        "E:\\PythonProject1\\Amz-05-campaign.py"
    ]

    processes = []
    # Bắt đầu chạy các script 03, 04, 05
    for script_path in scripts_to_run_in_parallel:
        script_name_only = os.path.basename(script_path)
        script_name_no_ext, _ = os.path.splitext(script_name_only)
        logging.info(f"Bắt đầu chạy script {script_name_no_ext}...")
        msg = f"🚀 _Bắt đầu chạy script: {escape_markdown(script_name_no_ext)}_"
        send_telegram_message(msg)
        # Sử dụng Popen để chạy ngầm, không đợi
        process = subprocess.Popen([sys.executable, script_path])
        processes.append((process, script_name_no_ext))

    # Đợi tất cả các script 03, 04, 05 hoàn thành
    logging.info("Đang đợi các script 03, 04, 05 hoàn thành...")
    for process, name in processes:
        process.wait() # Hàm này sẽ block cho đến khi tiến trình kết thúc
        logging.info(f"Script {name} đã chạy xong.")

    logging.info("Tất cả các script Amz-03, Amz-04, Amz-05 đã hoàn thành.")
    msg_part1_done = f"✅ _Các script 03, 04, 05 đã hoàn thành\\._"
    send_telegram_message(msg_part1_done)

    # Đợi 2 phút
    logging.info("Đang đợi 2 phút trước khi chạy script Amz-06-move...")
    wait_msg = f"⏳ _Đợi 2 phút trước khi di chuyển file\\._"
    send_telegram_message(wait_msg)
    time.sleep(120)

    # Chạy script Amz-06-move.py
    amz_06_script_path = "E:\\PythonProject1\\Amz-06-move.py"
    script_06_name = os.path.basename(amz_06_script_path)
    logging.info(f"Bắt đầu chạy script {script_06_name}...")
    run_06_msg = f"🚀 _Bắt đầu chạy script {escape_markdown(script_06_name)}\\_"
    send_telegram_message(run_06_msg)

    try:
        # Sử dụng subprocess.run để đợi script 06 chạy xong và bắt lỗi nếu có
        result = subprocess.run(
            ['python', amz_06_script_path],
            check=True,          # Ném lỗi nếu script trả về mã lỗi khác 0
            capture_output=True, # Bắt output và error
            text=True,           # Decode output/error thành text
            encoding='utf-8'
        )
        logging.info(f"Script {script_06_name} đã hoàn thành thành công.")
        if result.stdout:
            logging.info(f"Output của {script_06_name}:\n{result.stdout}")

    except FileNotFoundError:
        logging.error(f"Lỗi: Không tìm thấy file script: {amz_06_script_path}")
        error_06_msg = f"☠️ _Không tìm thấy file {escape_markdown(script_06_name)}\\_"
        send_telegram_message(error_06_msg)
    except subprocess.CalledProcessError as e:
        logging.error(f"Lỗi: Script {script_06_name} chạy bị lỗi.")
        # Ghi lại cả stdout và stderr để debug dễ hơn
        if e.stdout:
            logging.error("Output:\n" + e.stdout)
        if e.stderr:
            logging.error("Error Output:\n" + e.stderr)
        error_06_msg = f"☠️ _Script {escape_markdown(script_06_name)} chạy bị lỗi\\._\n`{escape_markdown(e.stderr)}`"
        send_telegram_message(error_06_msg)

    # Thông báo kết thúc toàn bộ quy trình
    logging.info("Tất cả các script đã hoàn thành.")
    final_msg = f"🎉 *Toàn bộ quy trình đã hoàn tất thành công\\!* 🎉"
    send_telegram_message(final_msg)


if __name__ == "__main__":
    run_scripts_pipeline()
