-- ============================================================
-- ERP SYSTEM - COMPLETE DATABASE SCHEMA
-- PostgreSQL
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- SETTINGS MODULE
-- ============================================================
CREATE TABLE IF NOT EXISTS company_profile (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  npwp VARCHAR(50),
  tax_number VARCHAR(50),
  address TEXT,
  city VARCHAR(100),
  province VARCHAR(100),
  postal_code VARCHAR(10),
  phone VARCHAR(30),
  email VARCHAR(100),
  website VARCHAR(200),
  logo_url TEXT,
  bank_name VARCHAR(100),
  bank_account VARCHAR(50),
  bank_account_name VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS system_preferences (
  id SERIAL PRIMARY KEY,
  key VARCHAR(100) UNIQUE NOT NULL,
  value TEXT,
  description VARCHAR(255),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(20) UNIQUE NOT NULL,
  description TEXT,
  manager_id INTEGER,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS positions (
  id SERIAL PRIMARY KEY,
  title VARCHAR(100) NOT NULL,
  code VARCHAR(20) UNIQUE,
  department_id INTEGER REFERENCES departments(id),
  level INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  role VARCHAR(30) NOT NULL DEFAULT 'STAFF',  -- SUPER_ADMIN, ADMIN, MANAGER, FINANCE, HR, STAFF, VIEW_ONLY
  phone VARCHAR(30),
  department_id INTEGER REFERENCES departments(id),
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permissions (
  id SERIAL PRIMARY KEY,
  module VARCHAR(50) NOT NULL,
  action VARCHAR(50) NOT NULL,
  description VARCHAR(255),
  UNIQUE(module, action)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  id SERIAL PRIMARY KEY,
  role VARCHAR(30) NOT NULL,
  permission_id INTEGER REFERENCES permissions(id),
  UNIQUE(role, permission_id)
);

-- ============================================================
-- CHART OF ACCOUNTS
-- ============================================================
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id SERIAL PRIMARY KEY,
  code VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(150) NOT NULL,
  account_type VARCHAR(30) NOT NULL, -- ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE, COGS
  parent_id INTEGER REFERENCES chart_of_accounts(id),
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- FINANCE MODULE
-- ============================================================
CREATE TABLE IF NOT EXISTS journal_entries (
  id SERIAL PRIMARY KEY,
  reference_number VARCHAR(50) UNIQUE,
  entry_date DATE NOT NULL,
  description TEXT NOT NULL,
  type VARCHAR(30), -- REVENUE, EXPENSE, ADJUSTMENT
  total_amount DECIMAL(15,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'DRAFT', -- DRAFT, POSTED, REVERSED
  source_module VARCHAR(30), -- AUTO-GENERATED SOURCE
  source_id INTEGER,
  created_by INTEGER REFERENCES users(id),
  posted_by INTEGER REFERENCES users(id),
  posted_at TIMESTAMPTZ,
  reversed_by INTEGER REFERENCES users(id),
  reversed_at TIMESTAMPTZ,
  reversal_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id SERIAL PRIMARY KEY,
  journal_entry_id INTEGER REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id INTEGER REFERENCES chart_of_accounts(id),
  description TEXT,
  debit DECIMAL(15,2) DEFAULT 0,
  credit DECIMAL(15,2) DEFAULT 0,
  line_order INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS general_ledger (
  id SERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES chart_of_accounts(id),
  journal_entry_id INTEGER REFERENCES journal_entries(id),
  entry_date DATE NOT NULL,
  debit DECIMAL(15,2) DEFAULT 0,
  credit DECIMAL(15,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INVENTORY MODULE
-- ============================================================
CREATE TABLE IF NOT EXISTS product_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(20) UNIQUE,
  parent_id INTEGER REFERENCES product_categories(id),
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  sku VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  category_id INTEGER REFERENCES product_categories(id),
  unit VARCHAR(20) NOT NULL,
  unit_cost DECIMAL(15,2) DEFAULT 0,
  selling_price DECIMAL(15,2) DEFAULT 0,
  current_stock DECIMAL(12,3) DEFAULT 0,
  reserved_stock DECIMAL(12,3) DEFAULT 0,
  minimum_stock DECIMAL(12,3) DEFAULT 0,
  reorder_point DECIMAL(12,3) DEFAULT 0,
  is_raw_material BOOLEAN DEFAULT false,
  is_finished_good BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id),
  movement_type VARCHAR(30) NOT NULL, -- IN, OUT, INITIAL, SALE, PRODUCTION_IN, PRODUCTION_OUT, RETURN, DAMAGE, ADJUSTMENT
  quantity DECIMAL(12,3) NOT NULL,
  unit_cost DECIMAL(15,2),
  stock_before DECIMAL(12,3),
  stock_after DECIMAL(12,3),
  reference_id INTEGER,
  reference_type VARCHAR(30),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PURCHASE MODULE
-- ============================================================
CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  code VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL,
  email VARCHAR(100),
  phone VARCHAR(30),
  address TEXT,
  city VARCHAR(100),
  npwp VARCHAR(50),
  bank_name VARCHAR(100),
  bank_account VARCHAR(50),
  payment_terms INTEGER DEFAULT 30, -- days
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_requisitions (
  id SERIAL PRIMARY KEY,
  requested_by INTEGER REFERENCES users(id),
  department_id INTEGER REFERENCES departments(id),
  needed_by DATE,
  justification TEXT,
  status VARCHAR(20) DEFAULT 'PENDING', -- PENDING, APPROVED, REJECTED, PO_CREATED
  approved_by INTEGER REFERENCES users(id),
  approval_notes TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_requisition_items (
  id SERIAL PRIMARY KEY,
  pr_id INTEGER REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  description TEXT,
  quantity DECIMAL(12,3) NOT NULL,
  estimated_unit_price DECIMAL(15,2)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id SERIAL PRIMARY KEY,
  po_number VARCHAR(30) UNIQUE NOT NULL,
  supplier_id INTEGER REFERENCES suppliers(id),
  pr_id INTEGER REFERENCES purchase_requisitions(id),
  expected_delivery DATE,
  received_date DATE,
  total_amount DECIMAL(15,2) DEFAULT 0,
  notes TEXT,
  payment_terms INTEGER DEFAULT 30,
  status VARCHAR(20) DEFAULT 'PENDING', -- PENDING, APPROVED, SENT, PARTIAL, RECEIVED, CANCELLED
  company_name VARCHAR(255),
  company_npwp VARCHAR(50),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id SERIAL PRIMARY KEY,
  po_id INTEGER REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  description TEXT,
  quantity DECIMAL(12,3) NOT NULL,
  received_quantity DECIMAL(12,3) DEFAULT 0,
  unit_price DECIMAL(15,2) NOT NULL,
  line_total DECIMAL(15,2)
);

-- ============================================================
-- CUSTOMERS
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  code VARCHAR(20) UNIQUE,
  name VARCHAR(200) NOT NULL,
  email VARCHAR(100),
  phone VARCHAR(30),
  address TEXT,
  city VARCHAR(100),
  npwp VARCHAR(50),
  credit_limit DECIMAL(15,2) DEFAULT 0,
  payment_terms INTEGER DEFAULT 30,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SALES MODULE
-- ============================================================
CREATE TABLE IF NOT EXISTS sales_orders (
  id SERIAL PRIMARY KEY,
  so_number VARCHAR(30) UNIQUE NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  order_date DATE NOT NULL,
  delivery_date DATE,
  shipping_date DATE,
  subtotal DECIMAL(15,2) DEFAULT 0,
  discount_amount DECIMAL(15,2) DEFAULT 0,
  total_amount DECIMAL(15,2) DEFAULT 0,
  notes TEXT,
  payment_terms INTEGER DEFAULT 30,
  tracking_number VARCHAR(100),
  shipping_notes TEXT,
  status VARCHAR(20) DEFAULT 'PENDING', -- PENDING, CONFIRMED, SHIPPED, COMPLETED, CANCELLED
  confirmed_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_order_items (
  id SERIAL PRIMARY KEY,
  sales_order_id INTEGER REFERENCES sales_orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  quantity DECIMAL(12,3) NOT NULL,
  unit_price DECIMAL(15,2) NOT NULL,
  line_total DECIMAL(15,2)
);

-- ============================================================
-- INVOICE MODULE
-- ============================================================
CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  invoice_number VARCHAR(30) UNIQUE NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  sales_order_id INTEGER REFERENCES sales_orders(id),
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL,
  subtotal DECIMAL(15,2) DEFAULT 0,
  discount_amount DECIMAL(15,2) DEFAULT 0,
  tax_rate DECIMAL(5,2) DEFAULT 11,
  tax_amount DECIMAL(15,2) DEFAULT 0,
  total_amount DECIMAL(15,2) DEFAULT 0,
  paid_amount DECIMAL(15,2) DEFAULT 0,
  notes TEXT,
  status VARCHAR(20) DEFAULT 'DRAFT', -- DRAFT, SENT, PARTIAL, PAID, OVERDUE, CANCELLED
  sent_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  description TEXT,
  quantity DECIMAL(12,3) NOT NULL,
  unit_price DECIMAL(15,2) NOT NULL,
  discount_pct DECIMAL(5,2) DEFAULT 0,
  line_total DECIMAL(15,2),
  line_order INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS invoice_payments (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER REFERENCES invoices(id),
  amount DECIMAL(15,2) NOT NULL,
  payment_date DATE NOT NULL,
  payment_method VARCHAR(50), -- TRANSFER, CASH, CHECK, GIRO
  reference VARCHAR(100),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PRODUCTION MODULE
-- ============================================================
CREATE TABLE IF NOT EXISTS bom_headers (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id),
  quantity_produced DECIMAL(12,3) DEFAULT 1,
  version INTEGER DEFAULT 1,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bom_items (
  id SERIAL PRIMARY KEY,
  bom_id INTEGER REFERENCES bom_headers(id) ON DELETE CASCADE,
  material_id INTEGER REFERENCES products(id),
  quantity DECIMAL(12,3) NOT NULL,
  unit VARCHAR(20),
  scrap_pct DECIMAL(5,2) DEFAULT 0,
  line_order INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS work_orders (
  id SERIAL PRIMARY KEY,
  wo_number VARCHAR(30) UNIQUE NOT NULL,
  product_id INTEGER REFERENCES products(id),
  bom_id INTEGER REFERENCES bom_headers(id),
  so_id INTEGER REFERENCES sales_orders(id),
  quantity DECIMAL(12,3) NOT NULL,
  actual_quantity DECIMAL(12,3),
  defect_quantity DECIMAL(12,3) DEFAULT 0,
  deadline TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'PENDING', -- PENDING, IN_PROGRESS, COMPLETED, CANCELLED
  material_status VARCHAR(20) DEFAULT 'UNKNOWN', -- READY, INSUFFICIENT, UNKNOWN
  labor_cost DECIMAL(15,2) DEFAULT 0,
  overhead_cost DECIMAL(15,2) DEFAULT 0,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS qc_records (
  id SERIAL PRIMARY KEY,
  work_order_id INTEGER REFERENCES work_orders(id),
  actual_quantity DECIMAL(12,3),
  passed_quantity DECIMAL(12,3),
  defect_quantity DECIMAL(12,3) DEFAULT 0,
  qc_notes TEXT,
  qc_by INTEGER REFERENCES users(id),
  qc_date TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- HR MODULE
-- ============================================================
CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  employee_number VARCHAR(20) UNIQUE NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(100) UNIQUE,
  phone VARCHAR(30),
  nik VARCHAR(20) UNIQUE,
  gender VARCHAR(10),
  birth_date DATE,
  address TEXT,
  department_id INTEGER REFERENCES departments(id),
  position_id INTEGER REFERENCES positions(id),
  hire_date DATE NOT NULL,
  employment_status VARCHAR(20) DEFAULT 'PROBATION', -- PROBATION, ACTIVE, INACTIVE, TERMINATED
  employment_type VARCHAR(20) DEFAULT 'FULL_TIME', -- FULL_TIME, PART_TIME, CONTRACT
  basic_salary DECIMAL(15,2) DEFAULT 0,
  bank_name VARCHAR(100),
  bank_account VARCHAR(50),
  npwp VARCHAR(50),
  bpjs_kes VARCHAR(50),
  bpjs_tk VARCHAR(50),
  marital_status VARCHAR(5) DEFAULT 'TK', -- TK, K
  dependents INTEGER DEFAULT 0,
  leave_balance INTEGER DEFAULT 12,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id),
  date DATE NOT NULL,
  check_in TIME,
  check_out TIME,
  overtime_hours DECIMAL(4,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'PRESENT', -- PRESENT, ABSENT, LEAVE, SICK, HOLIDAY
  notes TEXT,
  recorded_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, date)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id),
  leave_type VARCHAR(30) NOT NULL, -- ANNUAL, SICK, MATERNITY, PATERNITY, UNPAID
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  total_days INTEGER NOT NULL,
  reason TEXT,
  status VARCHAR(20) DEFAULT 'PENDING', -- PENDING, APPROVED, REJECTED
  approved_by INTEGER REFERENCES users(id),
  approval_notes TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PAYROLL MODULE
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_allowances (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id),
  name VARCHAR(100) NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  is_taxable BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS employee_deductions (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id),
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  name VARCHAR(100) NOT NULL,
  amount DECIMAL(15,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id SERIAL PRIMARY KEY,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  status VARCHAR(20) DEFAULT 'DRAFT', -- DRAFT, APPROVED, PROCESSED, CANCELLED
  total_gross DECIMAL(15,2) DEFAULT 0,
  total_net DECIMAL(15,2) DEFAULT 0,
  payment_date DATE,
  created_by INTEGER REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  processed_by INTEGER REFERENCES users(id),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payroll_details (
  id SERIAL PRIMARY KEY,
  payroll_run_id INTEGER REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id INTEGER REFERENCES employees(id),
  basic_salary DECIMAL(15,2) DEFAULT 0,
  allowance_total DECIMAL(15,2) DEFAULT 0,
  overtime_pay DECIMAL(15,2) DEFAULT 0,
  absent_deduction DECIMAL(15,2) DEFAULT 0,
  gross_salary DECIMAL(15,2) DEFAULT 0,
  bpjs_kes_employee DECIMAL(15,2) DEFAULT 0,
  bpjs_tk_jht_employee DECIMAL(15,2) DEFAULT 0,
  bpjs_tk_jp_employee DECIMAL(15,2) DEFAULT 0,
  total_bpjs_employee DECIMAL(15,2) DEFAULT 0,
  pph21 DECIMAL(15,2) DEFAULT 0,
  other_deductions DECIMAL(15,2) DEFAULT 0,
  total_deductions DECIMAL(15,2) DEFAULT 0,
  net_salary DECIMAL(15,2) DEFAULT 0,
  present_days INTEGER DEFAULT 0,
  absent_days INTEGER DEFAULT 0,
  overtime_hours DECIMAL(6,2) DEFAULT 0
);

-- ============================================================
-- ACTIVITY LOG MODULE
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  module VARCHAR(50) NOT NULL,
  action VARCHAR(100) NOT NULL,
  description TEXT,
  level VARCHAR(10) DEFAULT 'INFO', -- INFO, WARNING, ERROR, CRITICAL
  entity_type VARCHAR(50),
  entity_id INTEGER,
  old_data JSONB,
  new_data JSONB,
  ip_address VARCHAR(50),
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_stock ON products(current_stock);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(entry_date, status);
CREATE INDEX IF NOT EXISTS idx_general_ledger_account ON general_ledger(account_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_sales_orders_customer ON sales_orders(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_sales_orders_date ON sales_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_due ON invoices(due_date, status);
CREATE INDEX IF NOT EXISTS idx_attendance_emp_date ON attendance(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status, deadline);
CREATE INDEX IF NOT EXISTS idx_activity_logs_module ON activity_logs(module, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON activity_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_logs_level ON activity_logs(level, created_at);

-- ============================================================
-- SEQUENCES untuk nomor dokumen (hindari race condition)
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS so_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS po_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS pr_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS wo_number_seq START 1;
