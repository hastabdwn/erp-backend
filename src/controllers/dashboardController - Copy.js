const { query } = require('../config/database');
const { successResponse, errorResponse } = require('../utils/response');

// Main dashboard summary
const getSummary = async (req, res, next) => {
  try {
    const { period = '30' } = req.query; // days
    const days = parseInt(period);

    const [
      financialStats,
      salesStats,
      purchaseStats,
      inventoryStats,
      productionStats,
      hrStats,
      recentActivities,
      cashFlow,
      topProducts,
      overdueInvoices
    ] = await Promise.all([
      getFinancialStats(days),
      getSalesStats(days),
      getPurchaseStats(days),
      getInventoryStats(),
      getProductionStats(days),
      getHRStats(),
      getRecentActivities(10),
      getCashFlowChart(days),
      getTopSellingProducts(5),
      getOverdueInvoices()
    ]);

    return successResponse(res, {
      period: `${days} hari terakhir`,
      financial: financialStats,
      sales: salesStats,
      purchases: purchaseStats,
      inventory: inventoryStats,
      production: productionStats,
      hr: hrStats,
      recent_activity: recentActivities,
      cashflow_chart: cashFlow,
      top_products: topProducts,
      overdue_invoices: overdueInvoices
    });
  } catch (err) {
    next(err);
  }
};

