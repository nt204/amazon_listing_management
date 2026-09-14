import pandas as pd
import os
from datetime import datetime
from openpyxl import load_workbook
from openpyxl.styles import PatternFill, Font
import re
import logging
import time
import requests
from urllib.parse import quote
from multiprocessing import Pool, freeze_support
import pytz
import gspread
from oauth2client.service_account import ServiceAccountCredentials

# --- CẤU HÌNH ---

# Thiết lập logging
VN_TZ = pytz.timezone('Asia/Ho_Chi_Minh')
current_date = datetime.now(VN_TZ).strftime("%Y%m%d")
log_file = f"E:\\PythonProject1\\Amzdata-03-searchterm-{current_date}.txt"

# Xóa log cũ trước khi chạy để đảm bảo kiểm tra file chính xác
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
TOPIC_ID = 1149
TELEGRAM_PROXY_URL = "https://nce-telegram-proxy.ntthanhnce.workers.dev"
SCRIPT_NAME = "Amz-03-searchterm"

# Định nghĩa đường dẫn
# input_base_directory = r"\\Nceglobal\design tong hop\1. DỮ LIỆU PPC\DỮ LIỆU ĐẦU VÀO"
input_base_directory = r"E:\PPC\DỮ LIỆU ĐẦU VÀO"
# output_base_directory = r"\\Nceglobal\design tong hop\1. DỮ LIỆU PPC\DỮ LIỆU ĐẦU RA"
output_base_directory = r"E:\PPC\DỮ LIỆU ĐẦU RA"

# Thêm cấu hình Google Sheet nếu chưa có
GOOGLE_API_KEYFILE = r"E:\PythonProject1\NCE_googleapi.json"
SPREADSHEET_URL = "https://docs.google.com/spreadsheets/d/1CBZuKZOjG9zxNrfdh3qgeofkwW1758ruZl-yT77_IeI/edit?gid=0#gid=0"

# Cấu hình signature
USE_SIGNATURE = False
SIGNATURE = "Thanh"


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


def format_duration(seconds):
    minutes, seconds = divmod(seconds, 60)
    return f"{int(minutes)} phút {int(seconds)} giây"


def get_on_stores(keyfile, spreadsheet_url):
    """Lấy danh sách các store có Status là 'ON' từ Google Sheet."""
    try:
        scope = [
            "https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive",
            "https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive.file",
        ]
        creds = ServiceAccountCredentials.from_json_keyfile_name(keyfile, scope)
        client = gspread.authorize(creds)
        sheet = client.open_by_url(spreadsheet_url).worksheet("APBrand")
        records = sheet.get_all_records()
        on_stores = {row['BRAND'] for row in records if str(row.get('Status', '')).strip().upper() == 'ON'}
        logging.info(f"[SYSTEM] Các store có status 'ON' từ Google Sheet: {on_stores}")
        return on_stores
    except Exception as e:
        logging.error(f"[SYSTEM] Lỗi khi lấy danh sách store 'ON': {e}. Sẽ xử lý tất cả store tìm thấy.")
        return None


# --- CÁC HÀM CHỨC NĂNG ---

def find_date_column(df):
    possible_date_columns = ['date', 'date dabei', 'report date']
    for col in possible_date_columns:
        if col in df.columns:
            return col
    raise ValueError("Không tìm thấy cột ngày trong DataFrame")


def create_output_directory(output_base, store_name, range_day, report_type):
    folder_name = f"{current_date}-{SIGNATURE}" if USE_SIGNATURE else current_date
    date_directory = os.path.join(output_base, folder_name)
    os.makedirs(date_directory, exist_ok=True)
    store_directory = os.path.join(date_directory, store_name)
    os.makedirs(store_directory, exist_ok=True)
    range_directory = os.path.join(store_directory, range_day)
    os.makedirs(range_directory, exist_ok=True)
    current_time_str = datetime.now().strftime("%Y-%m-%d")
    final_directory = os.path.join(range_directory, f"Seachterm {report_type} {current_time_str}")
    os.makedirs(final_directory, exist_ok=True)
    return final_directory


def find_column(df, possible_names):
    for name in possible_names:
        if name in df.columns:
            return name
    return None


