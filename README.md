# 🏭 ERP Backend System
**Node.js + Express + JWT + PostgreSQL**

## Modul Yang Tersedia
| Modul | Endpoint Base | Deskripsi |
|-------|---------------|-----------|
| 🔐 Auth | `/api/v1/auth` | Login, logout, refresh token, profil |
| 📊 Dashboard | `/api/v1/dashboard` | Ringkasan & widget semua modul |
| ⚙️ Pengaturan | `/api/v1/settings` | Perusahaan, user, COA, departemen |
| 💰 Keuangan | `/api/v1/finance` | Jurnal, buku besar, laporan keuangan |
| 🧾 Invoice | `/api/v1/invoices` | Buat, kirim, catat pembayaran invoice |
| 📦 Inventori | `/api/v1/inventory` | Produk, stok, pergerakan barang |
| 🛒 Pembelian | `/api/v1/purchases` | PR, PO, penerimaan barang, supplier |
| 🏷️ Penjualan | `/api/v1/sales` | SO, pelanggan, pengiriman, analitik |
| 🏭 Produksi | `/api/v1/production` | BOM, Work Order, QC |
| 👥 SDM | `/api/v1/hr` | Karyawan, absensi, cuti |
| 💳 Penggajian | `/api/v1/payroll` | Hitung gaji, slip gaji, BPJS, PPh 21 |
| 🗒️ Log Aktivitas | `/api/v1/activity-logs` | Audit trail semua modul |

---

## Setup & Instalasi

### 1. Prasyarat
- Node.js >= 18
- PostgreSQL >= 14
- npm >= 8

### 2. Install Dependencies
```bash
npm install
```

### 3. Konfigurasi Environment
```bash
cp .env.example .env
# Edit .env sesuai konfigurasi database kamu
```

### 4. Buat Database
```sql
CREATE DATABASE erp_db;
```

### 5. Jalankan Migrasi
```bash
npm run migrate
```

### 6. Jalankan Server
```bash
# Production
npm start

# Development (dengan nodemon)
npm run dev
```

---

## Struktur Project
```
erp-backend/
├── src/
│   ├── app.js                    # Entry point
│   ├── config/
│   │   ├── database.js           # Koneksi PostgreSQL
│   │   └── jwt.js                # JWT helper
│   ├── middlewares/
│   │   ├── auth.js               # Autentikasi & otorisasi
│   │   ├── activityLog.js        # Auto-logging
│   │   └── errorHandler.js       # Error handling
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── dashboardController.js
│   │   ├── settingsController.js
│   │   ├── financeController.js
│   │   ├── invoiceController.js
│   │   ├── inventoryController.js
│   │   ├── purchaseController.js
│   │   ├── salesController.js
│   │   ├── productionController.js
│   │   ├── hrController.js
│   │   ├── payrollController.js
│   │   └── activityLogController.js
│   ├── routes/
│   │   ├── index.js
│   │   ├── authRoutes.js
│   │   ├── dashboardRoutes.js
│   │   └── ... (semua route files)
│   └── utils/
│       └── response.js           # Helper response standar
└── migrations/
    ├── 001_schema.sql            # Schema lengkap semua tabel
    ├── 002_seed.sql              # Data awal (COA, user, dll)
    └── run.js                    # Migration runner
```

---

## Roles & Akses
| Role | Level |
|------|-------|
| `SUPER_ADMIN` | Akses penuh semua modul |
| `ADMIN` | Hampir semua akses kecuali sistem kritis |
| `MANAGER` | Bisa approve PR, cuti; lihat laporan |
| `FINANCE` | Modul keuangan, invoice, payroll |
| `HR` | Modul SDM & penggajian |
| `STAFF` | Operasional sesuai departemen |
| `VIEW_ONLY` | Hanya bisa lihat data |

---

## Contoh Request API

### Login
```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "username": "superadmin",
  "password": "Admin@12345"
}
```

### Dashboard
```http
GET /api/v1/dashboard?period=30
Authorization: Bearer <token>
```

### Buat Sales Order
```http
POST /api/v1/sales/orders
Authorization: Bearer <token>
Content-Type: application/json

{
  "customer_id": 1,
  "order_date": "2026-03-12",
  "delivery_date": "2026-03-20",
  "payment_terms": 30,
  "items": [
    { "product_id": 4, "quantity": 5, "unit_price": 650000 }
  ]
}
```

### Hitung Payroll
```http
POST /api/v1/payroll
Authorization: Bearer <token>
Content-Type: application/json

{
  "month": 3,
  "year": 2026
}
```

---

## Default Login Credentials
| Username | Password | Role |
|----------|----------|------|
| superadmin | Admin@12345 | SUPER_ADMIN |
| admin | Admin@12345 | ADMIN |
| finance01 | Admin@12345 | FINANCE |
| hr01 | Admin@12345 | HR |

> ⚠️ **Ganti password default setelah setup!**

---

## Fitur Utama

### ✅ Otomatisasi Jurnal
Setiap transaksi di modul Pembelian, Penjualan, Produksi, dan Payroll akan **otomatis membuat jurnal keuangan** tanpa input manual.

### ✅ Perhitungan Payroll Indonesia
- BPJS Kesehatan (1% karyawan / 4% perusahaan)
- BPJS TK - JHT (2% / 3.7%), JP (1% / 2%), JKK (0.89%), JKM (0.3%)
- PPh 21 dengan tarif progresif sesuai UU HPP 2021
- PTKP sesuai status pernikahan (TK/K + tanggungan)

### ✅ Audit Trail Lengkap
Semua aksi dari semua modul dicatat otomatis di `activity_logs` dengan:
- User yang melakukan aksi
- Modul & action
- Data lama & baru (JSON)
- IP address & timestamp
- Level: INFO / WARNING / ERROR
