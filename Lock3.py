from flask import Flask, request, jsonify
import json
import os
import logging
import uuid
import hashlib
import socket
from datetime import datetime, timedelta

# ปิดข้อความแจ้งเตือน Flask
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)

app = Flask(__name__)

# ==========================================
# 1. ระบบหาเลข IP และ Security Check
# ==========================================
def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        try: ip = socket.gethostbyname(socket.gethostname())
        except: ip = '127.0.0.1'
    finally: s.close()
    return ip

def is_server_request():
    allowed = ['127.0.0.1', 'localhost', get_local_ip()]
    return request.remote_addr in allowed

LICENSE_FILE = "shabu_license.key"
SECRET = "shabu2026premium"

def get_machine_id():
    mac = uuid.getnode()
    return hashlib.sha256(str(mac).encode()).hexdigest()[:24].upper()

def generate_license_key(machine_id):
    return hashlib.sha256((machine_id + SECRET).encode()).hexdigest()[:16].upper()

def is_licensed():
    if os.path.exists(LICENSE_FILE):
        try:
            with open(LICENSE_FILE, 'r', encoding='utf-8') as f:
                return f.read().strip() == "LICENSED"
        except: pass
    return False

def activate_license(provided_key):
    machine_id = get_machine_id()
    expected = generate_license_key(machine_id)
    if provided_key.strip().upper() == expected:
        with open(LICENSE_FILE, 'w', encoding='utf-8') as f:
            f.write("LICENSED")
        return True
    return False

