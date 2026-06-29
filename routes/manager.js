const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const { isAuthenticated, roleGuard } = require('../middleware/auth');
const db = require('../db');

router.use(isAuthenticated, roleGuard('manager', 'supervisor'));

async function getMonthSales(csrId, monthPrefix) {
  const entries = await db.prepare("SELECT * FROM sales_entries WHERE csrId = ? AND date LIKE ?").all(csrId, `${monthPrefix}%`);
  let totalValue = 0, totalUnits = 0;
  for (const e of entries) {
    const items = await db.prepare("SELECT COALESCE(SUM(salesValue), 0) as val, COALESCE(SUM(quantity), 0) as qty FROM sales_entry_items WHERE entryId = ?").get(e.id);
    totalValue += items.val; totalUnits += items.qty;
  }
  const presentDays = entries.filter(e => e.isPresent).length;
  return { totalValue, totalUnits, presentDays };
}

async function getCsrPayData(csrId, monthPrefix) {
  const tierRow = await db.prepare("SELECT t.* FROM target_tiers t INNER JOIN csr_tier ct ON ct.tierId = t.id WHERE ct.csrId = ?").get(csrId);
  const sales = await getMonthSales(csrId, monthPrefix);
  const target = tierRow ? tierRow.monthlyTarget : 0;
  const baseSalary = tierRow ? tierRow.monthlySalary : 0;
  const percentTarget = target > 0 ? Math.round((sales.totalValue / target) * 100) : 0;
  const earnedPay = target > 0 ? Math.round((sales.totalValue / target) * baseSalary) : 0;
  const paid = await db.prepare('SELECT id FROM payment_history WHERE csrId = ? AND month = ?').get(csrId, monthPrefix);
  return { ...sales, totalSales: sales.totalValue, tierName: tierRow ? tierRow.name : 'Unassigned', target, baseSalary, percentTarget, earnedPay, isPaid: !!paid };
}

router.get('/dashboard', async (req, res) => {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const csrs = await db.prepare("SELECT * FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL").all();
  const payouts = [];
  for (const csr of csrs) {
    const payData = await getCsrPayData(csr.id, currentMonth);
    payouts.push({ ...csr, ...payData });
  }
  res.render('manager/dashboard', { payouts, currentMonth, user: req.session.user });
});

router.get('/daily', async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const csrs = await db.prepare("SELECT * FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL").all();
  const dailyData = [];
  for (const csr of csrs) {
    const entries = await db.prepare("SELECT * FROM sales_entries WHERE csrId = ? AND date = ?").all(csr.id, date);
    const isPresent = entries.some(e => e.isPresent);
    let totalValue = 0, totalUnits = 0, items = [];
    for (const e of entries) {
      const eItems = await db.prepare("SELECT sei.*, p.name AS productName, p.grammage AS productGrammage FROM sales_entry_items sei LEFT JOIN products p ON sei.productId = p.id WHERE sei.entryId = ?").all(e.id);
      items = items.concat(eItems);
      totalValue += eItems.reduce((s, i) => s + i.salesValue, 0);
      totalUnits += eItems.reduce((s, i) => s + i.quantity, 0);
    }
    const tierRow = await db.prepare("SELECT t.* FROM target_tiers t INNER JOIN csr_tier ct ON ct.tierId = t.id WHERE ct.csrId = ?").get(csr.id);
    dailyData.push({ ...csr, tierName: tierRow ? tierRow.name : 'Unassigned', isPresent, totalValue, totalUnits, items });
  }
  res.render('manager/daily', { dailyData, date, user: req.session.user });
});