def format_and_calculate(file_path, report_type, store_name):
    try:
        # --- START: SỬA LỖI "At least one sheet must be visible" ---
        # Step 1: Đọc tất cả các sheet vào một dictionary trong bộ nhớ trước.
        all_sheets_dict = pd.read_excel(file_path, sheet_name=None)
        processed_sheets_data = {}

        # Step 2: Xử lý từng DataFrame trong bộ nhớ.
        for sheet_name, df in all_sheets_dict.items():
            df.columns = [str(col).strip().lower() for col in df.columns]

            try:
                date_col = find_date_column(df)
                df = df.sort_values(by=date_col, ascending=False)
            except ValueError:
                logging.warning(f"[{store_name}] Không tìm thấy cột ngày trong sheet {sheet_name}, bỏ qua sắp xếp.")
                processed_sheets_data[sheet_name] = df  # Lưu lại sheet không xử lý được
                continue

            sales_col = find_column(df, [
                '7 day total sales', '7 day total sales ', '14 day total sales', '14 day total sales ',
                '7 day total sales ($)', '14 day total sales ($)',
                '14-day total sales – (click)', '14 day total sales - (click)'
            ])
            orders_col = find_column(df, [
                '7 day total orders (#)', '14 day total orders (#)',
                '14-day total orders (#) – (click)', '14 day total orders (#) - (click)'
            ])
            units_col = find_column(df, [
                '7 day total units (#)', '14 day total units (#)',
                '14-day total units (#) – (click)', '14 day total units (#) - (click)'
            ])
            acos_col = find_column(df, [
                'total advertising cost of sales (acos)', 'advertising cost of sales (acos)',
                'total advertising cost of sales (acos) - (click)',
                'total advertising cost of sales (acos) – (click)'
            ])

            if not all([sales_col, orders_col, units_col, acos_col, 'impressions' in df.columns, 'clicks' in df.columns,
                        'spend' in df.columns]):
                logging.warning(
                    f"[{store_name}] Thiếu cột cần thiết trong sheet {sheet_name} của tệp {os.path.basename(file_path)}. Bỏ qua tính toán.")
                processed_sheets_data[sheet_name] = df  # Lưu lại sheet không xử lý được
                continue

            sum_total_sales = df[sales_col].sum()
            sum_total_orders = df[orders_col].sum()
            sum_total_units = df[units_col].sum()
            sum_impressions = df['impressions'].sum()
            sum_clicks = df['clicks'].sum()
            sum_spend = df['spend'].sum()

            cr_value = round(sum_total_orders / sum_clicks, 3) if sum_clicks > 0 else 0
            acos_value = round(sum_spend / sum_total_sales, 3) if sum_total_sales > 0 else 0
            cpc_value = round(sum_spend / sum_clicks, 3) if sum_clicks > 0 else 0

            sum_row = pd.Series({
                'impressions': sum_impressions, 'clicks': sum_clicks, 'spend': sum_spend,
                sales_col: sum_total_sales, 'click-thru rate (ctr)': cr_value,
                acos_col: acos_value, 'cost per click (cpc)': cpc_value,
                units_col: sum_total_units
            }, name='Total')

            df = pd.concat([df, sum_row.to_frame().T], ignore_index=True)
            processed_sheets_data[sheet_name] = df  # Lưu sheet đã xử lý

        # Step 3: Ghi lại tất cả các sheet (cả đã xử lý và chưa xử lý) vào file và định dạng.
        with pd.ExcelWriter(file_path, engine='openpyxl') as writer:
            for sheet_name, df_to_write in processed_sheets_data.items():
                df_to_write.to_excel(writer, sheet_name=sheet_name, index=False)

            workbook = writer.book
            for sheet_name in workbook.sheetnames:
                worksheet = workbook[sheet_name]
                worksheet.freeze_panes = 'A2'
                worksheet.auto_filter.ref = worksheet.dimensions

                green_fill = PatternFill(start_color='228b22', end_color='228b22', fill_type='solid')
                white_green_fill = PatternFill(start_color='8fbc8f', end_color='8fbc8f', fill_type='solid')
                white_red_fill = PatternFill(start_color='e9967a', end_color='e9967a', fill_type='solid')
                red_fill = PatternFill(start_color='ff0000', end_color='ff0000', fill_type='solid')
                brown_fill = PatternFill(start_color='cd853f', end_color='cd853f', fill_type='solid')

                header = [cell.value.lower() if cell.value else '' for cell in worksheet[1]]

                # Xác định lại các cột cần thiết cho việc tô màu
                orders_col_format = find_column(pd.DataFrame(columns=header),
                                                ['7 day total orders (#)', '14 day total orders (#)',
                                                 '14-day total orders (#) – (click)',
                                                 '14 day total orders (#) - (click)'])
                acos_col_format = find_column(pd.DataFrame(columns=header), ['total advertising cost of sales (acos)',
                                                                             'advertising cost of sales (acos)',
                                                                             'total advertising cost of sales (acos) - (click)',
                                                                             'total advertising cost of sales (acos) – (click)'])

                orders_col_idx = header.index(orders_col_format) + 1 if orders_col_format in header else None
                acos_col_idx = header.index(acos_col_format) + 1 if acos_col_format in header else None
                clicks_col_idx = header.index('clicks') + 1 if 'clicks' in header else None
                campaign_name_col_idx = header.index('campaign name') + 1 if 'campaign name' in header else None

                campaign_check = "SP03" if report_type == 'SP' else "SB05"
                click_threshold = 9 if report_type == 'SP' else 8

                if all([orders_col_idx, acos_col_idx, clicks_col_idx, campaign_name_col_idx]):
                    for row in worksheet.iter_rows(min_row=2, max_row=worksheet.max_row - 1):
                        orders_val = row[orders_col_idx - 1].value
                        acos_val = row[acos_col_idx - 1].value
                        clicks_val = row[clicks_col_idx - 1].value
                        campaign_name_val = row[campaign_name_col_idx - 1].value

                        if orders_val is not None and int(orders_val) > 0:
                            if acos_val is not None:
                                fill = None
                                if 0 < acos_val <= 0.2:
                                    fill = green_fill
                                elif 0.2 < acos_val <= 0.4:
                                    fill = white_green_fill
                                elif 0.4 < acos_val <= 0.6:
                                    fill = white_red_fill
                                else:
                                    fill = red_fill
                                if fill:
                                    for cell in row: cell.fill = fill
                        elif campaign_name_val is not None and campaign_check in str(
                                campaign_name_val) and clicks_val is not None and clicks_val > click_threshold:
                            for cell in row: cell.fill = brown_fill

                    for cell in worksheet[str(worksheet.max_row)]:
                        cell.font = Font(bold=True)
                        cell.fill = PatternFill(start_color='FFFF00', end_color='FFFF00', fill_type='solid')
        # --- END: SỬA LỖI ---
    except Exception as e:
        logging.error(f"[{store_name}] Lỗi khi định dạng tệp {os.path.basename(file_path)}: {e}")
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(store_name)}*\n" \
              f"❌ _Lỗi định dạng file_ `{escape_markdown(os.path.basename(file_path))}`\n" \
              f"Lỗi: `{escape_markdown(e)}`"
        send_telegram_message(msg)