const getFinancialStats = async (days) => {
  const result = await query(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'REVENUE' THEN total_amount ELSE 0 END), 0) as total_revenue,
      COALESCE(SUM(CASE WHEN type = 'EXPENSE' THEN total_amount ELSE 0 END), 0) as total_expense,
      COALESCE(SUM(CASE WHEN type = 'REVENUE' THEN total_amount ELSE -total_amount END), 0) as net_profit,
      COUNT(CASE WHEN type = 'REVENUE' THEN 1 END) as revenue_transactions,
      COUNT(CASE WHEN type = 'EXPENSE' THEN 1 END) as expense_count
    FROM journal_entries
    WHERE entry_date >= NOW() - INTERVAL '${days} days'
    AND status = 'POSTED'
  `);
  
  // Accounts Receivable
  const ar = await query(`
    SELECT 
      COALESCE(SUM(CASE WHEN status NOT IN ('PAID','CANCELLED') THEN total_amount ELSE 0 END), 0) as total_ar,
      COALESCE(SUM(CASE WHEN status = 'OVERDUE' THEN total_amount ELSE 0 END), 0) as overdue_ar
    FROM invoices
  `);

  // Accounts Payable
  const ap = await query(`
    SELECT COALESCE(SUM(CASE WHEN status NOT IN ('PAID','CANCELLED') THEN total_amount ELSE 0 END), 0) as total_ap
    FROM purchase_orders WHERE status = 'RECEIVED'
  `);

  return {
    ...result.rows[0],
    accounts_receivable: ar.rows[0].total_ar,
    overdue_ar: ar.rows[0].overdue_ar,
    accounts_payable: ap.rows[0].total_ap
  };
};

const getSalesStats = async (days) => {
  const result = await query(`
    SELECT
      COUNT(*) as total_orders,
      COALESCE(SUM(total_amount), 0) as total_revenue,
      COALESCE(AVG(total_amount), 0) as avg_order_value,
      COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) as completed_orders,
      COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pending_orders,
      COUNT(CASE WHEN status = 'CONFIRMED' THEN 1 END) as confirmed_orders
    FROM sales_orders
    WHERE created_at >= NOW() - INTERVAL '${days} days'
    AND status != 'CANCELLED'
  `);

  // Period comparison
  const prev = await query(`
    SELECT COALESCE(SUM(total_amount), 0) as prev_revenue
    FROM sales_orders
    WHERE created_at BETWEEN NOW() - INTERVAL '${days * 2} days' AND NOW() - INTERVAL '${days} days'
    AND status != 'CANCELLED'
  `);

  const current = parseFloat(result.rows[0].total_revenue);
  const previous = parseFloat(prev.rows[0].prev_revenue);
  const growth = previous > 0 ? ((current - previous) / previous * 100).toFixed(1) : null;

  return { ...result.rows[0], growth_percentage: growth };
};

const getPurchaseStats = async (days) => {
  const result = await query(`
    SELECT
      COUNT(*) as total_orders,
      COALESCE(SUM(total_amount), 0) as total_amount,
      COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pending_prs,
      COUNT(CASE WHEN status = 'APPROVED' THEN 1 END) as approved_po,
      COUNT(CASE WHEN status = 'RECEIVED' THEN 1 END) as received_po
    FROM purchase_orders
    WHERE created_at >= NOW() - INTERVAL '${days} days'
  `);
  return result.rows[0];
};

const getInventoryStats = async () => {
  const result = await query(`
    SELECT
      COUNT(*) as total_products,
      COUNT(CASE WHEN current_stock::numeric <= reorder_point::numeric THEN 1 END) as low_stock_count,
      COUNT(CASE WHEN current_stock = 0 THEN 1 END) as out_of_stock_count,
      COALESCE(SUM(current_stock * unit_cost), 0) as total_value
    FROM products
    WHERE is_active = true
  `);
  
  const lowStock = await query(`
    SELECT id, name, sku, current_stock, reorder_point, unit
    FROM products
    WHERE current_stock::numeric <= reorder_point::numeric AND is_active = true
    ORDER BY current_stock ASC LIMIT 5
  `);

  return { ...result.rows[0], critical_items: lowStock.rows };
};

const getProductionStats = async (days) => {
  const result = await query(`
    SELECT
      COUNT(*) as total_work_orders,
      COUNT(CASE WHEN status = 'IN_PROGRESS' THEN 1 END) as in_progress,
      COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) as completed,
      COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pending,
      COUNT(CASE WHEN deadline < NOW() AND status NOT IN ('COMPLETED','CANCELLED') THEN 1 END) as overdue
    FROM work_orders
    WHERE created_at >= NOW() - INTERVAL '${days} days'
  `);
  return result.rows[0];
};

const getHRStats = async () => {
  const result = await query(`
    SELECT
      COUNT(*) as total_employees,
      COUNT(CASE WHEN employment_status = 'ACTIVE' THEN 1 END) as active_employees,
      COUNT(CASE WHEN employment_status = 'PROBATION' THEN 1 END) as on_probation,
      COUNT(CASE WHEN DATE_PART('month', hire_date) = DATE_PART('month', NOW())
                  AND DATE_PART('year', hire_date) = DATE_PART('year', NOW()) THEN 1 END) as new_this_month
    FROM employees
  `);

  const leaves = await query(`
    SELECT COUNT(*) as pending_leaves
    FROM leave_requests WHERE status = 'PENDING'
  `);

  const todayAttendance = await query(`
    SELECT
      COUNT(CASE WHEN status = 'PRESENT' THEN 1 END) as present_today,
      COUNT(CASE WHEN status = 'ABSENT' THEN 1 END) as absent_today
    FROM attendance
    WHERE date = CURRENT_DATE
  `);

  return {
    ...result.rows[0],
    pending_leaves: leaves.rows[0].pending_leaves,
    present_today: todayAttendance.rows[0].present_today,
    absent_today: todayAttendance.rows[0].absent_today
  };
};

const getRecentActivities = async (limit) => {
  const result = await query(`
    SELECT al.id, al.module, al.action, al.description, al.level,
           al.created_at, u.full_name as user_name, u.username
    FROM activity_logs al
    LEFT JOIN users u ON al.user_id = u.id
    ORDER BY al.created_at DESC
    LIMIT $1
  `, [limit]);
  return result.rows;
};

const getCashFlowChart = async (days) => {
  const result = await query(`
    SELECT
      DATE_TRUNC('day', entry_date) as date,
      SUM(CASE WHEN type = 'REVENUE' THEN total_amount ELSE 0 END) as inflow,
      SUM(CASE WHEN type = 'EXPENSE' THEN total_amount ELSE 0 END) as outflow
    FROM journal_entries
    WHERE entry_date >= NOW() - INTERVAL '${days} days'
    AND status = 'POSTED'
    GROUP BY DATE_TRUNC('day', entry_date)
    ORDER BY date ASC
  `);
  return result.rows;
};

const getTopSellingProducts = async (limit) => {
  const result = await query(`
    SELECT 
      p.id, p.name, p.sku,
      SUM(soi.quantity) as total_qty,
      SUM(soi.quantity * soi.unit_price) as total_revenue
    FROM sales_order_items soi
    JOIN products p ON soi.product_id = p.id
    JOIN sales_orders so ON soi.sales_order_id = so.id
    WHERE so.created_at >= NOW() - INTERVAL '30 days'
    AND so.status != 'CANCELLED'
    GROUP BY p.id, p.name, p.sku
    ORDER BY total_qty DESC
    LIMIT $1
  `, [limit]);
  return result.rows;
};

const getOverdueInvoices = async () => {
  const result = await query(`
    SELECT i.id, i.invoice_number, i.due_date, i.total_amount, i.status,
           c.name as customer_name
    FROM invoices i
    JOIN customers c ON i.customer_id = c.id
    WHERE i.due_date < NOW() AND i.status NOT IN ('PAID','CANCELLED')
    ORDER BY i.due_date ASC
    LIMIT 10
  `);
  return result.rows;
};

// Module-specific widget data
const getFinancialWidget = async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        (SELECT COALESCE(SUM(total_amount), 0) FROM journal_entries WHERE type = 'REVENUE' AND status = 'POSTED' AND DATE_TRUNC('month', entry_date) = DATE_TRUNC('month', NOW())) as monthly_revenue,
        (SELECT COALESCE(SUM(total_amount), 0) FROM journal_entries WHERE type = 'EXPENSE' AND status = 'POSTED' AND DATE_TRUNC('month', entry_date) = DATE_TRUNC('month', NOW())) as monthly_expense,
        (SELECT COUNT(*) FROM journal_entries WHERE status = 'DRAFT') as draft_journals,
        (SELECT COALESCE(SUM(total_amount), 0) FROM invoices WHERE status NOT IN ('PAID','CANCELLED')) as total_receivable
    `);
    return successResponse(res, result.rows[0]);
  } catch (err) { next(err); }
};

const getSalesWidget = async (req, res, next) => {
  try {
    const daily = await query(`
      SELECT 
        DATE_TRUNC('day', created_at) as date,
        COUNT(*) as orders,
        SUM(total_amount) as revenue
      FROM sales_orders
      WHERE created_at >= NOW() - INTERVAL '7 days' AND status != 'CANCELLED'
      GROUP BY DATE_TRUNC('day', created_at)
      ORDER BY date
    `);
    return successResponse(res, { daily_chart: daily.rows });
  } catch (err) { next(err); }
};

const getInventoryWidget = async (req, res, next) => {
  try {
    const result = await query(`
      SELECT 
        c.name as category,
        COUNT(p.id) as product_count,
        SUM(p.current_stock * p.unit_cost) as value
      FROM products p
      JOIN product_categories c ON p.category_id = c.id
      WHERE p.is_active = true
      GROUP BY c.name
      ORDER BY value DESC
    `);
    return successResponse(res, result.rows);
  } catch (err) { next(err); }
};

module.exports = { getSummary, getFinancialWidget, getSalesWidget, getInventoryWidget };