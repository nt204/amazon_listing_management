import os
import gspread
import pandas as pd
from oauth2client.service_account import ServiceAccountCredentials
import logging
from datetime import datetime, timedelta
import pytz
import requests
import google.auth.exceptions
from urllib.parse import quote
import time
import numpy as np

# ==============================================================================
# --- BẢNG ĐIỀU KHIỂN VÀ CẤU HÌNH TRUNG TÂM ---
# ==============================================================================

# --- CẤU HÌNH CHUNG ---
# Key MỚI: Chỉ dùng để đọc danh sách store (cấu hình)
GOOGLE_API_KEYFILE_READ = r"E:\\PythonProject1\\NCE_googleapi.json"
# Key CŨ: Dùng để ghi dữ liệu vào các sheet (như cũ)
GOOGLE_API_KEYFILE_WRITE = r"E:\\PythonProject1\\NCE_googleapi_old.json"

SOURCE_ROOT_DIR = r"E:\\Kế toán"
SCRIPT_NAME = "Ketoanamz-02-6sheet"
VN_TZ = pytz.timezone('Asia/Ho_Chi_Minh')

# --- CẤU HÌNH TELEGRAM ---
BOT_TOKEN = "7319056820:AAGnHjcTzqWlS6QU4OjEiP3mPnXCejGnXqw"
GROUP_CHAT_ID = -1002462247213
TOPIC_ID = 17017
TELEGRAM_PROXY_URL = "https://nce-telegram-proxy.ntthanhnce.workers.dev"

# --- CÔNG TẮC TÍNH NĂNG TỔNG QUÁT ---
PROCESS_FBM = True  # Bật/Tắt TOÀN BỘ luồng FBM

# --- CÔNG TẮC XỬ LÝ FBM CHO TỪNG FILE ---
# (Chỉ có tác dụng khi PROCESS_FBM ở trên là True)
PROCESS_FBM_FILE_01 = True
PROCESS_FBM_FILE_02 = True
PROCESS_FBM_FILE_03 = True
PROCESS_FBM_FILE_04 = True
PROCESS_FBM_FILE_05 = False  # Tắt FBM cho file 05
PROCESS_FBM_FILE_06 = False  # Tắt FBM cho file 06
PROCESS_FBM_FILE_07 = False  # Tắt FBM cho file 07

# --- CÔNG TẮC TÍNH NĂNG TỪNG FILE (Mặc định cho FBA) ---
PROCESS_FILE_01 = True
PROCESS_FILE_02 = True
PROCESS_FILE_03 = True
PROCESS_FILE_04 = True
PROCESS_FILE_05 = False
PROCESS_FILE_06 = True
PROCESS_FILE_07 = True

# --- CẤU HÌNH CHI TIẾT (URL, TÊN SHEET, TÊN CỘT, TÊN FILE) ---

# 1. Sheet Cấu Hình Chính (Nơi lấy danh sách brand và các link sheet)
BRANDS_SPREADSHEET_URL = "https://docs.google.com/spreadsheets/d/1CBZuKZOjG9zxNrfdh3qgeofkwW1758ruZl-yT77_IeI/edit?gid=0#gid=0"
BRANDS_WORKSHEET_NAME = "02-ketoan"
# Tên các cột trong sheet cấu hình chính
CONFIG_BRAND_COL = "BRAND"
CONFIG_ID_COL = "id"
CONFIG_KETOAN_SHEET_COL = "KetoanSheet"
CONFIG_CHECKLIST_SHEET_COL = "checklistmktSheet"
CONFIG_FBM_SHEET_COL = "FBMSheet"
CONFIG_FBM_STATUS_COL = "FBM"

# 2. Sheet Tổng Hợp (Master Sheet)
MASTER_SHEET_URL = "https://docs.google.com/spreadsheets/d/1DuwmLaeNW8oAvSFSw58lt-u880AxMbPiqDZyGP0t1Z4/edit?gid=0#gid=0"
MASTER_SHEET_INVENTORY_NAME = "NGUỒN INVENTORY AMAZON" # <-- Đổi tên biến này (cho File 06)
MASTER_SHEET_SHIPMENT_NAME = "CHECK SHIPMENT AMAZON"   # <-- Thêm biến này (cho File 07)

# 3. Cấu hình File 01: Portfolios -> ADS
FILE01_UPLOAD_WORKSHEET_NAME = "ADS"
FILE01_INPUT_FILENAME_FORMAT = "{brand}_Portfolios_{date}.csv"
FILE01_INPUT_SUBFOLDER = "1-Ads"

# 4. Cấu hình File 02: All Orders -> Đầu vào Order
FILE02_UPLOAD_WORKSHEET_NAME = "Đầu vào Order"
FILE02_INPUT_FILENAME_FORMAT = "{brand}_Order_{date}.txt"
FILE02_INPUT_SUBFOLDER = "2-Order"

# 5. Cấu hình File 03: Return -> RETURN
FILE03_UPLOAD_WORKSHEET_NAME = "RETURN"
FILE03_INPUT_FILENAME_FORMAT = "{brand}_Return_{date}.csv"
FILE03_INPUT_SUBFOLDER = "3-Return"

# 6. Cấu hình File 04: Service Fees -> Service Fees
FILE04_UPLOAD_WORKSHEET_NAME = "Service Fees"
FILE04_INPUT_FILENAME_FORMAT = "{brand}_ServiceFee_{date}.csv"
FILE04_INPUT_SUBFOLDER = "4-Service Fees"

# 7. Cấu hình File 05: Campaigns -> Campaign ads
FILE05_UPLOAD_WORKSHEET_NAME = "Campaign ads"
FILE05_INPUT_FILENAME_FORMAT = "{brand}_Campaigns_{date}.csv"
FILE05_INPUT_SUBFOLDER = "5-Campaign Ads"
FILE05_HEADER_CONFIG_WORKSHEET_NAME = "kt-f05-header"  # Sheet chứa tên các cột cần lấy
FILE05_HEADER_CONFIG_COLUMN = "Cột Cần Thiết"  # Tên cột trong sheet cấu hình header

# 8. Cấu hình File 06: Inventory -> Inventory Amazon
FILE06_UPLOAD_WORKSHEET_NAME = "Inventory Amazon"
FILE06_INPUT_FILENAME_FORMAT = "{brand}_Inventory_{date}.txt"
FILE06_INPUT_SUBFOLDER = "6-Inventory"

# 9. Cấu hình File 07: Shipment -> CHECK SHIPMENT AMAZON (MỚI)
FILE07_INPUT_FILENAME_FORMAT = "{brand}_Shipment_{date}.csv"
FILE07_INPUT_SUBFOLDER = "7-Shipment"

# ==============================================================================
# --- KẾT THÚC PHẦN CẤU HÌNH ---
# ==============================================================================

# Cấu hình logging
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


# --- CÁC HÀM HỖ TRỢ ---

def execute_with_retry(func, *args, **kwargs):
    """
    Hàm wrapper để thử lại một hàm nếu có lỗi mạng hoặc API máy chủ (5xx).
    Sẽ không thử lại với lỗi client (4xx) vì đây thường là lỗi vĩnh viễn và sẽ làm script bị kẹt.
    """
    delay = 30
    while True:
        try:
            return func(*args, **kwargs)
        except (requests.exceptions.RequestException, gspread.exceptions.GSpreadException,
                gspread.exceptions.APIError, google.auth.exceptions.TransportError,
                google.auth.exceptions.RefreshError) as e:

            response = None
            # Kiểm tra an toàn xem exception có thuộc tính 'response' không
            if hasattr(e, 'response'):
                response = e.response

                # Nếu có response và status_code
                if response is not None and hasattr(response, 'status_code'):
                    # --- FIX LỖI 429 (QUOTA) ---
                    if response.status_code == 429:
                        logging.warning(f"⚠️ Gặp lỗi 429 (Quota Exceeded). Đang chờ 60 giây để hồi phục Quota...")
                        time.sleep(60)
                        continue  # Quay lại đầu vòng lặp để thử lại ngay

                    # Các lỗi Client khác (400-499 nhưng KHÔNG PHẢI 429) -> Mới dừng
                    if 400 <= response.status_code < 500:
                        logging.error(f"❌ Lỗi phía client ({response.status_code}), sẽ không thử lại. Lỗi: {e}")
                        break  # Thoát

                # Đối với các lỗi khác (5xx, lỗi mạng, timeout...), tiếp tục thử lại
                logging.warning(f"⚠️ Lỗi mạng hoặc API: {e}. Thử lại sau {delay} giây...")
                time.sleep(delay)


def escape_markdown(text):
    """Hàm hỗ trợ escape các ký tự đặc biệt của MarkdownV2."""
    escape_chars = r'_*[]()~`>#+-=|{}.!'
    return ''.join(f'\\{char}' if char in escape_chars else char for char in str(text))