def save_to_excel(filtered_df, output_folder, sku, suffix, report_type, store_name,
                  match_types=['Exact', 'Phrase', 'Broad']):
    safe_sku = str(sku).replace('/', ' ').replace('\\', ' ')
    output_file_name = f'{safe_sku} {suffix}.xlsx'
    output_file_path = os.path.join(output_folder, output_file_name)
    try:
        date_col = find_date_column(filtered_df)
        with pd.ExcelWriter(output_file_path, engine='openpyxl') as writer:
            filtered_df = filtered_df.sort_values(by=date_col, ascending=False)
            filtered_df.to_excel(writer, sheet_name='Tong Hop', index=False)
            for match_type in match_types:
                if 'match type' in filtered_df.columns:
                    match_type_df = filtered_df[
                        filtered_df['match type'].str.contains(match_type, case=False, na=False)]
                    if not match_type_df.empty:
                        match_type_sheet_name = match_type.replace(' ', '_')
                        match_type_df = match_type_df.sort_values(by=date_col, ascending=False)
                        match_type_df.to_excel(writer, sheet_name=match_type_sheet_name, index=False)
        logging.info(f"[{store_name}] Đã tạo tệp Excel: {output_file_name}")
        format_and_calculate(output_file_path, report_type, store_name)
    except Exception as e:
        logging.error(f"[{store_name}] Lỗi khi lưu tệp {output_file_name}: {e}")
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(store_name)}*\n" \
              f"❌ _Lỗi lưu file_ `{escape_markdown(output_file_name)}`\n" \
              f"Lỗi: `{escape_markdown(e)}`"
        send_telegram_message(msg)