# ==========================================
# 2. ระบบฐานข้อมูลกลาง
# ==========================================
DB_FILE = "shabu_database.json"
def load_db():
    if os.path.exists(DB_FILE):
        with open(DB_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {
        "menu": [
            {"id":1, "name":"เนื้อใบพายพรีเมียม", "price":150},
            {"id":2, "name":"หมูสันคอสไลซ์", "price":120},
            {"id":3, "name":"ชุดผักรวมสุขภาพ", "price":50}
        ],
        "tableCount": 8,
        "tables": [{"id": i, "status": "available", "items": []} for i in range(1, 9)],
        "sales": []
    }

def save_db():
    with open(DB_FILE, 'w', encoding='utf-8') as f:
        json.dump(db, f, ensure_ascii=False, indent=2)

db = load_db()

# ==========================================
# 3. API สื่อสาร
# ==========================================
@app.route('/api/license', methods=['GET'])
def get_license_status():
    return jsonify({"licensed": is_licensed(), "machine_id": get_machine_id()})

@app.route('/api/activate', methods=['POST'])
def api_activate():
    if not is_server_request(): return jsonify({"status": "error"}), 403
    data = request.json
    if activate_license(data.get('key', '')): return jsonify({"status": "success"})
    return jsonify({"status": "error", "message": "คีย์ไม่ถูกต้อง"})

@app.route('/api/data', methods=['GET'])
def get_data():
    if not is_licensed(): return jsonify({"error": "ระบบยังไม่ได้เปิดใช้งาน"}), 403
    res_data = db.copy()
    if not is_server_request(): res_data['sales'] = [] 
    return jsonify(res_data)

@app.route('/api/order', methods=['POST'])
def place_order():
    if not is_licensed(): return jsonify({"error": "ระบบยังไม่ได้เปิดใช้งาน"}), 403
    data = request.json
    for t in db['tables']:
        if t['id'] == data['table_id']:
            t['status'] = 'occupied'
            t['items'].extend(data['cart'])
            break
    save_db()
    return jsonify({"status": "success"})

@app.route('/api/checkout', methods=['POST'])
def checkout():
    if not is_licensed(): return jsonify({"error": "ระบบยังไม่ได้เปิดใช้งาน"}), 403
    data = request.json
    db['sales'].append(data['sale_record'])
    for t in db['tables']:
        if t['id'] == data['table_id']:
            t['status'] = 'available'
            t['items'] = []
            break
    save_db()
    return jsonify({"status": "success"})

@app.route('/api/settings', methods=['POST'])
def update_settings():
    if not is_server_request(): return jsonify({"error": "Unauthorized"}), 403
    global db
    data = request.json
    if 'menu' in data: db['menu'] = data['menu']
    if 'tableCount' in data:
        db['tableCount'] = data['tableCount']
        db['tables'] = [{"id": i, "status": "available", "items": []} for i in range(1, db['tableCount'] + 1)]
    if 'reset' in data and data['reset'] == True:
        db['tables'] = [{"id": i, "status": "available", "items": []} for i in range(1, db['tableCount'] + 1)]
        db['sales'] = []
    save_db()
    return jsonify({"status": "success"})

# ==========================================
# 4. หน้าตาแอปพลิเคชัน (UI อัปเกรดระบบรายงาน)
# ==========================================
html_content = """
<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🍲 SHABU PRO v20.5 - Ultimate POS</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Kanit:wght@200;400;600;700&display=swap" rel="stylesheet">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
    <style>
        body { font-family: 'Kanit', sans-serif; background: #f8fafc; color: #1e293b; }
        .glass { background: rgba(255, 255, 255, 0.9); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.5); }
        .card-shadow { box-shadow: 0 10px 30px -5px rgba(0, 0, 0, 0.04); }
        .btn-orange { background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); transition: all 0.2s; }
        .btn-orange:hover { transform: translateY(-2px); filter: brightness(1.1); }
        .table-btn { border-radius: 20px; transition: all 0.3s; }
        .table-occupied { background: #fff1f2; border: 2px solid #fda4af; color: #be123c; }
        .table-available { background: #f0fdf4; border: 2px solid #86efac; color: #15803d; }
        .screen { animation: fadeIn 0.4s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .filter-btn-active { background: #1e293b !important; color: white !important; }
    </style>
</head>
<body class="min-h-screen">

<div id="license-screen" class="fixed inset-0 z-[2000] bg-slate-900 flex items-center justify-center p-6">
    <div class="bg-white p-10 rounded-[2.5rem] max-w-md w-full text-center shadow-2xl">
        <div class="text-6xl mb-6">🔒</div>
        <h2 class="text-3xl font-bold mb-2">เปิดใช้งานระบบ</h2>
        <p class="text-slate-400 mb-6 font-light">Machine ID: <span id="machine-id-display" class="font-mono font-bold"></span></p>
        <input id="license-key-input" type="text" maxlength="16" class="w-full p-4 border-2 rounded-2xl mb-6 text-center text-3xl font-bold tracking-[6px] focus:border-orange-500 outline-none transition-all">
        <button onclick="activateLicense()" class="w-full btn-orange text-white py-5 rounded-2xl font-bold text-xl">ปลดล็อคเดี๋ยวนี้</button>
    </div>
</div>

<div id="main-app" class="hidden">
    <header class="sticky top-0 z-50 px-6 py-4">
        <div class="max-w-7xl mx-auto glass rounded-3xl p-4 card-shadow flex justify-between items-center">
            <div class="flex items-center gap-4 cursor-pointer" onclick="showScreen('home')">
                <div class="w-12 h-12 btn-orange rounded-2xl flex items-center justify-center shadow-md text-2xl">🍲</div>
                <h1 class="text-2xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-orange-600 to-red-600">SHABU PRO</h1>
            </div>
            <div class="flex gap-3">
                <button onclick="showQRModal()" class="hidden md:flex items-center gap-2 bg-white px-5 py-3 rounded-2xl font-semibold border hover:bg-slate-50 transition-colors">📱 พนักงาน</button>
                <button onclick="showScreen('home')" class="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-xl border hover:bg-slate-50 transition-colors">🏠</button>
            </div>
        </div>
    </header>

    <main class="max-w-7xl mx-auto px-6 pb-12">
        <div id="home" class="screen grid grid-cols-1 md:grid-cols-3 gap-8 mt-4">
            <div onclick="showCustomerMode()" class="bg-white p-10 rounded-[3rem] card-shadow cursor-pointer hover:border-orange-500 border-2 border-transparent transition-all group">
                <div class="text-7xl mb-6 group-hover:scale-110 transition-transform text-center">🍲</div>
                <h2 class="text-2xl font-bold text-center">รับออร์เดอร์</h2>
                <p class="text-slate-400 text-center mt-2">เปิดโต๊ะและสั่งอาหาร</p>
            </div>
            <div onclick="showShopMode()" class="bg-white p-10 rounded-[3rem] card-shadow cursor-pointer hover:border-red-500 border-2 border-transparent transition-all group">
                <div class="text-7xl mb-6 group-hover:scale-110 transition-transform text-center">💸</div>
                <h2 class="text-2xl font-bold text-center">แคชเชียร์</h2>
                <p class="text-slate-400 text-center mt-2">เช็คบิลและรับชำระ</p>
            </div>
            <div id="admin-main-btn" onclick="showAdminLogin()" class="bg-white p-10 rounded-[3rem] card-shadow cursor-pointer hover:border-slate-800 border-2 border-transparent transition-all group">
                <div class="text-7xl mb-6 group-hover:scale-110 transition-transform text-center">📈</div>
                <h2 class="text-2xl font-bold text-center">รายงานหลังร้าน</h2>
                <p class="text-slate-400 text-center mt-2">สรุปยอดและสถิติ</p>
            </div>
        </div>

        <div id="customer-mode" class="screen hidden mt-4">
            <h3 class="text-2xl font-bold mb-8 flex items-center gap-3">🚩 ผังโต๊ะอาหาร</h3>
            <div id="customer-table-grid" class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-6"></div>
        </div>

        <div id="menu-page" class="screen hidden mt-4">
            <div class="flex flex-col lg:flex-row gap-8">
                <div class="flex-1">
                    <h3 class="text-2xl font-bold mb-6">🍱 เลือกรายการ</h3>
                    <div id="menu-grid" class="grid grid-cols-1 sm:grid-cols-2 gap-4"></div>
                </div>
                <div class="w-full lg:w-96">
                    <div class="bg-white rounded-[2.5rem] card-shadow p-8 sticky top-32">
                        <h3 class="text-xl font-bold mb-6">โต๊ะ <span id="table-display" class="text-orange-600"></span></h3>
                        <div id="cart-list" class="space-y-3 mb-8 max-h-[400px] overflow-y-auto"></div>
                        <div class="pt-6 border-t border-dashed">
                            <div class="flex justify-between text-3xl font-bold mb-6">
                                <span>รวม</span><span class="text-orange-600">฿<span id="cart-total">0</span></span>
                            </div>
                            <button onclick="confirmOrder()" class="w-full btn-orange text-white py-5 rounded-2xl font-bold text-xl shadow-lg shadow-orange-100">📤 ส่งเข้าครัว</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div id="shop-mode" class="screen hidden mt-4">
            <h3 class="text-2xl font-bold mb-8">🛎️ รายการเช็คบิล</h3>
            <div id="shop-table-grid" class="grid grid-cols-1 md:grid-cols-3 gap-8"></div>
        </div>

        <div id="admin-dashboard" class="screen hidden mt-4">
            <div class="flex bg-slate-200 p-2 rounded-2xl mb-10 w-fit">
                <button onclick="showAdminTab('sales')" id="tab-sales" class="px-8 py-3 rounded-xl font-bold transition-all">📊 สถิติยอดขาย</button>
                <button onclick="showAdminTab('settings')" id="tab-settings" class="px-8 py-3 rounded-xl font-bold transition-all text-slate-500">⚙️ ตั้งค่าร้าน</button>
            </div>
            
            <div id="admin-section-sales" class="admin-content space-y-8">
                <div class="bg-white p-6 rounded-[2rem] card-shadow border border-slate-100 flex flex-wrap items-center gap-4">
                    <span class="font-bold text-slate-500 mr-2">📅 ช่วงเวลา:</span>
                    <button onclick="setSalesFilter('today')" id="filter-today" class="px-6 py-2 rounded-xl bg-slate-100 font-bold text-sm hover:bg-slate-200 transition-all">วันนี้</button>
                    <button onclick="setSalesFilter('week')" id="filter-week" class="px-6 py-2 rounded-xl bg-slate-100 font-bold text-sm hover:bg-slate-200 transition-all">7 วันล่าสุด</button>
                    <button onclick="setSalesFilter('month')" id="filter-month" class="px-6 py-2 rounded-xl bg-slate-100 font-bold text-sm hover:bg-slate-200 transition-all">เดือนนี้</button>
                    <button onclick="setSalesFilter('all')" id="filter-all" class="px-6 py-2 rounded-xl bg-slate-100 font-bold text-sm hover:bg-slate-200 transition-all">ทั้งหมด</button>
                    <div class="h-6 w-[1px] bg-slate-200 mx-2"></div>
                    <input type="date" id="filter-date-custom" onchange="setSalesFilter('custom')" class="px-4 py-2 rounded-xl bg-slate-50 border outline-none font-bold text-sm focus:border-orange-500">
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div class="bg-emerald-500 p-8 rounded-[2.5rem] text-white shadow-xl relative overflow-hidden">
                        <div class="text-lg opacity-80">รายได้ในช่วงที่เลือก</div>
                        <div id="sum-filtered" class="text-5xl font-bold mt-2 tracking-tight">฿0</div>
                        <div class="absolute -right-4 -bottom-4 text-white/10 text-9xl">💰</div>
                    </div>
                    <div class="bg-blue-600 p-8 rounded-[2.5rem] text-white shadow-xl relative overflow-hidden">
                        <div class="text-lg opacity-80">จำนวนบิลที่ปิด</div>
                        <div id="count-filtered" class="text-5xl font-bold mt-2 tracking-tight">0</div>
                        <div class="absolute -right-4 -bottom-4 text-white/10 text-9xl">📄</div>
                    </div>
                </div>

                <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div class="lg:col-span-2 bg-white p-8 rounded-[2.5rem] card-shadow border border-slate-100">
                         <h4 class="text-xl font-bold mb-6 flex items-center gap-2">🏆 อันดับเมนูขายดี</h4>
                         <div class="overflow-x-auto">
                            <table class="w-full text-left">
                                <thead>
                                    <tr class="text-slate-400 border-b border-slate-50 text-sm">
                                        <th class="pb-4 font-semibold uppercase">เมนู</th>
                                        <th class="pb-4 font-semibold text-center uppercase">จำนวน (จาน)</th>
                                        <th class="pb-4 font-semibold text-right uppercase">ยอดเงินรวม</th>
                                    </tr>
                                </thead>
                                <tbody id="best-seller-table" class="divide-y divide-slate-50"></tbody>
                            </table>
                         </div>
                    </div>
                    <div class="bg-white p-8 rounded-[2.5rem] card-shadow border border-slate-100">
                         <h4 class="text-xl font-bold mb-6">🕒 ประวัติบิลในช่วงนี้</h4>
                         <div id="bill-detail-list" class="space-y-4 max-h-[500px] overflow-y-auto pr-2"></div>
                    </div>
                </div>
            </div>

            <div id="admin-section-settings" class="admin-content hidden space-y-8">
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100">
                        <h4 class="text-xl font-bold mb-6">🍣 จัดการเมนู</h4>
                        <div class="flex gap-2 mb-8">
                            <input id="new-name" placeholder="ชื่อเมนู" class="flex-1 p-3 border rounded-xl outline-none focus:border-orange-500">
                            <input id="new-price" type="number" placeholder="ราคา" class="w-24 p-3 border rounded-xl outline-none focus:border-orange-500">
                            <button onclick="addMenu()" class="btn-orange text-white px-6 rounded-xl font-bold">เพิ่ม</button>
                        </div>
                        <div id="admin-menu-list" class="divide-y divide-slate-50"></div>
                    </div>
                    <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100">
                        <h4 class="text-xl font-bold mb-4">🪑 จัดการโต๊ะ</h4>
                        <div class="flex gap-2 mb-10"><input id="table-count-input" type="number" class="w-24 p-3 border rounded-xl outline-none"><button onclick="updateTableCount()" class="bg-slate-800 text-white px-6 py-3 rounded-xl font-bold flex-1">อัปเดตจำนวนโต๊ะ</button></div>
                        <button onclick="resetEverything()" class="w-full bg-red-50 text-red-600 border-2 border-red-100 py-6 rounded-3xl font-bold text-xl hover:bg-red-100 transition-all">⚠️ ล้างข้อมูลทั้งหมด</button>
                    </div>
                </div>
            </div>
        </div>

        <div id="admin-login" class="screen hidden flex justify-center mt-12">
            <div class="bg-white p-12 rounded-[3rem] shadow-2xl w-full max-w-md text-center">
                <div class="text-5xl mb-6">🛡️</div>
                <h3 class="text-2xl font-bold mb-8">รหัสผ่านหลังร้าน</h3>
                <input id="admin-password-input" type="password" class="w-full text-4xl text-center p-4 border rounded-2xl mb-8 outline-none focus:border-slate-800">
                <button onclick="loginAdmin()" class="w-full bg-slate-800 text-white py-4 rounded-2xl font-bold text-xl">เข้าสู่ระบบ</button>
            </div>
        </div>
    </main>

    <div id="checkout-modal" class="screen hidden fixed inset-0 z-[1100] modal flex items-center justify-center p-6 bg-slate-900/50 backdrop-blur-sm">
        <div class="bg-white rounded-[3rem] w-full max-w-lg overflow-hidden shadow-2xl">
            <div class="bg-slate-900 p-8 text-white text-center">
                <h3 class="text-3xl font-bold">ยอดชำระ โต๊ะ <span id="modal-table-id"></span></h3>
            </div>
            <div class="p-8">
                <div id="modal-item-list" class="space-y-2 mb-8 max-h-64 overflow-y-auto"></div>
                <div class="bg-slate-50 p-6 rounded-3xl flex justify-between items-center mb-8 border border-slate-100">
                    <span class="text-xl text-slate-500">สุทธิ</span>
                    <span class="text-5xl font-bold text-red-600">฿<span id="modal-total-amount">0</span></span>
                </div>
                <div class="flex gap-4">
                    <button onclick="closeModal()" class="flex-1 py-5 rounded-2xl bg-slate-100 font-bold text-xl text-slate-600">กลับ</button>
                    <button onclick="processPayment()" class="flex-1 py-5 rounded-2xl bg-green-500 text-white font-bold text-xl shadow-lg shadow-green-200">💰 รับเงิน</button>
                </div>
            </div>
        </div>
    </div>

    <div id="qr-modal" class="screen hidden fixed inset-0 z-[1200] modal flex items-center justify-center p-6 bg-slate-900/50 backdrop-blur-sm">
        <div class="bg-white rounded-[3rem] w-full max-w-sm overflow-hidden shadow-2xl text-center p-10">
            <h2 class="text-2xl font-bold mb-6">Staff QR Link</h2>
            <div class="bg-white p-4 border-8 border-orange-50 rounded-[2rem] inline-block mb-6"><div id="qrcode"></div></div>
            <div id="display-url" class="bg-slate-50 p-4 rounded-2xl font-bold text-orange-600 mb-8 break-all text-xs"></div>
            <button onclick="closeQRModal()" class="w-full py-4 rounded-2xl bg-slate-900 text-white font-bold">ปิดหน้าต่าง</button>
        </div>
    </div>
</div>

<script>
// ==================== CORE SYSTEM ====================
const IS_SERVER = __IS_SERVER__;
const SERVER_IP = "__SERVER_IP__";
const SERVER_URL = "http://" + SERVER_IP + ":5000";
const ADMIN_PASSWORD_CODE = "admin";

let menu = [], tableCount = 8, tables = [], sales = [], cart = [], activeTable = null;
let currentSalesFilter = 'today';

// ความปลอดภัย: ซ่อนปุ่มหลังร้านสำหรับเครื่องลูก
if(!IS_SERVER) {
    const adminBtn = document.getElementById('admin-main-btn');
    if(adminBtn) adminBtn.remove();
}

async function checkLicense() {
    try {
        const res = await fetch('/api/license');
        const data = await res.json();
        if (data.licensed) {
            document.getElementById('license-screen').classList.add('hidden');
            document.getElementById('main-app').classList.remove('hidden');
            syncData();
        } else {
            document.getElementById('machine-id-display').textContent = data.machine_id;
        }
    } catch (e) { console.error("Server Connection Error"); }
}

async function activateLicense() {
    const key = document.getElementById('license-key-input').value.trim();
    if (key.length !== 16) return alert("คีย์ต้องมี 16 หลัก");
    const res = await fetch('/api/activate', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key: key}) });
    const data = await res.json();
    if (data.status === "success") { location.reload(); } else { alert("❌ คีย์ไม่ถูกต้อง"); }
}

async function syncData() {
    try {
        const res = await fetch('/api/data'); 
        const data = await res.json();
        menu = data.menu; tableCount = data.tableCount; tables = data.tables; sales = data.sales;
        if (!document.getElementById('customer-mode').classList.contains('hidden')) renderCustomerTableGrid();
        if (!document.getElementById('shop-mode').classList.contains('hidden')) renderShopTableGrid();
        if (!document.getElementById('admin-dashboard').classList.contains('hidden')) renderAdminSales();
    } catch (e) {}
}
setInterval(syncData, 5000);

function showScreen(id) { 
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden')); 
    document.getElementById(id).classList.remove('hidden'); 
}

function showQRModal() {
    document.getElementById('display-url').innerText = SERVER_URL;
    document.getElementById('qr-modal').classList.remove('hidden');
    const qrContainer = document.getElementById("qrcode");
    qrContainer.innerHTML = "";
    setTimeout(() => { new QRCode(qrContainer, { text: SERVER_URL, width: 220, height: 220, colorDark : "#ea580c" }); }, 200);
}
function closeQRModal() { document.getElementById('qr-modal').classList.add('hidden'); }

// ==================== CUSTOMER & ORDERS ====================
function showCustomerMode() { showScreen('customer-mode'); renderCustomerTableGrid(); }
function renderCustomerTableGrid() {
    const grid = document.getElementById('customer-table-grid'); grid.innerHTML = '';
    tables.forEach(t => {
        const isOcc = t.status === 'occupied';
        grid.innerHTML += `
        <div onclick="selectTab(${t.id})" class="table-btn p-8 flex flex-col items-center gap-3 cursor-pointer hover:shadow-xl transition-all ${isOcc ? 'table-occupied' : 'table-available'}">
            <span class="text-4xl">${isOcc ? '🔥' : '🍽️'}</span>
            <span class="text-2xl font-bold">โต๊ะ ${t.id}</span>
            <span class="text-xs uppercase font-bold opacity-60">${isOcc ? 'Occupied' : 'Free'}</span>
        </div>`;
    });
}
function selectTab(id) {
    activeTable = tables.find(x => x.id === id);
    document.getElementById('table-display').innerText = id;
    cart = []; renderMenu(); renderCart(); showScreen('menu-page');
}
function renderMenu() {
    const grid = document.getElementById('menu-grid'); grid.innerHTML = '';
    menu.forEach(item => {
        grid.innerHTML += `
        <div onclick="addToCart(${item.id})" class="bg-white p-5 rounded-3xl flex justify-between items-center border border-slate-100 hover:border-orange-500 cursor-pointer transition-all card-shadow">
            <div class="flex flex-col"><span class="font-bold text-lg">${item.name}</span><span class="text-orange-600 font-bold text-xl">฿${item.price}</span></div>
            <div class="text-3xl text-slate-200">+</div>
        </div>`;
    });
}
function addToCart(id) { cart.push({...menu.find(m => m.id === id)}); renderCart(); }
function removeFromCart(index) { cart.splice(index, 1); renderCart(); }
function renderCart() {
    const list = document.getElementById('cart-list'); list.innerHTML = ''; let total = 0;
    cart.forEach((item, index) => { 
        total += item.price; 
        list.innerHTML += `<div class="flex justify-between items-center bg-slate-50 p-4 rounded-2xl">
            <div class="flex flex-col"><span class="font-bold text-sm text-slate-800">${item.name}</span><span class="text-xs text-slate-400">฿${item.price}</span></div>
            <button onclick="removeFromCart(${index})" class="text-red-400">🗑️</button></div>`; 
    });
    document.getElementById('cart-total').innerText = total.toLocaleString();
}
async function confirmOrder() {
    if (!cart.length) return alert("กรุณาเลือกอาหาร");
    await fetch('/api/order', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({table_id: activeTable.id, cart: cart}) });
    alert("ส่งรายการอาหารแล้ว"); cart = []; showCustomerMode(); syncData();
}

// ==================== CASHIER ====================
function showShopMode() { showScreen('shop-mode'); renderShopTableGrid(); }
function renderShopTableGrid() {
    const grid = document.getElementById('shop-table-grid'); grid.innerHTML = '';
    tables.forEach(t => {
        const total = t.items.reduce((s, i) => s + i.price, 0);
        const isOcc = t.status === 'occupied';
        grid.innerHTML += `<div class="p-8 rounded-[2.5rem] bg-white border border-slate-100 flex flex-col justify-between card-shadow ${!isOcc && 'opacity-60'}">
            <div class="flex justify-between items-center mb-6"><span class="text-2xl font-bold">โต๊ะ ${t.id}</span>
            ${isOcc ? `<span class="text-2xl font-bold text-red-600">฿${total.toLocaleString()}</span>` : ''}</div>
            ${isOcc ? `<button onclick="openCheckout(${t.id})" class="w-full btn-orange text-white py-4 rounded-2xl font-bold shadow-lg">สรุปยอดชำระ</button>` 
            : `<div class="text-center py-4 bg-slate-50 rounded-2xl text-slate-400 font-bold">ว่าง</div>`}</div>`;
    });
}
function openCheckout(id) {
    activeTable = tables.find(x => x.id === id);
    const total = activeTable.items.reduce((s, i) => s + i.price, 0);
    document.getElementById('modal-table-id').innerText = id;
    document.getElementById('modal-total-amount').innerText = total.toLocaleString();
    const list = document.getElementById('modal-item-list'); list.innerHTML = '';
    activeTable.items.forEach(i => { list.innerHTML += `<div class="flex justify-between py-1 border-b border-slate-50"><span>${i.name}</span><span>฿${i.price}</span></div>`; });
    document.getElementById('checkout-modal').classList.remove('hidden');
}
function closeModal() { document.getElementById('checkout-modal').classList.add('hidden'); }
async function processPayment() {
    const total = activeTable.items.reduce((s, i) => s + i.price, 0);
    const now = new Date();
    const record = { 
        id: Date.now(), 
        timestamp: now.getTime(), 
        dateOnly: now.toISOString().split('T')[0], 
        monthOnly: now.toISOString().substring(0, 7), 
        time: now.toLocaleTimeString('th-TH'), 
        table: activeTable.id, 
        amount: total, 
        items: activeTable.items 
    };
    await fetch('/api/checkout', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({table_id: activeTable.id, sale_record: record}) });
    closeModal(); syncData(); showShopMode();
}

// ==================== ADMIN: ANALYTICS (อัปเกรดระบบ Filter วันที่) ====================
function showAdminLogin() { document.getElementById('admin-password-input').value = ''; showScreen('admin-login'); }
function loginAdmin() { if (document.getElementById('admin-password-input').value === ADMIN_PASSWORD_CODE) { showAdminTab('sales'); showScreen('admin-dashboard'); } else alert("รหัสผ่านไม่ถูกต้อง"); }

function showAdminTab(tab) {
    document.querySelectorAll('.admin-content').forEach(c => c.classList.add('hidden'));
    document.getElementById(`admin-section-${tab}`).classList.remove('hidden');
    document.getElementById('tab-sales').className = tab === 'sales' ? 'px-8 py-3 rounded-xl font-bold transition-all bg-white shadow-sm' : 'px-8 py-3 rounded-xl font-bold transition-all text-slate-500';
    document.getElementById('tab-settings').className = tab === 'settings' ? 'px-8 py-3 rounded-xl font-bold transition-all bg-white shadow-sm' : 'px-8 py-3 rounded-xl font-bold transition-all text-slate-500';
    if(tab === 'sales') renderAdminSales(); else renderAdminSettings();
}

// ฟังก์ชันเลือก Filter วันที่
function setSalesFilter(range) {
    currentSalesFilter = range;
    document.querySelectorAll('#admin-section-sales button').forEach(b => b.classList.remove('filter-btn-active'));
    if(range !== 'custom') document.getElementById(`filter-${range}`).classList.add('filter-btn-active');
    renderAdminSales();
}

function renderAdminSales() {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const monthStr = now.toISOString().substring(0, 7);
    const customDate = document.getElementById('filter-date-custom').value;
    
    // คำนวณขอบเขตวันที่
    const weekAgo = new Date();
    weekAgo.setDate(now.getDate() - 7);

    // กรองข้อมูลตาม Filter ที่เลือก
    const filteredSales = sales.filter(s => {
        if(currentSalesFilter === 'today') return s.dateOnly === todayStr;
        if(currentSalesFilter === 'week') return new Date(s.timestamp) >= weekAgo;
        if(currentSalesFilter === 'month') return s.monthOnly === monthStr;
        if(currentSalesFilter === 'custom') return s.dateOnly === customDate;
        return true; // all
    });

    let sTotal = 0;
    const itemStats = {};

    filteredSales.forEach(s => { 
        sTotal += s.amount;
        s.items.forEach(item => {
            if (!itemStats[item.name]) itemStats[item.name] = { qty: 0, total: 0 };
            itemStats[item.name].qty += 1;
            itemStats[item.name].total += item.price;
        });
    });

    document.getElementById('sum-filtered').innerText = "฿" + sTotal.toLocaleString();
    document.getElementById('count-filtered').innerText = filteredSales.length.toLocaleString();

    // 🏆 Render Best Sellers
    const bTable = document.getElementById('best-seller-table');
    bTable.innerHTML = '';
    const sorted = Object.entries(itemStats).sort((a, b) => b[1].qty - a[1].qty);
    sorted.forEach(([name, stat], index) => {
        bTable.innerHTML += `<tr class="hover:bg-slate-50 transition-colors">
            <td class="py-4 font-bold text-slate-700">${index === 0 ? '🥇 ' : (index + 1) + '. '}${name}</td>
            <td class="py-4 text-center font-bold text-slate-600">${stat.qty}</td>
            <td class="py-4 text-right font-bold text-emerald-600">฿${stat.total.toLocaleString()}</td></tr>`;
    });

    // 🕒 Render Recent Bills
    const billList = document.getElementById('bill-detail-list');
    billList.innerHTML = '';
    [...filteredSales].reverse().slice(0, 15).forEach(s => { 
        billList.innerHTML += `<div class="flex justify-between items-center p-4 bg-slate-50 rounded-2xl border border-slate-100">
            <div><div class="font-bold text-sm">โต๊ะ ${s.table}</div><div class="text-[10px] text-slate-400">${s.dateOnly} | ${s.time}</div></div>
            <div class="font-bold text-orange-600">฿${s.amount.toLocaleString()}</div></div>`; 
    });
}

function renderAdminSettings() {
    const list = document.getElementById('admin-menu-list'); list.innerHTML = '';
    menu.forEach(m => {
        list.innerHTML += `<div class="flex justify-between items-center py-4">
            <span class="font-bold text-slate-700">${m.name} <b class="ml-4 text-orange-500">฿${m.price}</b></span>
            <button onclick="deleteMenu(${m.id})" class="bg-red-50 text-red-500 px-4 py-2 rounded-xl font-bold">ลบ</button></div>`;
    });
    document.getElementById('table-count-input').value = tableCount;
}

async function addMenu() {
    const n = document.getElementById('new-name').value;
    const p = parseInt(document.getElementById('new-price').value);
    if(n && p) { menu.push({id: Date.now(), name: n, price: p}); await fetch('/api/settings', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({menu: menu})}); renderAdminSettings(); document.getElementById('new-name').value = ''; document.getElementById('new-price').value = ''; }
}
async function deleteMenu(id) { menu = menu.filter(x => x.id !== id); await fetch('/api/settings', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({menu: menu})}); renderAdminSettings(); }
async function updateTableCount() {
    const c = parseInt(document.getElementById('table-count-input').value);
    if(c > 0 && confirm("เปลี่ยนจำนวนโต๊ะ?")) { await fetch('/api/settings', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({tableCount: c})}); syncData(); }
}
async function resetEverything() { if(confirm("ล้างข้อมูลทั้งหมด? ยืนยันหรือไม่?")) { await fetch('/api/settings', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({reset: true})}); location.reload(); } }

window.onload = () => {
    checkLicense();
    document.getElementById('filter-today').classList.add('filter-btn-active');
};
</script>
</body>
</html>
"""

@app.route("/")
def home():
    ip = get_local_ip()
    is_server = "true" if is_server_request() else "false"
    rendered = html_content.replace('__SERVER_IP__', ip)
    rendered = rendered.replace('__IS_SERVER__', is_server)
    return rendered

if __name__ == '__main__':
    ip_addr = get_local_ip()
    print("\n" + "="*75)
    print(f"🚀 SHABU PRO POS v20.5 Ready!")
    print(f"📡 Access Point: http://{ip_addr}:5000")
    print("="*75 + "\n")
    app.run(host='0.0.0.0', port=5000, debug=False)