def clean_for_log(markdown_text):
    """Làm sạch tin nhắn Markdown để ghi log cho dễ đọc."""
    emojis_to_remove = ['🚀', '✅', '❌', '📄', '💥', '', '⚠️', '🔑', '📈', '🔍', '📋', '📤']
    clean_text = markdown_text
    for emoji in emojis_to_remove:
        clean_text = clean_text.replace(emoji, '')
    chars_to_remove = ['*', '_', '`', '~']
    for char in chars_to_remove:
        clean_text = clean_text.replace(char, '')
    placeholder = "___PATH_SEPARATOR___"
    clean_text = clean_text.replace('\\\\', placeholder)
    clean_text = clean_text.replace('\\', '')
    clean_text = clean_text.replace(placeholder, '\\')
    return clean_text.strip()


def send_telegram_message_wrapper(message, parse_mode="MarkdownV2"):
    """Hàm gốc để execute_with_retry có thể gọi."""
    url = f"{TELEGRAM_PROXY_URL}/bot{BOT_TOKEN}/sendMessage?chat_id={GROUP_CHAT_ID}&text={quote(message)}&message_thread_id={TOPIC_ID}&parse_mode={parse_mode}"
    # Đặt timeout cao hơn cho request
    response = requests.get(url, timeout=60)
    clean_message = clean_for_log(message).replace('\n', ' | ').strip()
    if response.status_code != 200:
        logging.error(
            f"[TELEGRAM] Gửi thất bại: {response.status_code} {response.text} | Nội dung: {clean_message}")
        # Ném lỗi để execute_with_retry bắt được và thử lại
        response.raise_for_status()
    else:
        logging.info(f"[TELEGRAM] Đã gửi: {clean_message}")


def get_profile_configs():
    """Lấy cấu hình các profile từ Google Sheet bằng Key READ."""
    # SỬ DỤNG KEY READ ĐỂ ĐỌC CẤU HÌNH
    keyfile = GOOGLE_API_KEYFILE_READ
    scope = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]
    try:
        creds = ServiceAccountCredentials.from_json_keyfile_name(keyfile, scope)
        gc_read = gspread.authorize(creds) # Đây là client chỉ để đọc
        sheet = execute_with_retry(lambda: gc_read.open_by_url(BRANDS_SPREADSHEET_URL).worksheet(BRANDS_WORKSHEET_NAME))
        rows = execute_with_retry(lambda: sheet.get_all_records())

        profile_configs = [
            {
                "brand": row[CONFIG_BRAND_COL],
                "id": row[CONFIG_ID_COL],
                "ketoan_sheet_url": row.get(CONFIG_KETOAN_SHEET_COL, ""),
                "checklist_sheet_url": row.get(CONFIG_CHECKLIST_SHEET_COL, ""),
                "fbm_sheet_url": row.get(CONFIG_FBM_SHEET_COL, ""),
                "fbm_status": row.get(CONFIG_FBM_STATUS_COL, "")
            }
            for row in rows if
            row.get(CONFIG_ID_COL) and row.get(CONFIG_BRAND_COL) and (
                    row.get(CONFIG_KETOAN_SHEET_COL) or row.get(CONFIG_CHECKLIST_SHEET_COL))
        ]

        logging.info(f"Đã đọc {len(profile_configs)} profiles có cấu hình hợp lệ từ Google Sheet.")
        return profile_configs
    except Exception as e:
        logging.error(f"Lỗi nghiêm trọng khi truy cập Google Sheet lấy cấu hình: {e}", exc_info=True)
        msg = f"*{escape_markdown(SCRIPT_NAME)}*\n" \
              f"💥 _Lỗi nghiêm trọng khi đọc cấu hình brand từ Google Sheet_\n" \
              f"Lỗi: `{escape_markdown(e)}`"
        execute_with_retry(send_telegram_message_wrapper, msg)
        return None


def colnum_to_letter(n):
    """Chuyển đổi số thứ tự cột sang tên cột dạng chữ."""
    string = ""
    while n > 0:
        n, remainder = divmod(n - 1, 26)
        string = chr(65 + remainder) + string
    return string


# --- CÁC HÀM XỬ LÝ VÀ UPLOAD (ĐÃ CẬP NHẬT) ---

def process_portfolio_file_and_upload(gc, profile_config, source_file_path):
    brand = profile_config["brand"]
    sheet_url = profile_config.get("ketoan_sheet_url")
    if not sheet_url:
        logging.error(f"[{brand}] Bỏ qua file Portfolios vì thiếu 'KetoanSheet' URL.")
        return
    worksheet_name = FILE01_UPLOAD_WORKSHEET_NAME
    logging.info(f"[{brand}] Bắt đầu xử lý file Portfolios: {source_file_path}")
    telegram_path = source_file_path.replace('\\', '\\\\')
    try:
        df = pd.read_csv(source_file_path, header=0)
        if 'Spend(USD)' in df.columns:
            df['Spend(USD)'] = pd.to_numeric(df['Spend(USD)'], errors='coerce')
            original_rows = len(df)
            df = df[df['Spend(USD)'] > 0].copy()
            filtered_rows = len(df)
            logging.info(
                f"[{brand}] Đã lọc file Portfolios. Giữ lại {filtered_rows}/{original_rows} dòng có Spend(USD) > 0.")
        else:
            logging.warning(
                f"[{brand}] Không tìm thấy cột 'Spend(USD)' trong file Portfolios. Sẽ tải lên toàn bộ file.")
        if df.empty:
            logging.warning(f"[{brand}] File Portfolios không có dữ liệu hợp lệ để tải lên. Bỏ qua.")
            return
        df.replace(np.nan, '', inplace=True)
        num_rows, num_cols = df.shape
        data_to_upload = df.values.tolist()

        worksheet = execute_with_retry(lambda: gc.open_by_url(sheet_url).worksheet(worksheet_name))
        logging.info(f"[{brand}] Đã kết nối tới sheet '{worksheet_name}'.")

        col_values = execute_with_retry(lambda: worksheet.col_values(1))
        last_row_with_data = len(col_values)
        if last_row_with_data >= worksheet.row_count:
            execute_with_retry(worksheet.add_rows, num_rows)
            logging.info(f"[{brand}] Đã thêm {num_rows} dòng mới vào sheet '{worksheet_name}'.")

        target_row = last_row_with_data + 1
        logging.info(
            f"[{brand}] Sẽ dán {num_rows} dòng dữ liệu Portfolios vào sheet '{worksheet_name}' từ dòng: {target_row}")

        end_col_letter = colnum_to_letter(num_cols)
        end_row = target_row + num_rows - 1
        data_range = f'A{target_row}:{end_col_letter}{end_row}'

        execute_with_retry(worksheet.update, values=data_to_upload, range_name=data_range,
                           value_input_option='USER_ENTERED')

        try:
            filename_only = os.path.basename(source_file_path)
            date_part = filename_only.split('_')[-3:]
            date_str_from_filename = f"{date_part[0]} {date_part[1]} {date_part[2].split('.')[0]}"
            date_obj = datetime.strptime(date_str_from_filename, '%b %d %Y')
            # Sửa: Ghi format US để Sheet nhận diện date đúng
            new_date_str = date_obj.strftime('%m/%d/%Y')
        except Exception:
            new_date_str = datetime.now(VN_TZ).strftime('%m/%d/%Y')

        date_column_range = f'A{target_row}:A{end_row}'
        date_column_values = [[new_date_str]] * num_rows
        execute_with_retry(worksheet.update, values=date_column_values, range_name=date_column_range,
                           value_input_option='USER_ENTERED')

        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"📄 _Đã đẩy {num_rows} dòng từ file Portfolios lên sheet '{escape_markdown(worksheet_name)}'_\\.\n" \
              f"File: `{telegram_path}`"
        execute_with_retry(send_telegram_message_wrapper, msg)
    except Exception as e:
        error_msg = f"Lỗi khi xử lý file Portfolios. Chi tiết: {e}"
        logging.error(f"[{brand}] {error_msg}", exc_info=True)
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"💥 _Lỗi nghiêm trọng khi xử lý file Portfolios_\n" \
              f"Lỗi: `{escape_markdown(e)}`"
        execute_with_retry(send_telegram_message_wrapper, msg)