def process_excel_file(input_file_path, output_directory, report_type, store_name):
    try:
        logging.info(f"[{store_name}] Bắt đầu xử lý tệp: {os.path.basename(input_file_path)}")
        df = pd.read_excel(input_file_path)
        df.columns = [str(col).strip().lower() for col in df.columns]

        if 'portfolio name' not in df.columns:
            logging.warning(
                f"[{store_name}] Tệp {os.path.basename(input_file_path)} thiếu cột 'Portfolio name'. Bỏ qua.")
            return

        for sku, group in df.groupby('portfolio name'):
            safe_sku = str(sku).replace('/', ' ').replace('\\', ' ')

            if report_type == 'SP':
                if any(group['campaign name'].str.contains('Auto', case=False, na=False)):
                    filtered_df = group[group['campaign name'].str.contains('Auto', case=False, na=False)]
                    save_to_excel(filtered_df, output_directory, safe_sku, "STR Auto", report_type, store_name)
                if any(group['campaign name'].str.contains('Exact|Phrase|Broad', case=False, na=False)):
                    filtered_df = group[group['campaign name'].str.contains('Exact|Phrase|Broad', case=False, na=False)]
                    save_to_excel(filtered_df, output_directory, safe_sku, "STR KW", report_type, store_name)
            elif report_type == 'SB':
                # --- START: SỬA LOGIC GỘP SB05 VÀ VIDEO ---
                # Điều kiện mới: Lấy tất cả các campaign có chứa 'SB05' HOẶC 'video'
                sb05_or_video_condition = group['campaign name'].str.contains('SB05|video', case=False, na=False)

                if any(sb05_or_video_condition):
                    filtered_df = group[sb05_or_video_condition]
                    # Lưu vào file chung có tên "STR SB05-VIDEO"
                    save_to_excel(filtered_df, output_directory, safe_sku, "STR SB05-VIDEO", report_type, store_name)
                # --- END: SỬA LOGIC GỘP SB05 VÀ VIDEO ---

                if any(group['campaign name'].str.contains('SB01|Collection', case=False, na=False)):
                    filtered_df = group[group['campaign name'].str.contains('SB01|Collection', case=False, na=False)]
                    save_to_excel(filtered_df, output_directory, safe_sku, "STR Collection", report_type, store_name)
        logging.info(f"[{store_name}] Hoàn thành xử lý tệp: {os.path.basename(input_file_path)}")
    except Exception as e:
        logging.error(f"[{store_name}] Lỗi khi xử lý tệp {os.path.basename(input_file_path)}: {e}")
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(store_name)}*\n" \
              f"❌ _Lỗi xử lý file_ `{escape_markdown(os.path.basename(input_file_path))}`\n" \
              f"Lỗi: `{escape_markdown(e)}`"
        send_telegram_message(msg)


