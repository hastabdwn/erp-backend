-- ============================================================
-- ERP SYSTEM - SEED DATA
-- ============================================================

-- System Preferences
INSERT INTO system_preferences (key, value, description) VALUES
  ('currency', 'IDR', 'Mata uang default'),
  ('currency_symbol', 'Rp', 'Simbol mata uang'),
  ('timezone', 'Asia/Jakarta', 'Zona waktu'),
  ('date_format', 'DD/MM/YYYY', 'Format tanggal'),
  ('fiscal_year_start', '01', 'Bulan awal tahun fiskal'),
  ('tax_rate', '11', 'PPN default (%)'),
  ('invoice_due_days', '30', 'Jatuh tempo invoice default (hari)'),
  ('low_stock_alert', 'true', 'Aktifkan peringatan stok rendah')
ON CONFLICT (key) DO NOTHING;

-- Default Company Profile
INSERT INTO company_profile (name, address, email, phone) VALUES
  ('PT. ERP Sistem Indonesia', 'Jl. Sudirman No. 1, Jakarta Pusat', 'info@erpsistem.co.id', '021-12345678')
ON CONFLICT DO NOTHING;

-- Departments
INSERT INTO departments (name, code, description) VALUES
  ('Direksi', 'DIR', 'Manajemen puncak'),
  ('Keuangan', 'FIN', 'Departemen Keuangan & Akuntansi'),
  ('Penjualan', 'SAL', 'Departemen Penjualan'),
  ('Pembelian', 'PUR', 'Departemen Pembelian & Pengadaan'),
  ('Gudang & Logistik', 'WHS', 'Manajemen Gudang'),
  ('Produksi', 'PRD', 'Departemen Produksi & Manufaktur'),
  ('SDM', 'HR', 'Sumber Daya Manusia'),
  ('Teknologi Informasi', 'IT', 'Departemen IT'),
  ('Quality Control', 'QC', 'Pengendalian Kualitas')
ON CONFLICT (code) DO NOTHING;

-- Positions
INSERT INTO positions (title, code, department_id) VALUES
  ('Direktur Utama', 'CEO', 1),
  ('Direktur Keuangan', 'CFO', 2),
  ('Manajer Keuangan', 'FIN_MGR', 2),
  ('Staf Akuntansi', 'ACCOUNTANT', 2),
  ('Manajer Penjualan', 'SAL_MGR', 3),
  ('Sales Executive', 'SALES', 3),
  ('Manajer Pembelian', 'PUR_MGR', 4),
  ('Staf Pembelian', 'BUYER', 4),
  ('Kepala Gudang', 'WH_HEAD', 5),
  ('Staf Gudang', 'WH_STAFF', 5),
  ('Manajer Produksi', 'PRD_MGR', 6),
  ('Operator Produksi', 'OPERATOR', 6),
  ('Manajer SDM', 'HR_MGR', 7),
  ('Staf SDM', 'HR_STAFF', 7),
  ('IT Manager', 'IT_MGR', 8)
ON CONFLICT (code) DO NOTHING;

-- Default Super Admin User
-- PENTING: Generate hash yang benar dengan perintah ini di folder backend:
--   node -e "const b=require('bcryptjs'); b.hash('Admin@12345',12).then(h=>console.log(h));"
-- Lalu UPDATE langsung di database:
--   UPDATE users SET password_hash='<hasil>' WHERE username IN ('admin','superadmin','finance01','hr01');
INSERT INTO users (username, email, password_hash, full_name, role, department_id) VALUES
  ('superadmin', 'superadmin@erp.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCoBsWBQiKNWkMBCQZfA4Je', 'Super Administrator', 'SUPER_ADMIN', 1),
  ('admin', 'admin@erp.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCoBsWBQiKNWkMBCQZfA4Je', 'Administrator', 'ADMIN', 1),
  ('finance01', 'finance@erp.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCoBsWBQiKNWkMBCQZfA4Je', 'Staff Keuangan', 'FINANCE', 2),
  ('hr01', 'hr@erp.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCoBsWBQiKNWkMBCQZfA4Je', 'Staff SDM', 'HR', 7)
ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash;
-- Default password for all: Admin@12345