def process_all_orders_file_and_upload(gc, profile_config, source_file_path):
    brand = profile_config["brand"]
    sheet_url = profile_config.get("ketoan_sheet_url")
    if not sheet_url:
        logging.error(f"[{brand}] Bỏ qua file All Orders vì thiếu 'KetoanSheet' URL.")
        return
    worksheet_name = FILE02_UPLOAD_WORKSHEET_NAME
    logging.info(f"[{brand}] Bắt đầu xử lý file Order: {source_file_path}")
    try:
        df = pd.read_csv(source_file_path, sep='\t', header=0, on_bad_lines='warn', engine='python')
        if df.empty:
            logging.warning(f"[{brand}] File All Orders TXT rỗng. Bỏ qua.")
            return
        df.replace(np.nan, '', inplace=True)
        num_rows = df.shape[0]
        data_to_upload = df.values.tolist()

        worksheet = execute_with_retry(lambda: gc.open_by_url(sheet_url).worksheet(worksheet_name))
        logging.info(f"[{brand}] Đã kết nối tới sheet '{worksheet_name}'.")

        col_values = execute_with_retry(lambda: worksheet.col_values(2))
        last_row_with_data = len(col_values)
        if last_row_with_data + num_rows > worksheet.row_count:
            execute_with_retry(worksheet.add_rows, num_rows)
            logging.info(f"[{brand}] Đã thêm {num_rows} dòng mới vào sheet '{worksheet_name}'.")

        target_row = last_row_with_data + 1
        logging.info(
            f"[{brand}] Sẽ dán {num_rows} dòng dữ liệu All Orders vào sheet '{worksheet_name}' từ ô B{target_row}")

        data_range = f'B{target_row}'
        execute_with_retry(worksheet.update, values=data_to_upload, range_name=data_range,
                           value_input_option='USER_ENTERED')
        logging.info(f"[{brand}] Đã dán dữ liệu All Orders thành công.")

        end_row = target_row + num_rows - 1
        try:
            filename_only = os.path.basename(source_file_path)
            date_part = filename_only.split('_')[-3:]
            date_str_from_filename = f"{date_part[0]} {date_part[1]} {date_part[2].split('.')[0]}"
            date_obj = datetime.strptime(date_str_from_filename, '%b %d %Y')
            # Sửa: Ghi format US để Sheet nhận diện date đúng
            new_date_str = date_obj.strftime('%m/%d/%Y')
        except Exception:
            new_date_str = datetime.now(VN_TZ).strftime('%m/%d/%Y')

        date_column_range = f'A{target_row}:A{end_row}'
        date_column_values = [[new_date_str]] * num_rows
        execute_with_retry(worksheet.update, values=date_column_values, range_name=date_column_range,
                           value_input_option='USER_ENTERED')

        telegram_path = source_file_path.replace('\\', '\\\\')
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"📄 _Đã đẩy {num_rows} dòng từ file All Orders lên sheet '{escape_markdown(worksheet_name)}'_\\.\n" \
              f"File: `{telegram_path}`"
        execute_with_retry(send_telegram_message_wrapper, msg)
    except Exception as e:
        error_msg = f"Lỗi khi xử lý file All Orders. Chi tiết: {e}"
        logging.error(f"[{brand}] {error_msg}", exc_info=True)
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"💥 _Lỗi nghiêm trọng khi xử lý file All Orders_\n" \
              f"Lỗi: `{escape_markdown(e)}`"
        execute_with_retry(send_telegram_message_wrapper, msg)


def process_historical_orders_file_and_upload(gc, profile_config, past_date_obj):
    """
    PHIÊN BẢN SỬA LỖI + COPY FORMAT:
    - Tìm kiếm: dd/mm/YYYY
    - Ghi vào: mm/dd/YYYY (để Sheet hiểu Date)
    - Sau khi Insert: Copy format dòng trên + Ép hiển thị dd/mm/yyyy
    """
    brand = profile_config["brand"]
    sheet_url = profile_config.get("ketoan_sheet_url")
    if not sheet_url:
        return

    # 1. Xây dựng tên file
    date_in_filename = past_date_obj.strftime('%b_%d_%Y')
    file_name = FILE02_INPUT_FILENAME_FORMAT.format(brand=brand, date=date_in_filename)
    source_file_path = os.path.join(SOURCE_ROOT_DIR, brand, FILE02_INPUT_SUBFOLDER, file_name)

    logging.info(f"[{brand}] [Historical] Đang kiểm tra file quá khứ: {source_file_path}")

    # 2. Đọc File Local
    file_has_data = False
    df = pd.DataFrame()
    if os.path.exists(source_file_path):
        try:
            df = pd.read_csv(source_file_path, sep='\t', header=0, on_bad_lines='warn', engine='python')
            if not df.empty:
                file_has_data = True
                df.replace(np.nan, '', inplace=True)
        except Exception as e:
            logging.error(f"[{brand}] Lỗi đọc file quá khứ: {e}")
    else:
        logging.info(f"[{brand}] [Historical] Không tìm thấy file. Coi như file blank.")

    # 3. Kết nối Sheet
    worksheet_name = FILE02_UPLOAD_WORKSHEET_NAME
    try:
        worksheet = execute_with_retry(lambda: gc.open_by_url(sheet_url).worksheet(worksheet_name))
        col_dates = execute_with_retry(lambda: worksheet.col_values(1))
    except Exception as e:
        logging.error(f"[{brand}] Lỗi kết nối sheet: {e}")
        return

    # 4. TÌM KIẾM
    target_date_str_vn = past_date_obj.strftime('%d/%m/%Y')
    # Đã xóa dòng target_date_str_us

    logging.info(f"[{brand}] Đang tìm dòng chứa ngày chính xác: {target_date_str_vn}")

    # Chỉ tìm dòng khớp chính xác với target_date_str_vn
    matching_rows = [i + 1 for i, val in enumerate(col_dates) if val == target_date_str_vn]
    sheet_has_data = bool(matching_rows)

    if not file_has_data and not sheet_has_data:
        logging.info(f"[{brand}] [Historical] Case 1: File rỗng, Sheet không có data. Bỏ qua.")
        return

    data_from_csv = df.values.tolist()
    num_rows = len(data_from_csv)
    full_rows_to_insert = []
    date_to_write = past_date_obj.strftime('%m/%d/%Y')

    for row_data in data_from_csv:
        full_rows_to_insert.append([date_to_write] + row_data)

    # Case 4: Xóa data cũ
    if not file_has_data and sheet_has_data:
        logging.info(f"[{brand}] [Historical] Case 4: File rỗng -> Xóa data cũ.")
        _fast_delete_rows(worksheet, matching_rows)
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"🗑️ _Đã xóa dữ liệu ngày {escape_markdown(target_date_str_vn)} do file cập nhật trống_\\."
        execute_with_retry(send_telegram_message_wrapper, msg)
        return

    # Case 2: Có data mới và cũ -> Xóa cũ, chèn mới
    if file_has_data and sheet_has_data:
        logging.info(f"[{brand}] [Historical] Case 2: Có data mới và cũ -> Xóa cũ, chèn mới.")
        first_match_idx = matching_rows[0]

        # 1. Xóa nhanh dòng cũ
        _fast_delete_rows(worksheet, matching_rows)

        # 2. Chèn dòng mới vào đúng vị trí đó
        execute_with_retry(
            lambda: worksheet.insert_rows(full_rows_to_insert, row=first_match_idx,
                                          value_input_option='USER_ENTERED'))

        # Đã xóa đoạn Format ở đây để tiết kiệm thời gian

        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"🔄 _Đã cập nhật {num_rows} dòng cho ngày {escape_markdown(target_date_str_vn)}_\\."
        execute_with_retry(send_telegram_message_wrapper, msg)

    # Case 3: Insert mới
    if file_has_data and not sheet_has_data:
        logging.info(f"[{brand}] [Historical] Case 3: Data mới -> Chèn dòng 2.")
        insert_at = 2
        execute_with_retry(
            lambda: worksheet.insert_rows(full_rows_to_insert, row=insert_at, value_input_option='USER_ENTERED'))

        # Đã xóa đoạn batch_update format ở đây để script chạy nhanh

        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"➕ _Đã chèn bổ sung {num_rows} dòng cho ngày {escape_markdown(target_date_str_vn)}_\\."
        execute_with_retry(send_telegram_message_wrapper, msg)


def _fast_delete_rows(worksheet, row_indices):
    """
    PHIÊN BẢN NÂNG CẤP:
    Xóa nhiều dòng (kể cả rời rạc) bằng 1 lệnh batch_update duy nhất.
    Nhanh hơn gấp 100 lần so với xóa từng dòng.
    """
    if not row_indices:
        return

    # 1. Sắp xếp giảm dần để xóa từ dưới lên (QUAN TRỌNG: để không bị lệch dòng khi xóa)
    sorted_indices = sorted(list(set(row_indices)), reverse=True)

    logging.info(f"Chuẩn bị xóa {len(sorted_indices)} dòng bằng Batch Update...")

    # 2. Gom nhóm các dòng liên tiếp thành các khoảng (Ranges)
    # Ví dụ: [10, 9, 8, 5, 2] -> Sẽ gom thành 3 lệnh xóa: [10-8], [5], [2]
    ranges = []
    if sorted_indices:
        current_start = sorted_indices[0]
        current_end = sorted_indices[0]

        for i in range(1, len(sorted_indices)):
            next_val = sorted_indices[i]
            if next_val == current_end - 1:
                # Vẫn liên tiếp (đang giảm dần 1 đơn vị) -> Kéo dài khoảng
                current_end = next_val
            else:
                # Bị ngắt quãng -> Lưu khoảng cũ lại
                # Lưu ý: current_end là số nhỏ, current_start là số lớn
                ranges.append((current_end, current_start))
                current_start = next_val
                current_end = next_val
        # Lưu khoảng cuối cùng
        ranges.append((current_end, current_start))

    # 3. Tạo danh sách các lệnh xóa (Requests)
    requests = []
    sheet_id = worksheet.id

    for start_row, end_row in ranges:
        # Chuyển đổi sang Index của Google API (0-based)
        # start_row (1-based) -> startIndex = start_row - 1
        # end_row (1-based) -> endIndex = end_row (vì API tính exclusive, xóa đến trước endIndex)
        # Ví dụ xóa dòng 100: start=99, end=100

        req = {
            "deleteDimension": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "ROWS",
                    "startIndex": start_row - 1,
                    "endIndex": end_row
                }
            }
        }
        requests.append(req)

    # 4. Gửi 1 lệnh duy nhất lên Google
    if requests:
        body = {"requests": requests}
        try:
            logging.info(f"Đang gửi lệnh xóa {len(requests)} khoảng dòng (tổng {len(sorted_indices)} dòng)...")
            execute_with_retry(worksheet.spreadsheet.batch_update, body)
            logging.info("✅ Đã xóa thành công toàn bộ các dòng trùng lặp.")
        except Exception as e:
            logging.error(f"Lỗi khi Batch Delete: {e}")
            # Fallback: Nếu Batch lỗi thì thử xóa từng cái (nhưng hiếm khi xảy ra)
            for req in requests:
                try:
                    worksheet.spreadsheet.batch_update({"requests": [req]})
                except:
                    pass