def process_store(args):
    store_folder, date_input_directory, output_base = args
    store_path = os.path.join(date_input_directory, store_folder)
    if not os.path.isdir(store_path):
        return

    logging.info(f"--- Bắt đầu xử lý Search Term cho store: {store_folder} ---")
    msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(store_folder)}*\n" \
          f"🚀 _Bắt đầu xử lý Search Term_"
    send_telegram_message(msg)
    store_start_time = time.time()

    try:
        sp_files = [f for f in os.listdir(store_path) if f.endswith('.xlsx') and "Search Term SP" in f]
        sb_files = [f for f in os.listdir(store_path) if f.endswith('.xlsx') and "Search Term SB" in f]

        if sp_files:
            sp_start_time = time.time()
            msg_sp_start = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(store_folder)}*\n" \
                           f"⏳ _Bắt đầu xử lý Search Term SP\\.\\.\\._"
            send_telegram_message(msg_sp_start)
            for file in sp_files:
                match = re.search(r'\((.*?)\)', file)
                range_day_report = match.group(1).strip() if match else "unknown"
                input_file_path = os.path.join(store_path, file)
                output_directory = create_output_directory(output_base, store_folder, range_day_report, 'SP')
                process_excel_file(input_file_path, output_directory, 'SP', store_folder)
            sp_end_time = time.time()
            sp_duration = sp_end_time - sp_start_time
            msg_sp_end = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(store_folder)}*\n" \
                         f"✅ _Hoàn thành xử lý Search Term SP_\n" \
                         f"Thời gian: `{format_duration(sp_duration)}`"
            send_telegram_message(msg_sp_end)

        if sb_files:
            sb_start_time = time.time()
            msg_sb_start = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(store_folder)}*\n" \
                           f"⏳ _Bắt đầu xử lý Search Term SB\\.\\.\\._"
            send_telegram_message(msg_sb_start)
            for file in sb_files:
                match = re.search(r'\((.*?)\)', file)
                range_day_report = match.group(1).strip() if match else "unknown"
                input_file_path = os.path.join(store_path, file)
                output_directory = create_output_directory(output_base, store_folder, range_day_report, 'SB')
                process_excel_file(input_file_path, output_directory, 'SB', store_folder)
            sb_end_time = time.time()
            sb_duration = sb_end_time - sb_start_time
            msg_sb_end = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(store_folder)}*\n" \
                         f"✅ _Hoàn thành xử lý Search Term SB_\n" \
                         f"Thời gian: `{format_duration(sb_duration)}`"
            send_telegram_message(msg_sb_end)

        store_end_time = time.time()
        store_duration = store_end_time - store_start_time
        logging.info(
            f"--- Hoàn thành xử lý toàn bộ Search Term cho store {store_folder} trong {format_duration(store_duration)} ---")
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(store_folder)}*\n" \
              f"🎉 _Hoàn thành toàn bộ Search Term_\n" \
              f"Tổng thời gian: `{format_duration(store_duration)}`"
        send_telegram_message(msg)
    except Exception as e:
        logging.error(f"[{store_folder}] Lỗi nghiêm trọng khi xử lý store: {e}")
        msg = f"*{escape_markdown(SCRIPT_NAME)}* \\- *{escape_markdown(store_folder)}*\n" \
              f"💥 _Lỗi nghiêm trọng khi xử lý store_\n" \
              f"Lỗi: `{escape_markdown(e)}`"
        send_telegram_message(msg)


if __name__ == '__main__':
    freeze_support()
    start_msg = f"🚀 *{escape_markdown(SCRIPT_NAME)}* \\- _Bắt đầu chạy script_"
    send_telegram_message(start_msg)
    logging.info(f"=============================================")
    logging.info(f"BẮT ĐẦU CHẠY SCRIPT: {SCRIPT_NAME}")
    logging.info(f"=============================================")

    overall_start_time = time.time()

    date_input_directory = os.path.join(input_base_directory, current_date)
    if not os.path.exists(date_input_directory):
        logging.warning(f"Thư mục đầu vào cho ngày hôm nay không tồn tại: {date_input_directory}")
        msg = f"⚠️ *{escape_markdown(SCRIPT_NAME)}* \\- _Không tìm thấy thư mục dữ liệu cho ngày hôm nay. Dừng script._"
        send_telegram_message(msg)
        exit()

    on_stores_from_sheet = get_on_stores(GOOGLE_API_KEYFILE, SPREADSHEET_URL)

    all_available_folders = [folder for folder in os.listdir(date_input_directory) if
                             os.path.isdir(os.path.join(date_input_directory, folder))]

    if on_stores_from_sheet is not None:
        store_folders_to_process = [
            folder for folder in all_available_folders if folder in on_stores_from_sheet
        ]
        logging.info(f"Các store sẽ được xử lý (status ON và có thư mục): {store_folders_to_process}")
    else:
        store_folders_to_process = all_available_folders

    args_list = [(folder, date_input_directory, output_base_directory) for folder in store_folders_to_process]

    if not args_list:
        logging.warning("Không có store nào để xử lý sau khi lọc theo status 'ON'.")
    else:
        with Pool(processes=6) as pool:
            pool.map(process_store, args_list)

    overall_end_time = time.time()
    overall_duration = overall_end_time - overall_start_time
    logging.info(f"TỔNG THỜI GIAN XỬ LÝ TẤT CẢ STORES: {format_duration(overall_duration)}")
    end_msg = f"✅ *{escape_markdown(SCRIPT_NAME)}* \\- _Hoàn thành xử lý Search Term cho tất cả stores_\n" \
              f"Tổng thời gian: `{format_duration(overall_duration)}`"
    send_telegram_message(end_msg)