-- Chart of Accounts (COA Standard Indonesia)
INSERT INTO chart_of_accounts (code, name, account_type) VALUES
  -- ASSETS
  ('1000', 'Aset Lancar', 'ASSET'),
  ('1100', 'Kas dan Setara Kas', 'ASSET'),
  ('1101', 'Kas', 'ASSET'),
  ('1102', 'Bank BCA', 'ASSET'),
  ('1103', 'Bank Mandiri', 'ASSET'),
  ('1200', 'Piutang Usaha', 'ASSET'),
  ('1300', 'Persediaan', 'ASSET'),
  ('1301', 'Persediaan Bahan Baku', 'ASSET'),
  ('1302', 'Persediaan Barang Jadi', 'ASSET'),
  ('1400', 'Beban Dibayar Dimuka', 'ASSET'),
  ('1500', 'Aset Tidak Lancar', 'ASSET'),
  ('1501', 'Tanah', 'ASSET'),
  ('1502', 'Bangunan', 'ASSET'),
  ('1503', 'Kendaraan', 'ASSET'),
  ('1504', 'Peralatan', 'ASSET'),
  -- LIABILITIES
  ('2000', 'Kewajiban Lancar', 'LIABILITY'),
  ('2100', 'Hutang Usaha', 'LIABILITY'),
  ('2200', 'Hutang Pajak', 'LIABILITY'),
  ('2201', 'Hutang PPh 21', 'LIABILITY'),
  ('2202', 'Hutang PPN', 'LIABILITY'),
  ('2300', 'Hutang BPJS', 'LIABILITY'),
  ('2400', 'Hutang Gaji', 'LIABILITY'),
  ('2500', 'Pendapatan Diterima Dimuka', 'LIABILITY'),
  -- EQUITY
  ('3000', 'Ekuitas', 'EQUITY'),
  ('3100', 'Modal Disetor', 'EQUITY'),
  ('3200', 'Saldo Laba', 'EQUITY'),
  -- REVENUE
  ('4000', 'Pendapatan', 'REVENUE'),
  ('4100', 'Penjualan', 'REVENUE'),
  ('4200', 'Pendapatan Jasa', 'REVENUE'),
  ('4900', 'Pendapatan Lain-lain', 'REVENUE'),
  -- COGS
  ('5000', 'Harga Pokok Penjualan', 'COGS'),
  ('5100', 'Harga Pokok Produksi', 'COGS'),
  ('5200', 'Biaya Bahan Baku', 'COGS'),
  ('5300', 'Biaya Tenaga Kerja Langsung', 'COGS'),
  ('5400', 'Biaya Overhead Pabrik', 'COGS'),
  -- EXPENSE
  ('6000', 'Beban Operasional', 'EXPENSE'),
  ('6100', 'Beban Gaji & Tunjangan', 'EXPENSE'),
  ('6200', 'Beban Sewa', 'EXPENSE'),
  ('6300', 'Beban Utilitas', 'EXPENSE'),
  ('6400', 'Beban Pemasaran', 'EXPENSE'),
  ('6500', 'Beban Administrasi', 'EXPENSE'),
  ('6600', 'Beban Penyusutan', 'EXPENSE'),
  ('6700', 'Beban Pajak', 'EXPENSE'),
  ('6900', 'Beban Lain-lain', 'EXPENSE')
ON CONFLICT (code) DO NOTHING;

-- Product Categories
INSERT INTO product_categories (name, code) VALUES
  ('Bahan Baku', 'RAW'),
  ('Barang Jadi', 'FG'),
  ('Suku Cadang', 'SPARE'),
  ('Perlengkapan Kantor', 'OFFICE'),
  ('Packaging', 'PKG')
ON CONFLICT (code) DO NOTHING;

-- Sample Products
INSERT INTO products (sku, name, category_id, unit, unit_cost, selling_price, current_stock, reorder_point, is_raw_material, is_finished_good) VALUES
  ('RM-001', 'Aluminium Sheet 1mm', 1, 'kg', 25000, 0, 500, 100, true, false),
  ('RM-002', 'Besi Hollow 40x40', 1, 'batang', 85000, 0, 200, 50, true, false),
  ('RM-003', 'Cat Primer', 1, 'liter', 45000, 0, 100, 20, true, false),
  ('FG-001', 'Rak Besi Serbaguna 5 Tingkat', 2, 'unit', 350000, 650000, 50, 10, false, true),
  ('FG-002', 'Lemari Arsip Besi', 2, 'unit', 550000, 950000, 30, 5, false, true),
  ('PKG-001', 'Kardus Box Besar', 5, 'pcs', 15000, 0, 200, 50, false, false)
ON CONFLICT (sku) DO NOTHING;

-- Sample Supplier
INSERT INTO suppliers (code, name, email, phone, address, city, payment_terms) VALUES
  ('SUP-001', 'PT. Baja Nusantara', 'order@bajanusantara.com', '021-55551111', 'Jl. Industri No. 10, Bekasi', 'Bekasi', 30),
  ('SUP-002', 'CV. Material Jaya', 'cs@materialjaya.id', '021-55552222', 'Jl. Raya Cakung No. 5, Jakarta', 'Jakarta', 14)
ON CONFLICT (code) DO NOTHING;

-- Sample Customer
INSERT INTO customers (code, name, email, phone, city, payment_terms) VALUES
  ('CUST-001', 'PT. Maju Bersama', 'purchasing@majubersama.co.id', '021-77771111', 'Jakarta', 30),
  ('CUST-002', 'CV. Karya Mandiri', 'admin@karyamandiri.com', '031-77772222', 'Surabaya', 14),
  ('CUST-003', 'Toko Besi Sejahtera', 'order@tokobesi.id', '022-77773333', 'Bandung', 7)
ON CONFLICT (code) DO NOTHING;