def process_return_file_and_upload(gc, profile_config, source_file_path):
    brand = profile_config["brand"]
    sheet_url = profile_config.get("ketoan_sheet_url")
    if not sheet_url:
        logging.error(f"[{brand}] Bỏ qua file Return vì thiếu 'KetoanSheet' URL.")
        return
    worksheet_name = FILE03_UPLOAD_WORKSHEET_NAME
    logging.info(f"[{brand}] Bắt đầu xử lý file Return: {source_file_path}")
    try:
        df = pd.read_csv(source_file_path, header=None)
        if df.shape[0] < 2:
            logging.warning(f"[{brand}] File Return CSV không có dữ liệu. Bỏ qua.")
            return
        last_row_date_str = df.iloc[-1, 0]
        try:
            target_date_obj = pd.to_datetime(last_row_date_str).date()
        except Exception as e:
            logging.error(f"[{brand}] Không thể phân tích ngày '{last_row_date_str}' từ file Return. Lỗi: {e}")
            return

        worksheet = execute_with_retry(lambda: gc.open_by_url(sheet_url).worksheet(worksheet_name))
        logging.info(f"[{brand}] Đã kết nối tới sheet '{worksheet_name}'.")

        col_f_values = execute_with_retry(lambda: worksheet.col_values(6))
        start_row, paste_mode, last_row_with_data_in_col = -1, "Ghi đè", 0
        for i, cell_value in enumerate(col_f_values):
            if cell_value:
                last_row_with_data_in_col = i + 1
                try:
                    sheet_date_obj = pd.to_datetime(cell_value, dayfirst=True).date()
                    if sheet_date_obj == target_date_obj:
                        start_row = i + 1
                        break
                except Exception:
                    continue

        data_to_upload = df.iloc[1:].values.tolist()
        if not data_to_upload:
            logging.warning(f"[{brand}] Không có dữ liệu trong file Return để dán. Bỏ qua.")
            return
        data_to_upload.reverse()
        num_rows = len(data_to_upload)

        if start_row != -1:
            logging.info(f"[{brand}] Tìm thấy ngày trùng khớp. Xóa dữ liệu cũ từ dòng {start_row} trở xuống.")
            range_to_clear = f'F{start_row}:O'
            execute_with_retry(worksheet.batch_clear, [range_to_clear])
            logging.info(f"[{brand}] Đã xóa dữ liệu cũ trong vùng {range_to_clear}.")
        else:
            paste_mode = "Ghi tiếp"
            start_row = last_row_with_data_in_col + 1
            required_rows = start_row + num_rows - 1
            if required_rows > worksheet.row_count:
                rows_to_add = required_rows - worksheet.row_count
                execute_with_retry(worksheet.add_rows, rows_to_add)
                logging.info(
                    f"[{brand}] Đã thêm {rows_to_add} dòng vào sheet '{worksheet_name}'.")

        logging.info(
            f"[{brand}] Sẽ {paste_mode.lower()} {num_rows} dòng vào sheet '{worksheet_name}' từ ô F{start_row}")
        range_to_update = f'F{start_row}'
        execute_with_retry(worksheet.update, values=data_to_upload, range_name=range_to_update,
                           value_input_option='USER_ENTERED')
        logging.info(f"[{brand}] Đã {paste_mode.lower()} {num_rows} dòng file Return thành công.")

        end_row_format = start_row + num_rows - 1
        format_body_pasted_range = {"requests": [{"repeatCell": {
            "range": {"sheetId": worksheet.id, "startRowIndex": start_row - 1, "endRowIndex": end_row_format,
                      "startColumnIndex": 5, "endColumnIndex": 6},
            "cell": {"userEnteredFormat": {"numberFormat": {"type": "DATE", "pattern": "dd/mm/yyyy"}}},
            "fields": "userEnteredFormat.numberFormat"
        }}]}
        execute_with_retry(worksheet.spreadsheet.batch_update, format_body_pasted_range)
        logging.info(f"[{brand}] Đã áp dụng lại định dạng ngày cho vùng F{start_row}:F{end_row_format} vừa dán.")

        if paste_mode == "Ghi tiếp" and last_row_with_data_in_col > 0:
            body = {"requests": [{"copyPaste": {
                "source": {"sheetId": worksheet.id, "startRowIndex": last_row_with_data_in_col - 1,
                           "endRowIndex": last_row_with_data_in_col},
                "destination": {"sheetId": worksheet.id, "startRowIndex": start_row - 1,
                                "endRowIndex": start_row + num_rows - 1}, "pasteType": "PASTE_FORMAT",
                "pasteOrientation": "NORMAL"}}]}
            execute_with_retry(worksheet.spreadsheet.batch_update, body)
            logging.info(f"[{brand}] Đã sao chép định dạng cho sheet Return thành công.")

        telegram_path = source_file_path.replace('\\', '\\\\')
        action_text = f"ghi đè {num_rows} dòng" if paste_mode == "Ghi đè" else f"ghi tiếp {num_rows} dòng"
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"📄 _Đã {action_text} từ file Return lên sheet '{escape_markdown(worksheet_name)}' \\(dòng {start_row}\\)_\\.\n" \
              f"File: `{telegram_path}`"
        execute_with_retry(send_telegram_message_wrapper, msg)
    except Exception as e:
        error_msg = f"Lỗi khi xử lý file Return. Chi tiết: {e}"
        logging.error(f"[{brand}] {error_msg}", exc_info=True)
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"💥 _Lỗi nghiêm trọng khi xử lý file Return_\n" \
              f"Lỗi: `{escape_markdown(e)}`"
        execute_with_retry(send_telegram_message_wrapper, msg)