router.get('/weekly', async (req, res) => {
  let weekStart, weekEnd;
  if (req.query.start) {
    weekStart = req.query.start;
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 6);
    weekEnd = d.toISOString().split('T')[0];
  } else {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    weekStart = monday.toISOString().split('T')[0];
    weekEnd = sunday.toISOString().split('T')[0];
  }
  const csrs = await db.prepare("SELECT * FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL").all();
  const weeklyData = [];
  for (const csr of csrs) {
    const entries = await db.prepare("SELECT * FROM sales_entries WHERE csrId = ? AND date >= ? AND date <= ?").all(csr.id, weekStart, weekEnd);
    const presentDays = entries.filter(e => e.isPresent).length;
    let totalValue = 0, totalUnits = 0;
    for (const e of entries) {
      const items = await db.prepare("SELECT COALESCE(SUM(salesValue), 0) as val, COALESCE(SUM(quantity), 0) as qty FROM sales_entry_items WHERE entryId = ?").get(e.id);
      totalValue += items.val; totalUnits += items.qty;
    }
    const tierRow = await db.prepare("SELECT t.* FROM target_tiers t INNER JOIN csr_tier ct ON ct.tierId = t.id WHERE ct.csrId = ?").get(csr.id);
    weeklyData.push({ ...csr, tierName: tierRow ? tierRow.name : 'Unassigned', presentDays, totalValue, totalUnits });
  }
  res.render('manager/weekly', { weeklyData, weekStart, weekEnd, user: req.session.user });
});

router.get('/monthly', async (req, res) => {
  const month = req.query.month || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const monthName = new Date(month + '-01').toLocaleString('default', { month: 'long', year: 'numeric' });
  const csrs = await db.prepare("SELECT * FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL").all();
  const monthlyData = [];
  for (const csr of csrs) {
    const payData = await getCsrPayData(csr.id, month);
    monthlyData.push({ ...csr, ...payData });
  }
  const paidTotal = monthlyData.reduce((s, c) => s + c.earnedPay, 0);
  res.render('manager/monthly', { monthlyData, monthName, month, paidTotal, user: req.session.user });
});

router.post('/csr/remove/:csrId', async (req, res) => {
  await db.prepare("UPDATE users SET isActive = 0, removedBy = ?, removedAt = NOW() WHERE id = ?")
    .run(req.session.user.id, parseInt(req.params.csrId));
  res.redirect('/manager/dashboard');
});

router.get('/removed', async (req, res) => {
  const removedCsrs = await db.prepare(`
    SELECT u.*, r.fullName AS removedByName,
      (SELECT COALESCE(SUM(sei.salesValue), 0) FROM sales_entry_items sei
       INNER JOIN sales_entries se ON sei.entryId = se.id
       WHERE se.csrId = u.id AND se.date LIKE CONCAT(DATE_FORMAT(u.removedAt, '%Y-%m'), '%')) AS lastMonthSales
    FROM users u LEFT JOIN users r ON u.removedBy = r.id
    WHERE u.role = 'csr' AND u.removedAt IS NOT NULL ORDER BY u.removedAt DESC
  `).all();

  const result = [];
  for (const c of removedCsrs) {
    const removedMonth = c.removedAt ? new Date(c.removedAt).toISOString().substring(0, 7) : '';
    const tierRow = await db.prepare("SELECT t.* FROM target_tiers t INNER JOIN csr_tier ct ON ct.tierId = t.id WHERE ct.csrId = ?").get(c.id);
    const target = tierRow ? tierRow.monthlyTarget : 0;
    const baseSalary = tierRow ? tierRow.monthlySalary : 0;
    const sales = c.lastMonthSales || 0;
    const earnedPay = target > 0 ? Math.round((sales / target) * baseSalary) : 0;
    const paid = await db.prepare('SELECT id FROM payment_history WHERE csrId = ? AND month = ?').get(c.id, removedMonth);
    result.push({ ...c, removedMonth, target, baseSalary, earnedPay, isPaid: !!paid, outstanding: paid ? 0 : earnedPay });
  }

  res.render('manager/removed', { removedCsrs: result, user: req.session.user });
});

