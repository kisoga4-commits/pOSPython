# FAKDU POS (Python/Flask)

## สรุปการรันที่ถูกต้อง
- ให้รัน **`python app.py`** (entry หลักของระบบ)
- `lock.py` / `Lock3.py` เป็น alias เดิมเพื่อ backward compatibility เท่านั้น (ไม่ใช่ flow หลักแล้ว)
- **ไม่ต้องเปิด `templates/index.html` ตรง ๆ** เพราะหน้านี้ต้องถูก render โดย Flask และต้องใช้ API จาก backend

## วิธีเริ่มใช้งาน
1. ติดตั้ง dependency
   ```bash
   pip install flask requests
   ```
2. รันระบบ
   ```bash
   python app.py
   ```
3. เปิดเบราว์เซอร์ที่
   - `http://127.0.0.1:5000`
   - หรือ `http://<LAN-IP>:5000` (ดูจากข้อความที่แสดงตอนเริ่มรัน)

## โครงสร้างสำคัญที่ใช้งานจริง
- `app.py` = Flask app หลัก + API สำหรับ customer/staff/cashier/backstore/system
- `db.py` = โครงสร้างข้อมูล, normalize, versioning, reset tables/queue
- `templates/index.html` + `static/app.js` = หน้าเครื่องแม่ 4 แท็บ (ลูกค้า, เช็คบิล, หลังร้าน, ระบบ)
- `templates/customer.html` + `static/customer.js` = โหมดลูกค้า (สั่งอาหาร/เรียกเช็คบิล)
- `templates/staff.html` + `static/staff.js` = โหมดพนักงานหน้าร้าน
- `static/manifest.webmanifest` = PWA + shortcuts (รวม shortcut หน้าเครื่องแม่)