def process_servicefee_file_and_upload(gc, profile_config, source_file_path):
    brand = profile_config["brand"]
    sheet_url = profile_config.get("ketoan_sheet_url")
    if not sheet_url:
        logging.error(f"[{brand}] Bỏ qua file Service Fee vì thiếu 'KetoanSheet' URL.")
        return
    worksheet_name = FILE04_UPLOAD_WORKSHEET_NAME
    logging.info(f"[{brand}] Bắt đầu xử lý file Service Fee: {source_file_path}")
    try:
        df = pd.read_csv(source_file_path, header=None)
        if df.shape[0] < 2:
            logging.warning(f"[{brand}] File Service Fee không có dữ liệu. Bỏ qua.")
            return

        last_row_date_str = df.iloc[-1, 0]
        try:
            target_date_obj = pd.to_datetime(last_row_date_str).date()
        except Exception as e:
            logging.error(f"[{brand}] Không thể phân tích ngày '{last_row_date_str}' từ file Service Fee. Lỗi: {e}")
            return

        worksheet = execute_with_retry(lambda: gc.open_by_url(sheet_url).worksheet(worksheet_name))
        logging.info(f"[{brand}] Đã kết nối tới sheet '{worksheet_name}'.")

        col_b_values = execute_with_retry(lambda: worksheet.col_values(2))
        start_row, paste_mode, last_row_with_data_in_col = -1, "Ghi đè", 0
        for i, cell_value in enumerate(col_b_values):
            if cell_value:
                last_row_with_data_in_col = i + 1
                try:
                    sheet_date_obj = pd.to_datetime(cell_value, dayfirst=True).date()
                    if sheet_date_obj == target_date_obj:
                        start_row = i + 1
                        break
                except Exception:
                    continue

        data_to_upload = df.iloc[1:].values.tolist()
        if not data_to_upload:
            logging.warning(f"[{brand}] Không có dữ liệu trong file Service Fee để dán. Bỏ qua.")
            return
        data_to_upload.reverse()
        num_rows = len(data_to_upload)

        if start_row != -1:
            logging.info(f"[{brand}] Tìm thấy ngày trùng khớp. Xóa dữ liệu cũ từ dòng {start_row} trở xuống.")
            range_to_clear = f'B{start_row}:L'
            execute_with_retry(worksheet.batch_clear, [range_to_clear])
            logging.info(f"[{brand}] Đã xóa dữ liệu cũ trong vùng {range_to_clear}.")
        else:
            paste_mode = "Ghi tiếp"
            start_row = last_row_with_data_in_col + 1
            required_rows = start_row + num_rows - 1
            if required_rows > worksheet.row_count:
                rows_to_add = required_rows - worksheet.row_count
                execute_with_retry(worksheet.add_rows, rows_to_add)
                logging.info(
                    f"[{brand}] Đã thêm {rows_to_add} dòng vào sheet '{worksheet_name}'.")

        logging.info(
            f"[{brand}] Sẽ {paste_mode.lower()} {num_rows} dòng vào sheet '{worksheet_name}' từ ô B{start_row}")
        range_to_update = f'B{start_row}'
        execute_with_retry(worksheet.update, values=data_to_upload, range_name=range_to_update,
                           value_input_option='USER_ENTERED')
        logging.info(f"[{brand}] Đã {paste_mode.lower()} {num_rows} dòng file Service Fee thành công.")

        end_row = start_row + num_rows - 1

        format_body_pasted_range = {"requests": [{"repeatCell": {
            "range": {"sheetId": worksheet.id, "startRowIndex": start_row - 1, "endRowIndex": end_row,
                      "startColumnIndex": 1, "endColumnIndex": 2},
            "cell": {"userEnteredFormat": {"numberFormat": {"type": "DATE", "pattern": "dd/mm/yyyy"}}},
            "fields": "userEnteredFormat.numberFormat"
        }}]}
        execute_with_retry(worksheet.spreadsheet.batch_update, format_body_pasted_range)
        logging.info(f"[{brand}] Đã áp dụng lại định dạng ngày cho vùng B{start_row}:B{end_row} vừa dán.")

        brand_column_range = f'L{start_row}:L{end_row}'
        brand_column_values = [[brand.upper()]] * num_rows
        execute_with_retry(worksheet.update, values=brand_column_values, range_name=brand_column_range,
                           value_input_option='USER_ENTERED')

        if paste_mode == "Ghi tiếp" and last_row_with_data_in_col > 0:
            body = {"requests": [{"copyPaste": {
                "source": {"sheetId": worksheet.id, "startRowIndex": last_row_with_data_in_col - 1,
                           "endRowIndex": last_row_with_data_in_col},
                "destination": {"sheetId": worksheet.id, "startRowIndex": start_row - 1, "endRowIndex": end_row},
                "pasteType": "PASTE_FORMAT", "pasteOrientation": "NORMAL"}}]}
            execute_with_retry(worksheet.spreadsheet.batch_update, body)
            logging.info(f"[{brand}] Đã sao chép định dạng cho sheet Service Fee thành công.")

        telegram_path = source_file_path.replace('\\', '\\\\')
        action_text = f"ghi đè {num_rows} dòng" if paste_mode == "Ghi đè" else f"ghi tiếp {num_rows} dòng"
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"📄 _Đã {action_text} từ file Service Fee lên sheet '{escape_markdown(worksheet_name)}' \\(dòng {start_row}\\)_\\.\n" \
              f"File: `{telegram_path}`"
        execute_with_retry(send_telegram_message_wrapper, msg)
    except Exception as e:
        error_msg = f"Lỗi khi xử lý file Service Fee. Chi tiết: {e}"
        logging.error(f"[{brand}] {error_msg}", exc_info=True)
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"💥 _Lỗi nghiêm trọng khi xử lý file Service Fee_\n" \
              f"Lỗi: `{escape_markdown(e)}`"
        execute_with_retry(send_telegram_message_wrapper, msg)


def get_required_campaign_headers(gc_read):
    """Lấy danh sách các header cần thiết cho file Campaign từ sheet cấu hình."""
    try:
        logging.info(
            f"Đang đọc cấu hình các cột cần thiết cho file Campaign ({FILE05_HEADER_CONFIG_WORKSHEET_NAME})...")
        config_sheet = execute_with_retry(
            lambda: gc_read.open_by_url(BRANDS_SPREADSHEET_URL).worksheet(FILE05_HEADER_CONFIG_WORKSHEET_NAME))

        header_row = execute_with_retry(lambda: config_sheet.row_values(1))
        header_to_find = FILE05_HEADER_CONFIG_COLUMN

        try:
            col_index = header_row.index(header_to_find) + 1
        except ValueError:
            logging.error(
                f"Không tìm thấy header '{header_to_find}' trong dòng đầu tiên của sheet '{FILE05_HEADER_CONFIG_WORKSHEET_NAME}'.")
            msg = f"*{escape_markdown(SCRIPT_NAME)}*\n" \
                  f"💥 _Lỗi: Không tìm thấy cột `{escape_markdown(header_to_find)}` trong sheet cấu hình `{escape_markdown(FILE05_HEADER_CONFIG_WORKSHEET_NAME)}`\\._"
            execute_with_retry(send_telegram_message_wrapper, msg)
            return None

        required_headers = execute_with_retry(lambda: config_sheet.col_values(col_index)[1:])
        required_headers = [header.strip() for header in required_headers if header.strip()]

        if not required_headers:
            logging.error(
                f"Không tìm thấy header nào trong cột '{header_to_find}' của sheet '{FILE05_HEADER_CONFIG_WORKSHEET_NAME}'.")
            msg = f"*{escape_markdown(SCRIPT_NAME)}*\n" \
                  f"⚠️ _Cảnh báo: Không có dữ liệu trong cột `{escape_markdown(header_to_find)}` của sheet `{escape_markdown(FILE05_HEADER_CONFIG_WORKSHEET_NAME)}`\\._"
            execute_with_retry(send_telegram_message_wrapper, msg)
            return None

        logging.info(
            f"Đã đọc được {len(required_headers)} cột cần thiết từ cột '{header_to_find}': {', '.join(required_headers)}")
        return required_headers
    except gspread.exceptions.WorksheetNotFound:
        logging.error(f"Không tìm thấy sheet '{FILE05_HEADER_CONFIG_WORKSHEET_NAME}' trong spreadsheet cấu hình.",
                      exc_info=True)
        msg = f"*{escape_markdown(SCRIPT_NAME)}*\n" \
              f"💥 _Lỗi: Không tìm thấy sheet `{escape_markdown(FILE05_HEADER_CONFIG_WORKSHEET_NAME)}` trong spreadsheet cấu hình\\._"
        execute_with_retry(send_telegram_message_wrapper, msg)
        return None
    except Exception as e:
        logging.error(f"Lỗi nghiêm trọng khi đọc sheet '{FILE05_HEADER_CONFIG_WORKSHEET_NAME}': {e}", exc_info=True)
        msg = f"*{escape_markdown(SCRIPT_NAME)}*\n" \
              f"💥 _Lỗi nghiêm trọng khi đọc cấu hình cột Campaign ({escape_markdown(FILE05_HEADER_CONFIG_WORKSHEET_NAME)})_\n" \
              f"Lỗi: `{escape_markdown(e)}`"
        execute_with_retry(send_telegram_message_wrapper, msg)
        return None


