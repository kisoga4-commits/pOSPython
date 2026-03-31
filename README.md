# FAKDU POS (Python/Flask)

## สรุปการรันที่ถูกต้อง
- ให้รัน **`python lock.py`**
- **ไม่ต้องเปิด `templates/index.html` ตรง ๆ** เพราะหน้านี้ต้องถูก render โดย Flask และต้องใช้ API จาก backend

## วิธีเริ่มใช้งาน
1. ติดตั้ง dependency
   ```bash
   pip install flask requests
   ```
2. รันระบบ
   ```bash
   python lock.py
   ```
3. เปิดเบราว์เซอร์ที่
   - `http://127.0.0.1:5000`
   - หรือ `http://<LAN-IP>:5000` (ดูจากข้อความที่แสดงตอนเริ่มรัน)

## โครงสร้างสำคัญ
- `lock.py` = entrypoint หลัก
- `app.py` = Flask routes/API
- `templates/index.html` = หน้าเว็บหลัก (ต้องเสิร์ฟผ่าน Flask)
- `Lock3.py` = alias เก่า (ยังใช้ได้ แต่แนะนำใช้ `lock.py`)