router.post('/payment/confirm/:csrId', async (req, res) => {
  const { month } = req.body;
  const csrId = parseInt(req.params.csrId);
  const payData = await getCsrPayData(csrId, month);
  const existing = await db.prepare('SELECT id FROM payment_history WHERE csrId = ? AND month = ?').get(csrId, month);
  if (!existing) {
    await db.prepare("INSERT INTO payment_history (csrId, month, totalSales, target, baseSalary, earnedPay, percentTarget, confirmedBy, confirmedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())")
      .run(csrId, month, payData.totalValue, payData.target, payData.baseSalary, payData.earnedPay, payData.percentTarget, req.session.user.id);
  }
  res.redirect(req.get('Referer') || '/manager/dashboard');
});

router.post('/payment/bulk', async (req, res) => {
  const { csrIds, month } = req.body;
  const ids = Array.isArray(csrIds) ? csrIds : (csrIds ? [csrIds] : []);
  await db.transaction(async (tx) => {
    for (const csrId of ids) {
      const id = parseInt(csrId);
      const existing = await tx.prepare('SELECT id FROM payment_history WHERE csrId = ? AND month = ?').get(id, month);
      if (existing) continue;
      const payData = await getCsrPayData(id, month);
      if (payData.earnedPay > 0) {
        await tx.prepare("INSERT INTO payment_history (csrId, month, totalSales, target, baseSalary, earnedPay, percentTarget, confirmedBy, confirmedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())")
          .run(id, month, payData.totalValue, payData.target, payData.baseSalary, payData.earnedPay, payData.percentTarget, req.session.user.id);
      }
    }
  });
  res.redirect(req.get('Referer') || '/manager/dashboard');
});

router.get('/payment/history', async (req, res) => {
  const history = await db.prepare(`
    SELECT ph.*, u.fullName AS csrName, u.phoneNumber, u.state, c.fullName AS confirmedByName
    FROM payment_history ph
    INNER JOIN users u ON ph.csrId = u.id
    LEFT JOIN users c ON ph.confirmedBy = c.id
    ORDER BY ph.month DESC, u.fullName
  `).all();
  const months = [...new Set(history.map(h => h.month))].sort().reverse();
  res.render('manager/payment-history', { history, months, user: req.session.user });
});

router.get('/aggregate', async (req, res) => {
  const dates = await db.prepare("SELECT DISTINCT date FROM sales_entries ORDER BY date DESC").all();
  const allData = [];
  for (const d of dates) {
    const entries = await db.prepare("SELECT se.*, u.fullName AS csrName, u.phoneNumber, u.state FROM sales_entries se LEFT JOIN users u ON se.csrId = u.id WHERE se.date = ? ORDER BY u.fullName").all(d.date);
    const dayData = [];
    for (const e of entries) {
      const items = await db.prepare("SELECT sei.*, p.name AS productName, p.grammage AS productGrammage FROM sales_entry_items sei LEFT JOIN products p ON sei.productId = p.id WHERE sei.entryId = ?").all(e.id);
      dayData.push({ ...e, items, totalValue: items.reduce((s, i) => s + i.salesValue, 0) });
    }
    allData.push({ date: d.date, entries: dayData });
  }
  res.render('manager/aggregateView', { allData, user: req.session.user });
});

router.get('/paytable/export', async (req, res) => {
  const month = req.query.month || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const csrs = await db.prepare("SELECT * FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL").all();
  const data = [];
  for (const csr of csrs) {
    const payData = await getCsrPayData(csr.id, month);
    data.push({ 'CSR Name': csr.fullName, 'Phone': csr.phoneNumber || '', 'State': csr.state || '', 'Tier': payData.tierName, 'Monthly Target': payData.target, 'Monthly Salary': payData.baseSalary, 'Days Present': payData.presentDays, 'Total Units': payData.totalUnits, 'Total Sales': payData.totalValue, '% of Target': payData.percentTarget + '%', 'Earned Pay': payData.earnedPay });
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [{ wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 22 }, { wch: 15 }, { wch: 15 }, { wch: 13 }, { wch: 13 }, { wch: 18 }, { wch: 15 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Pay Table');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename=paytable-${month}.xlsx`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

module.exports = router;