def process_campaigns_file_and_upload(gc, gc_read, profile_config, source_file_path):
    brand = profile_config["brand"]
    sheet_url = profile_config.get("checklist_sheet_url")
    if not sheet_url:
        logging.error(f"[{brand}] Bỏ qua file Campaigns vì thiếu 'checklistmktSheet' URL.")
        return
    worksheet_name = FILE05_UPLOAD_WORKSHEET_NAME
    logging.info(f"[{brand}] Bắt đầu xử lý file Campaigns: {source_file_path}")

    required_headers = get_required_campaign_headers(gc_read)
    if not required_headers:
        logging.error(f"[{brand}] Không thể lấy danh sách cột cần thiết. Dừng xử lý file Campaigns cho brand này.")
        return

    try:
        df_source = pd.read_csv(source_file_path, header=0)
        if df_source.empty:
            logging.warning(f"[{brand}] File Campaigns CSV rỗng. Bỏ qua.")
            return

        # --- BẮT ĐẦU CHỈNH SỬA ---
        # Thêm 2 dòng này để tự động xóa 'US$' trong toàn bộ DataFrame
        logging.info(f"[{brand}] [File 05] Bắt đầu làm sạch tiền tệ (xóa 'US$')...")
        df_source.replace(to_replace=r'US\$', value='', regex=True, inplace=True)
        # --- KẾT THÚC CHỈNH SỬA ---

        worksheet = execute_with_retry(lambda: gc.open_by_url(sheet_url).worksheet(worksheet_name))
        logging.info(f"[{brand}] Đã kết nối tới sheet '{worksheet_name}'.")

        target_headers_full = execute_with_retry(lambda: worksheet.row_values(2))
        if not target_headers_full or len(target_headers_full) < 2:
            logging.error(f"[{brand}] Không thể đọc được header từ dòng 1 của sheet '{worksheet_name}'. Dừng xử lý.")
            msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
                  f" _Lỗi: Không đọc được header của sheet `{escape_markdown(worksheet_name)}`\\._"
            execute_with_retry(send_telegram_message_wrapper, msg)
            return

        target_headers_for_data = target_headers_full[1:]
        df_upload = pd.DataFrame(index=df_source.index, columns=target_headers_for_data)

        source_columns = df_source.columns
        for col_name in required_headers:
            if col_name in source_columns and col_name in df_upload.columns:
                df_upload[col_name] = df_source[col_name]
                logging.info(f"[{brand}] Đã lấy dữ liệu cho cột '{col_name}'.")
            elif col_name not in source_columns:
                logging.warning(f"[{brand}] Cột yêu cầu '{col_name}' không tồn tại trong file nguồn. Bỏ qua.")
            elif col_name not in df_upload.columns:
                logging.warning(f"[{brand}] Cột yêu cầu '{col_name}' không tồn tại trong sheet đích. Bỏ qua.")

        df_upload.replace(np.nan, '', inplace=True)
        data_to_upload = df_upload.values.tolist()
        num_rows = len(data_to_upload)

        if num_rows == 0:
            logging.warning(f"[{brand}] Sau khi lọc, không có dữ liệu nào để tải lên. Bỏ qua.")
            return

        col_values = execute_with_retry(lambda: worksheet.col_values(2))
        last_row_with_data = len(col_values)

        if last_row_with_data + num_rows > worksheet.row_count:
            rows_to_add = (last_row_with_data + num_rows) - worksheet.row_count
            execute_with_retry(worksheet.add_rows, rows_to_add)
            logging.info(f"[{brand}] Đã thêm {rows_to_add} dòng mới vào sheet '{worksheet_name}'.")

        target_row = last_row_with_data + 1
        logging.info(
            f"[{brand}] Sẽ dán {num_rows} dòng dữ liệu Campaigns (đã lọc) vào sheet '{worksheet_name}' từ ô B{target_row}")

        data_range = f'B{target_row}'
        execute_with_retry(worksheet.update, values=data_to_upload, range_name=data_range,
                           value_input_option='USER_ENTERED')
        logging.info(f"[{brand}] Đã dán dữ liệu Campaigns (đã lọc) thành công.")

        end_row = target_row + num_rows - 1
        try:
            filename_only = os.path.basename(source_file_path)
            date_part = filename_only.split('_')[-3:]
            date_str_from_filename = f"{date_part[0]} {date_part[1]} {date_part[2].split('.')[0]}"
            date_obj = datetime.strptime(date_str_from_filename, '%b %d %Y')
            new_date_str = date_obj.strftime('%m/%d/%Y')
        except Exception:
            new_date_str = datetime.now(VN_TZ).strftime('%m/%d/%Y')

        date_column_range = f'A{target_row}:A{end_row}'
        date_column_values = [[new_date_str]] * num_rows
        execute_with_retry(worksheet.update, values=date_column_values, range_name=date_column_range,
                           value_input_option='USER_ENTERED')

        telegram_path = source_file_path.replace('\\', '\\\\')
        message_part = f"Đã đẩy {num_rows} dòng từ file Campaigns (đã lọc) lên sheet '{worksheet_name}'"
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"📄 _{escape_markdown(message_part)}_\\.\n" \
              f"File: `{telegram_path}`"
        execute_with_retry(send_telegram_message_wrapper, msg)
    except Exception as e:
        error_msg = f"Lỗi khi xử lý file Campaigns. Chi tiết: {e}"
        logging.error(f"[{brand}] {error_msg}", exc_info=True)
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"💥 _Lỗi nghiêm trọng khi xử lý file Campaigns_\n" \
              f"Lỗi: `{escape_markdown(e)}`"
        execute_with_retry(send_telegram_message_wrapper, msg)


def process_inventory_file_and_upload(gc, profile_config, source_file_path):
    """Xử lý và đẩy lên sheet riêng của brand."""
    brand = profile_config["brand"]
    sheet_url = profile_config.get("checklist_sheet_url")
    if not sheet_url:
        logging.error(f"[{brand}] Bỏ qua file Inventory (sheet riêng) vì thiếu 'checklistmktSheet' URL.")
        return
    worksheet_name = FILE06_UPLOAD_WORKSHEET_NAME
    logging.info(f"[{brand}] Bắt đầu xử lý file Inventory cho sheet riêng: {source_file_path}")
    try:
        df = pd.read_csv(source_file_path, sep='\t', header=0, dtype=str)
        if df.empty:
            logging.warning(f"[{brand}] File Inventory rỗng. Bỏ qua.")
            return
        df.replace(np.nan, '', inplace=True)
        num_rows = df.shape[0]
        data_to_upload = df.values.tolist()

        worksheet = execute_with_retry(lambda: gc.open_by_url(sheet_url).worksheet(worksheet_name))
        logging.info(f"[{brand}] Đã kết nối tới sheet riêng '{worksheet_name}'.")

        col_values = execute_with_retry(lambda: worksheet.col_values(3))
        last_row_with_data = len(col_values)
        if last_row_with_data + num_rows > worksheet.row_count:
            execute_with_retry(worksheet.add_rows, num_rows)
            logging.info(f"[{brand}] Đã thêm {num_rows} dòng mới vào sheet riêng.")

        target_row = last_row_with_data + 1
        logging.info(f"[{brand}] Sẽ dán {num_rows} dòng vào sheet RIÊNG '{worksheet_name}' từ ô C{target_row}")
        data_range = f'C{target_row}'
        execute_with_retry(worksheet.update, values=data_to_upload, range_name=data_range,
                           value_input_option='USER_ENTERED')

        end_row = target_row + num_rows - 1
        brand_column_range = f'B{target_row}:B{end_row}'
        brand_column_values = [[brand.upper()]] * num_rows
        execute_with_retry(worksheet.update, values=brand_column_values, range_name=brand_column_range,
                           value_input_option='USER_ENTERED')

        if last_row_with_data > 0:
            body = {"requests": [{"copyPaste": {
                "source": {"sheetId": worksheet.id, "startRowIndex": last_row_with_data - 1,
                           "endRowIndex": last_row_with_data},
                "destination": {"sheetId": worksheet.id, "startRowIndex": target_row - 1, "endRowIndex": end_row},
                "pasteType": "PASTE_FORMAT", "pasteOrientation": "NORMAL"}}]}
            execute_with_retry(worksheet.spreadsheet.batch_update, body)
            logging.info(f"[{brand}] Đã sao chép định dạng cho sheet Inventory riêng.")

        telegram_path = source_file_path.replace('\\', '\\\\')
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"📄 _Đã đẩy {num_rows} dòng từ file Inventory lên sheet RIÊNG '{escape_markdown(worksheet_name)}'_\\.\n" \
              f"File: `{telegram_path}`"
        execute_with_retry(send_telegram_message_wrapper, msg)
    except Exception as e:
        error_msg = f"Lỗi khi xử lý file Inventory cho sheet riêng. Chi tiết: {e}"
        logging.error(f"[{brand}] {error_msg}", exc_info=True)
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"💥 _Lỗi nghiêm trọng khi xử lý file Inventory (sheet riêng)_\n" \
              f"Lỗi: `{escape_markdown(e)}`"
        execute_with_retry(send_telegram_message_wrapper, msg)


def upload_to_master_inventory_sheet(gc, source_file_path, brand):
    """Xử lý và đẩy lên sheet TỔNG HỢP."""
    worksheet_name = MASTER_SHEET_INVENTORY_NAME
    logging.info(f"[{brand}] Bắt đầu upload Inventory lên sheet TỔNG: {worksheet_name}")
    try:
        df = pd.read_csv(source_file_path, sep='\t', header=0, dtype=str)
        if df.empty:
            logging.warning(f"[{brand}] File Inventory rỗng cho sheet tổng. Bỏ qua.")
            return
        df.replace(np.nan, '', inplace=True)
        num_rows = df.shape[0]
        data_to_upload = df.values.tolist()

        worksheet = execute_with_retry(lambda: gc.open_by_url(MASTER_SHEET_URL).worksheet(worksheet_name))
        logging.info(f"[{brand}] Đã kết nối tới sheet tổng '{worksheet_name}'.")

        col_values = execute_with_retry(lambda: worksheet.col_values(2))
        last_row_with_data = len(col_values)
        if last_row_with_data + num_rows > worksheet.row_count:
            execute_with_retry(worksheet.add_rows, num_rows)
            logging.info(f"[{brand}] Đã thêm {num_rows} dòng vào sheet tổng.")

        target_row = last_row_with_data + 1
        logging.info(f"[{brand}] Sẽ dán {num_rows} dòng vào sheet TỔNG '{worksheet_name}' từ ô B{target_row}")
        data_range = f'B{target_row}'
        execute_with_retry(worksheet.update, values=data_to_upload, range_name=data_range,
                           value_input_option='USER_ENTERED')

        end_row = target_row + num_rows - 1
        brand_column_range = f'A{target_row}:A{end_row}'
        brand_column_values = [[brand.upper()]] * num_rows
        execute_with_retry(worksheet.update, values=brand_column_values, range_name=brand_column_range,
                           value_input_option='USER_ENTERED')

        if last_row_with_data > 0:
            body = {"requests": [{"copyPaste": {
                "source": {"sheetId": worksheet.id, "startRowIndex": last_row_with_data - 1,
                           "endRowIndex": last_row_with_data},
                "destination": {"sheetId": worksheet.id, "startRowIndex": target_row - 1, "endRowIndex": end_row},
                "pasteType": "PASTE_FORMAT", "pasteOrientation": "NORMAL"}}]}
            execute_with_retry(worksheet.spreadsheet.batch_update, body)
            logging.info(f"[{brand}] Đã sao chép định dạng cho sheet Inventory tổng.")

        logging.info(f"[{brand}] Upload {num_rows} dòng Inventory lên sheet tổng thành công.")
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"📈 _Đã đẩy {num_rows} dòng từ file Inventory lên sheet TỔNG HỢP_\\."
        execute_with_retry(send_telegram_message_wrapper, msg)
    except Exception as e:
        error_msg = f"Lỗi khi upload Inventory của brand {brand} lên sheet tổng. Chi tiết: {e}"
        logging.error(f"[{brand}] {error_msg}", exc_info=True)
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"💥 _Lỗi nghiêm trọng khi upload Inventory lên sheet tổng_\n" \
              f"Lỗi: `{escape_markdown(e)}`"
        execute_with_retry(send_telegram_message_wrapper, msg)


def process_shipment_file_and_upload(gc, profile_config, source_file_path):
    """
    Xử lý File 07: SHIPMENT - ÁP DỤNG LOGIC CHECK & ADD ROW CHUẨN CỦA FILE 06
    """
    brand = profile_config["brand"]
    worksheet_name = MASTER_SHEET_SHIPMENT_NAME

    logging.info(f"[{brand}] Bắt đầu xử lý file Shipment: {source_file_path}")

    try:
        # 1. Đọc file CSV
        df = pd.read_csv(source_file_path, header=0, dtype=str)
        if df.empty:
            logging.warning(f"[{brand}] File Shipment rỗng. Bỏ qua.")
            return

        # 2. Kết nối Sheet Master
        worksheet = execute_with_retry(lambda: gc.open_by_url(MASTER_SHEET_URL).worksheet(worksheet_name))
        logging.info(f"[{brand}] Đã kết nối tới sheet tổng '{worksheet_name}'.")

        # --- TÌM CỘT CHECK TRÙNG (HEADER DYNAMIC) ---
        sheet_headers = execute_with_retry(lambda: worksheet.row_values(1))
        target_header = "Shipment ID"

        if target_header not in sheet_headers:
            logging.error(f"[{brand}] Lỗi: Không tìm thấy cột '{target_header}' trên Master.")
            msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
                  f"💥 _Lỗi: Sheet Master thiếu cột `{escape_markdown(target_header)}`\\._"
            execute_with_retry(send_telegram_message_wrapper, msg)
            return

        shipment_id_col_index = sheet_headers.index(target_header) + 1
        existing_ids_list = execute_with_retry(lambda: worksheet.col_values(shipment_id_col_index))

        # --- FIX LỖI NONETYPE (Nếu mạng lỗi quá nặng trả về None) ---
        if existing_ids_list is None:
            logging.warning(f"[{brand}] Không lấy được danh sách Shipment ID (API trả về None). Bỏ qua bước xóa trùng.")
            existing_ids_list = []  # Gán list rỗng để tránh lỗi ở vòng lặp bên dưới

        # --- XÓA TRÙNG (Giữ nguyên logic xóa cần thiết) ---
        if target_header in df.columns:
            csv_ids = set(df[target_header].astype(str).tolist())
            rows_to_delete = []
            for i, val in enumerate(existing_ids_list):
                val_str = str(val).strip()
                if val_str in csv_ids and val_str != target_header:
                    rows_to_delete.append(i + 1)

            if rows_to_delete:
                logging.info(f"[{brand}] Đang xóa {len(rows_to_delete)} dòng trùng lặp...")
                _fast_delete_rows(worksheet, rows_to_delete)
                logging.info(f"[{brand}] Đã xóa xong dữ liệu cũ.")

                # ===========================================================
                # 🔥🔥🔥 THÊM DÒNG NÀY VÀO ĐÂY ĐỂ FIX LỖI 🔥🔥🔥
                # Reload lại worksheet để cập nhật row_count mới nhất từ Google
                worksheet = execute_with_retry(lambda: gc.open_by_url(MASTER_SHEET_URL).worksheet(worksheet_name))
                # ===========================================================

        # 3. Chuẩn bị dữ liệu upload
        df.replace(np.nan, '', inplace=True)
        num_rows = df.shape[0]
        data_to_upload = df.values.tolist()

        # ==============================================================================
        # --- BẮT ĐẦU LOGIC CHECK & ADD ROW (COPY TỪ FILE 06 - upload_to_master_inventory_sheet) ---
        # ==============================================================================

        # B1: Lấy lại dữ liệu cột để xác định dòng cuối chính xác sau khi xóa
        col_values = execute_with_retry(lambda: worksheet.col_values(shipment_id_col_index))
        last_row_with_data = len(col_values)

        # B2: Check data cột B phòng hờ (để chắc chắn last row đúng nhất)
        if last_row_with_data < 2:
            col_b = execute_with_retry(lambda: worksheet.col_values(2))
            last_row_with_data = max(last_row_with_data, len(col_b))

        # B3: So sánh và Add rows (Y HỆT FILE 06)
        # Logic: Nếu chỗ cần ghi (last_row + new) tràn ra ngoài row_count -> Add thêm
        if last_row_with_data + num_rows > worksheet.row_count:
            logging.info(f"[{brand}] Sheet không đủ chỗ. Đang thêm {num_rows} dòng (theo logic File 06)...")
            execute_with_retry(worksheet.add_rows, num_rows)
            logging.info(f"[{brand}] Đã thêm {num_rows} dòng mới.")

        target_row = last_row_with_data + 1
        logging.info(f"[{brand}] Sẽ dán {num_rows} dòng MỚI vào MASTER từ dòng {target_row}.")

        # ==============================================================================
        # --- KẾT THÚC LOGIC FILE 06 ---
        # ==============================================================================

        # 4. Dán dữ liệu
        data_range = f'C{target_row}'
        execute_with_retry(worksheet.update, values=data_to_upload, range_name=data_range,
                           value_input_option='USER_ENTERED')

        # 5. Điền Brand (Cột B)
        end_row = target_row + num_rows - 1
        brand_column_range = f'B{target_row}:B{end_row}'
        brand_column_values = [[brand.upper()]] * num_rows
        execute_with_retry(worksheet.update, values=brand_column_values, range_name=brand_column_range,
                           value_input_option='USER_ENTERED')

        # 6. Copy Format
        if last_row_with_data > 1:
            try:
                body = {"requests": [{"copyPaste": {
                    "source": {"sheetId": worksheet.id, "startRowIndex": last_row_with_data - 1,
                               "endRowIndex": last_row_with_data},
                    "destination": {"sheetId": worksheet.id, "startRowIndex": target_row - 1, "endRowIndex": end_row},
                    "pasteType": "PASTE_FORMAT", "pasteOrientation": "NORMAL"}}]}
                execute_with_retry(worksheet.spreadsheet.batch_update, body)
            except Exception as e:
                logging.warning(f"Lỗi copy format (không ảnh hưởng data): {e}")

        # Báo cáo Telegram
        telegram_path = source_file_path.replace('\\', '\\\\')
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"🆕 _Đã bổ sung {num_rows} shipments MỚI vào MASTER_\n" \
              f"File: `{telegram_path}`"
        execute_with_retry(send_telegram_message_wrapper, msg)

    except Exception as e:
        error_msg = f"Lỗi khi xử lý file Shipment. Chi tiết: {e}"
        logging.error(f"[{brand}] {error_msg}", exc_info=True)
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(brand)}*\n" \
              f"💥 _Lỗi nghiêm trọng khi xử lý file Shipment_\n" \
              f"Lỗi: `{escape_markdown(e)}`"
        execute_with_retry(send_telegram_message_wrapper, msg)


# --- LUỒNG XỬ LÝ CHÍNH ---

if __name__ == "__main__":
    start_msg = f"🚀 *{escape_markdown(SCRIPT_NAME)}* \\- _Bắt đầu chạy script tổng hợp_"
    execute_with_retry(send_telegram_message_wrapper, start_msg)
    logging.info(f"{'=' * 25} BẮT ĐẦU SCRIPT TỔNG HỢP: {SCRIPT_NAME.upper()} {'=' * 25}")

    overall_start_time = time.time()

    # 1. Lấy cấu hình (Dùng Key Read - đã sửa ở Bước 2)
    profile_configs = get_profile_configs()

    # 2. Tạo Client Ghi (Dùng Key Read) để pass vào các hàm xử lý
    try:
        scope = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]

        # 1. Khởi tạo Key GHI (như cũ)
        creds_write = ServiceAccountCredentials.from_json_keyfile_name(GOOGLE_API_KEYFILE_WRITE, scope)
        gc_instance = gspread.authorize(creds_write)
        logging.info("Đã khởi tạo Google Client với quyền GHI (Key cũ).")

        # 2. Khởi tạo Key ĐỌC (MỚI - Thêm đoạn này)
        creds_read = ServiceAccountCredentials.from_json_keyfile_name(GOOGLE_API_KEYFILE_READ, scope)
        gc_read_instance = gspread.authorize(creds_read)
        logging.info("Đã khởi tạo Google Client với quyền ĐỌC (Key mới).")

    except Exception as e:
        logging.critical(f"Không thể khởi tạo Google Client: {e}")
        exit()

    if not profile_configs or not gc_instance:
        logging.critical("Không thể lấy cấu hình profiles hoặc khởi tạo Client. Dừng script.")
        exit()

    now_vn = datetime.now(VN_TZ)
    target_date = now_vn.date() - timedelta(days=(2 if now_vn.hour < 15 else 1))
    date_in_filename = target_date.strftime('%b_%d_%Y')
    logging.info(f"Script sẽ tìm các file có ngày: {date_in_filename}")

    logging.info(f"{'-' * 20} GIAI ĐOẠN 1: KIỂM TRA FILE CỦA TẤT CẢ PROFILE {'-' * 20}")

    profiles_to_process = []
    total_profiles = len(profile_configs)

    for i, profile in enumerate(profile_configs):
        brand_name = profile["brand"]
        logging.info(f"--- Đang kiểm tra profile {i + 1}/{total_profiles}: {brand_name} ---")

        file_paths = {
            "file01": os.path.join(SOURCE_ROOT_DIR, brand_name, FILE01_INPUT_SUBFOLDER,
                                   FILE01_INPUT_FILENAME_FORMAT.format(brand=brand_name, date=date_in_filename)),
            "file02": os.path.join(SOURCE_ROOT_DIR, brand_name, FILE02_INPUT_SUBFOLDER,
                                   FILE02_INPUT_FILENAME_FORMAT.format(brand=brand_name, date=date_in_filename)),
            "file03": os.path.join(SOURCE_ROOT_DIR, brand_name, FILE03_INPUT_SUBFOLDER,
                                   FILE03_INPUT_FILENAME_FORMAT.format(brand=brand_name, date=date_in_filename)),
            "file04": os.path.join(SOURCE_ROOT_DIR, brand_name, FILE04_INPUT_SUBFOLDER,
                                   FILE04_INPUT_FILENAME_FORMAT.format(brand=brand_name, date=date_in_filename)),
            "file05": os.path.join(SOURCE_ROOT_DIR, brand_name, FILE05_INPUT_SUBFOLDER,
                                   FILE05_INPUT_FILENAME_FORMAT.format(brand=brand_name, date=date_in_filename)),
            "file06": os.path.join(SOURCE_ROOT_DIR, brand_name, FILE06_INPUT_SUBFOLDER,
                                   FILE06_INPUT_FILENAME_FORMAT.format(brand=brand_name, date=date_in_filename)),
            "file07": os.path.join(SOURCE_ROOT_DIR, brand_name, FILE07_INPUT_SUBFOLDER,
                                   FILE07_INPUT_FILENAME_FORMAT.format(brand=brand_name, date=date_in_filename)),
        }

        file_status = {key: os.path.exists(path) for key, path in file_paths.items()}
        profiles_to_process.append({"profile": profile, "paths": file_paths, "status": file_status})

        status_lines, found_count = [], 0
        for file_key, found in file_status.items():
            status_lines.append(f"✅ _{file_key}_" if found else f"❌ _{file_key}_")
            if found: found_count += 1

        status_message = "\n".join(status_lines)
        telegram_path_check_msg = (f"🔍 *Kiểm tra file cho brand: {escape_markdown(brand_name)}*\n"
                                   f"*Ngày file*: `{escape_markdown(date_in_filename)}`\n"
                                   f"*Kết quả* \\({found_count}/{len(file_status)}\\):\n"
                                   f"{status_message}")
        execute_with_retry(send_telegram_message_wrapper, telegram_path_check_msg)
        time.sleep(1)

    logging.info(f"{'-' * 20} GIAI ĐOẠN 2: XỬ LÝ VÀ UPLOAD DỮ LIỆU {'-' * 20}")

    push_start_msg = f"📤 *Chuẩn bị xử lý và push dữ liệu cho {len(profiles_to_process)} profiles\\.*"
    execute_with_retry(send_telegram_message_wrapper, push_start_msg)

    for item in profiles_to_process:
        profile, paths, status = item["profile"], item["paths"], item["status"]
        brand_name = profile["brand"]
        logging.info(f"--- Bắt đầu xử lý và upload cho brand: {brand_name} ---")

        # --- XỬ LÝ BÌNH THƯỜNG (FBA) ---
        if PROCESS_FILE_01 and status["file01"]: process_portfolio_file_and_upload(gc_instance, profile,
                                                                                   paths["file01"])

        # --- FILE 02 & HISTORICAL UPDATE ---
        if PROCESS_FILE_02 and status["file02"]:
            process_all_orders_file_and_upload(gc_instance, profile, paths["file02"])
            # Cập nhật dữ liệu lịch sử (Target Date - 3)
            past_date = target_date - timedelta(days=3)
            process_historical_orders_file_and_upload(gc_instance, profile, past_date)

        if PROCESS_FILE_03 and status["file03"]: process_return_file_and_upload(gc_instance, profile, paths["file03"])
        if PROCESS_FILE_04 and status["file04"]: process_servicefee_file_and_upload(gc_instance, profile,
                                                                                    paths["file04"])
        if PROCESS_FILE_05 and status["file05"]:
            process_campaigns_file_and_upload(gc_instance, gc_read_instance, profile, paths["file05"])
            logging.info(f"[{brand_name}] Nghỉ 5s sau File 05 để hồi Quota...")
            time.sleep(5)

        if PROCESS_FILE_06 and status["file06"]:
            process_inventory_file_and_upload(gc_instance, profile, paths["file06"])
            time.sleep(2)
            upload_to_master_inventory_sheet(gc_instance, paths["file06"], brand_name)
            logging.info(f"[{brand_name}] Nghỉ 5s sau File 06 để hồi Quota...")
            time.sleep(5)

        if PROCESS_FILE_07 and status["file07"]:
            process_shipment_file_and_upload(gc_instance, profile, paths["file07"])
            time.sleep(2)

        # --- XỬ LÝ FBM DỰA TRÊN CÔNG TẮC RIÊNG ---
        if PROCESS_FBM:
            fbm_status = str(profile.get("fbm_status", "")).strip().upper()
            fbm_sheet_url = profile.get("fbm_sheet_url", "")

            if fbm_status == 'YES' and fbm_sheet_url:
                logging.info(f"--- [FBM] Bắt đầu xử lý FBM cho brand: {brand_name} ---")

                fbm_profile = profile.copy()
                fbm_profile['ketoan_sheet_url'] = fbm_sheet_url
                fbm_profile['checklist_sheet_url'] = fbm_sheet_url

                if PROCESS_FBM_FILE_01 and status["file01"]: process_portfolio_file_and_upload(gc_instance, fbm_profile,
                                                                                               paths["file01"])
                if PROCESS_FBM_FILE_02 and status["file02"]:
                    process_all_orders_file_and_upload(gc_instance, fbm_profile, paths["file02"])
                    # Cập nhật dữ liệu lịch sử FBM
                    past_date = target_date - timedelta(days=3)
                    process_historical_orders_file_and_upload(gc_instance, fbm_profile, past_date)

                if PROCESS_FBM_FILE_03 and status["file03"]: process_return_file_and_upload(gc_instance, fbm_profile,
                                                                                            paths["file03"])
                if PROCESS_FBM_FILE_04 and status["file04"]: process_servicefee_file_and_upload(gc_instance,
                                                                                                fbm_profile,
                                                                                                paths["file04"])
                if PROCESS_FBM_FILE_05 and status["file05"]: process_campaigns_file_and_upload(gc_instance, gc_read_instance, fbm_profile,
                                                                                               paths["file05"])
                if PROCESS_FBM_FILE_06 and status["file06"]:
                    process_inventory_file_and_upload(gc_instance, fbm_profile, paths["file06"])

                if PROCESS_FBM_FILE_07 and status["file07"]:
                    process_shipment_file_and_upload(gc_instance, fbm_profile, paths["file07"])

                logging.info(f"--- [FBM] Hoàn thành xử lý FBM cho brand: {brand_name} ---")
            else:
                logging.info(f"[{brand_name}] Bỏ qua xử lý FBM (Cờ FBM không phải 'YES' hoặc thiếu URL).")

        logging.info(f"--- Hoàn thành xử lý và upload cho brand: {brand_name} ---")

    logging.info(f"{'-' * 20} GIAI ĐOẠN 3: TỔNG KẾT {'-' * 20}")

    total_time = time.time() - overall_start_time
    minutes, seconds = divmod(total_time, 60)
    time_str = f"{int(minutes)} phút {int(seconds)} giây"
    final_message = f"✅ *{escape_markdown(SCRIPT_NAME)}* \\- _Hoàn thành tất cả_\n" \
                    f"Đã kiểm tra và xử lý: `{total_profiles}/{total_profiles}` profiles\n" \
                    f"Tổng thời gian: `{escape_markdown(time_str)}`"
    execute_with_retry(send_telegram_message_wrapper, final_message)
    logging.info(f"HOÀN THÀNH. Đã xử lý {total_profiles}/{total_profiles} profiles. Tổng thời gian: {time_str}")
    logging.info(f"{'=' * 28} KẾT THÚC SCRIPT {'=' * 28}")