const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const { isAuthenticated, roleGuard } = require('../middleware/auth');
const db = require('../db');

router.use(isAuthenticated, roleGuard('supervisor', 'csr'));

function getMonthSales(csrId, monthPrefix) {
  const entries = db.prepare("SELECT * FROM sales_entries WHERE csrId = ? AND date LIKE ?").all(csrId, `${monthPrefix}%`);
  let totalValue = 0, totalUnits = 0;
  entries.forEach(e => {
    const items = db.prepare("SELECT COALESCE(SUM(salesValue), 0) as val, COALESCE(SUM(quantity), 0) as qty FROM sales_entry_items WHERE entryId = ?").get(e.id);
    totalValue += items.val;
    totalUnits += items.qty;
  });
  const presentDays = entries.filter(e => e.isPresent).length;
  return { totalValue, totalUnits, presentDays, entryCount: entries.length };
}

function getCsrPayData(csrId, monthPrefix) {
  const tierRow = db.prepare("SELECT t.* FROM target_tiers t INNER JOIN csr_tier ct ON ct.tierId = t.id WHERE ct.csrId = ?").get(csrId);
  const sales = getMonthSales(csrId, monthPrefix);
  const target = tierRow ? tierRow.monthlyTarget : 0;
  const baseSalary = tierRow ? tierRow.monthlySalary : 0;
  const percentTarget = target > 0 ? Math.round((sales.totalValue / target) * 100) : 0;
  const earnedPay = target > 0 ? Math.round((sales.totalValue / target) * baseSalary) : 0;
  const paid = db.prepare('SELECT id FROM payment_history WHERE csrId = ? AND month = ?').get(csrId, monthPrefix);
  return { ...sales, monthlySales: sales.totalValue, totalSales: sales.totalValue, tierName: tierRow ? tierRow.name : 'Unassigned', target, baseSalary, percentTarget, earnedPay, isPaid: !!paid };
}

router.get('/dashboard', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const csrs = db.prepare("SELECT * FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL").all();
  const products = db.prepare("SELECT * FROM products WHERE isActive = 1 ORDER BY name").all();

  const csrData = csrs.map(csr => {
    const payData = getCsrPayData(csr.id, today.substring(0, 7));
    const todayEntries = db.prepare("SELECT * FROM sales_entries WHERE csrId = ? AND date = ?").all(csr.id, today);
    const dayClosed = todayEntries.length > 0 && todayEntries.every(e => e.dayClosed);
    const isPresent = todayEntries.some(e => e.isPresent);
    let todayItems = [];
    let todayValue = 0;
    todayEntries.forEach(e => {
      const items = db.prepare("SELECT sei.*, p.name AS productName, p.grammage AS productGrammage FROM sales_entry_items sei LEFT JOIN products p ON sei.productId = p.id WHERE sei.entryId = ?").all(e.id);
      todayItems = todayItems.concat(items);
      todayValue += items.reduce((s, i) => s + i.salesValue, 0);
    });
    const inventory = db.prepare("SELECT ci.*, p.name AS productName, p.grammage AS productGrammage FROM csr_inventory ci INNER JOIN products p ON ci.productId = p.id WHERE ci.csrId = ?").all(csr.id);
    return { ...csr, ...payData, todayItems, todayValue, isPresent, dayClosed, inventory };
  });

  const allDaysClosed = csrs.length > 0 && db.prepare("SELECT COUNT(*) as cnt FROM sales_entries WHERE date = ? AND dayClosed = 0").get(today).cnt === 0 && db.prepare("SELECT COUNT(*) as cnt FROM sales_entries WHERE date = ?").get(today).cnt > 0;

  res.render('supervisor/dashboard', { csrs, csrData, products, today, dayClosed: allDaysClosed, user: req.session.user, success: null, error: null });
});

router.post('/sales/log', (req, res) => {
  const { csrId, date, isPresent, productIds, quantities, unitPrices } = req.body;
  const csrIdInt = parseInt(csrId);

  const existingEntry = db.prepare("SELECT id, dayClosed FROM sales_entries WHERE csrId = ? AND date = ?").get(csrIdInt, date);
  if (existingEntry && existingEntry.dayClosed) return res.redirect('/supervisor/dashboard');

  const pIds = Array.isArray(productIds) ? productIds : [productIds];
  const qtys = Array.isArray(quantities) ? quantities : [quantities];
  const prices = Array.isArray(unitPrices) ? unitPrices : [unitPrices];

  for (let i = 0; i < pIds.length; i++) {
    if (!pIds[i] || pIds[i] === '') continue;
    const pid = parseInt(pIds[i]);
    const qty = parseInt(qtys[i]) || 0;
    if (qty <= 0) continue;
    const inv = db.prepare('SELECT quantity FROM csr_inventory WHERE csrId = ? AND productId = ?').get(csrIdInt, pid);
    if (!inv || inv.quantity < qty) return res.redirect('/supervisor/dashboard');
  }

  let entry = existingEntry;
  if (!entry) {
    const result = db.prepare("INSERT INTO sales_entries (csrId, date, isPresent, loggedBy) VALUES (?, ?, ?, ?)").run(csrIdInt, date, isPresent === 'on' ? 1 : 0, req.session.user.id);
    entry = { id: result.lastInsertRowid };
  } else {
    db.prepare("UPDATE sales_entries SET isPresent = ? WHERE id = ?").run(isPresent === 'on' ? 1 : 0, entry.id);
  }

  db.prepare("DELETE FROM sales_entry_items WHERE entryId = ?").run(entry.id);

  const insertItem = db.prepare("INSERT INTO sales_entry_items (entryId, productId, quantity, unitPrice, salesValue) VALUES (?, ?, ?, ?, ?)");
  const deductInv = db.prepare("UPDATE csr_inventory SET quantity = quantity - ?, lastUpdated = datetime('now') WHERE csrId = ? AND productId = ?");

  db.transaction(() => {
    for (let i = 0; i < pIds.length; i++) {
      if (!pIds[i] || pIds[i] === '') continue;
      const pid = parseInt(pIds[i]);
      const qty = parseInt(qtys[i]) || 0;
      const price = parseInt(prices[i]) || 0;
      if (qty <= 0) continue;
      insertItem.run(entry.id, pid, qty, price, qty * price);
      deductInv.run(qty, csrIdInt, pid);
    }
  })();

  res.redirect('/supervisor/dashboard');
});

router.post('/day/close', (req, res) => {
  const { date } = req.body;
  const csrs = db.prepare("SELECT id FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL").all();
  db.transaction(() => {
    for (const csr of csrs) {
      let entry = db.prepare("SELECT id FROM sales_entries WHERE csrId = ? AND date = ?").get(csr.id, date);
      if (!entry) {
        const result = db.prepare("INSERT INTO sales_entries (csrId, date, isPresent, loggedBy) VALUES (?, ?, 0, ?)").run(csr.id, date, req.session.user.id);
        db.prepare("UPDATE sales_entries SET dayClosed = 1, closedAt = datetime('now') WHERE id = ?").run(result.lastInsertRowid);
      } else {
        db.prepare("UPDATE sales_entries SET dayClosed = 1, closedAt = datetime('now') WHERE id = ?").run(entry.id);
      }
    }
  })();
  res.redirect('/supervisor/dashboard');
});

router.get('/csr/create', (req, res) => {
  res.render('supervisor/create-csr', { user: req.session.user, error: null, zones: require('../config/nigeriaGeopoliticalData') });
});

router.post('/csr/create', (req, res) => {
  const { email, password, fullName, phoneNumber, address, zone, state, lga } = req.body;
  if (!email || email.trim().length === 0) return res.render('supervisor/create-csr', { user: req.session.user, error: 'Email is required', zones: require('../config/nigeriaGeopoliticalData') });
  if (!password || password.trim().length === 0) return res.render('supervisor/create-csr', { user: req.session.user, error: 'Password is required', zones: require('../config/nigeriaGeopoliticalData') });
  if (!fullName || fullName.trim().length === 0) return res.render('supervisor/create-csr', { user: req.session.user, error: 'Full name is required', zones: require('../config/nigeriaGeopoliticalData') });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim());
  if (existing) return res.render('supervisor/create-csr', { user: req.session.user, error: 'Email already exists', zones: require('../config/nigeriaGeopoliticalData') });

  function generateUsername(name) { return name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, ''); }
  let username = generateUsername(fullName);
  let suffix = 1;
  while (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) { username = generateUsername(fullName) + suffix; suffix++; }

  db.prepare("INSERT INTO users (username, email, password, fullName, phoneNumber, address, role, zone, state, lga, isActive, theme, createdAt) VALUES (?, ?, ?, ?, ?, ?, 'csr', ?, ?, ?, 1, 'light', datetime('now'))")
    .run(username, email.trim(), password.trim(), fullName, phoneNumber || null, address || null, zone || null, state || null, lga || null);

  res.redirect('/supervisor/dashboard');
});

router.post('/csr/remove/:csrId', (req, res) => {
  db.prepare("UPDATE users SET isActive = 0, removedBy = ?, removedAt = datetime('now') WHERE id = ?").run(req.session.user.id, parseInt(req.params.csrId));
  res.redirect('/supervisor/dashboard');
});

router.get('/removed', (req, res) => {
  const removedCsrs = db.prepare(`
    SELECT u.*, r.fullName AS removedByName,
      (SELECT COALESCE(SUM(sei.salesValue), 0) FROM sales_entry_items sei
       INNER JOIN sales_entries se ON sei.entryId = se.id
       WHERE se.csrId = u.id AND se.date LIKE strftime('%Y-%m', u.removedAt) || '%') AS lastMonthSales
    FROM users u LEFT JOIN users r ON u.removedBy = r.id
    WHERE u.role = 'csr' AND u.removedAt IS NOT NULL ORDER BY u.removedAt DESC
  `).all();

  const result = removedCsrs.map(c => {
    const removedMonth = c.removedAt ? c.removedAt.substring(0, 7) : '';
    const tierRow = db.prepare("SELECT t.* FROM target_tiers t INNER JOIN csr_tier ct ON ct.tierId = t.id WHERE ct.csrId = ?").get(c.id);
    const target = tierRow ? tierRow.monthlyTarget : 0;
    const baseSalary = tierRow ? tierRow.monthlySalary : 0;
    const sales = c.lastMonthSales || 0;
    const earnedPay = target > 0 ? Math.round((sales / target) * baseSalary) : 0;
    const paid = db.prepare('SELECT id FROM payment_history WHERE csrId = ? AND month = ?').get(c.id, removedMonth);
    return { ...c, removedMonth, target, baseSalary, earnedPay, isPaid: !!paid, outstanding: paid ? 0 : earnedPay };
  });

  res.render('supervisor/removed', { removedCsrs: result, user: req.session.user });
});

router.post('/payment/confirm/:csrId', (req, res) => {
  const { month } = req.body;
  const csrId = parseInt(req.params.csrId);
  const payData = getCsrPayData(csrId, month);
  const existing = db.prepare('SELECT id FROM payment_history WHERE csrId = ? AND month = ?').get(csrId, month);
  if (!existing) {
    db.prepare("INSERT INTO payment_history (csrId, month, totalSales, target, baseSalary, earnedPay, percentTarget, confirmedBy, confirmedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))")
      .run(csrId, month, payData.totalValue, payData.target, payData.baseSalary, payData.earnedPay, payData.percentTarget, req.session.user.id);
  }
  res.redirect(req.get('Referer') || '/supervisor/dashboard');
});

router.post('/payment/bulk', (req, res) => {
  const { csrIds, month } = req.body;
  const ids = Array.isArray(csrIds) ? csrIds : (csrIds ? [csrIds] : []);
  db.transaction(() => {
    for (const csrId of ids) {
      const id = parseInt(csrId);
      const existing = db.prepare('SELECT id FROM payment_history WHERE csrId = ? AND month = ?').get(id, month);
      if (existing) continue;
      const payData = getCsrPayData(id, month);
      if (payData.earnedPay > 0) {
        db.prepare("INSERT INTO payment_history (csrId, month, totalSales, target, baseSalary, earnedPay, percentTarget, confirmedBy, confirmedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))")
          .run(id, month, payData.totalValue, payData.target, payData.baseSalary, payData.earnedPay, payData.percentTarget, req.session.user.id);
      }
    }
  })();
  res.redirect(req.get('Referer') || '/supervisor/dashboard');
});

router.get('/previous', (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const csrs = db.prepare("SELECT * FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL").all();
  const dailyData = csrs.map(csr => {
    const entries = db.prepare("SELECT * FROM sales_entries WHERE csrId = ? AND date = ?").all(csr.id, date);
    const isPresent = entries.some(e => e.isPresent);
    let totalValue = 0, totalUnits = 0, items = [];
    entries.forEach(e => {
      const eItems = db.prepare("SELECT sei.*, p.name AS productName, p.grammage AS productGrammage FROM sales_entry_items sei LEFT JOIN products p ON sei.productId = p.id WHERE sei.entryId = ?").all(e.id);
      items = items.concat(eItems);
      totalValue += eItems.reduce((s, i) => s + i.salesValue, 0);
      totalUnits += eItems.reduce((s, i) => s + i.quantity, 0);
    });
    const tierRow = db.prepare("SELECT t.* FROM target_tiers t INNER JOIN csr_tier ct ON ct.tierId = t.id WHERE ct.csrId = ?").get(csr.id);
    return { ...csr, tierName: tierRow ? tierRow.name : 'Unassigned', isPresent, totalValue, totalUnits, items };
  });
  res.render('supervisor/previous', { dailyData, date, user: req.session.user, csrfToken: req.csrfToken(), success: req.query.success || null, error: req.query.error || null });
});

router.get('/daily', (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const csrs = db.prepare("SELECT * FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL").all();
  const dailyData = csrs.map(csr => {
    const entries = db.prepare("SELECT * FROM sales_entries WHERE csrId = ? AND date = ?").all(csr.id, date);
    const isPresent = entries.some(e => e.isPresent);
    let totalValue = 0, totalUnits = 0, items = [];
    entries.forEach(e => {
      const eItems = db.prepare("SELECT sei.*, p.name AS productName, p.grammage AS productGrammage FROM sales_entry_items sei LEFT JOIN products p ON sei.productId = p.id WHERE sei.entryId = ?").all(e.id);
      items = items.concat(eItems);
      totalValue += eItems.reduce((s, i) => s + i.salesValue, 0);
      totalUnits += eItems.reduce((s, i) => s + i.quantity, 0);
    });
    const tierRow = db.prepare("SELECT t.* FROM target_tiers t INNER JOIN csr_tier ct ON ct.tierId = t.id WHERE ct.csrId = ?").get(csr.id);
    return { ...csr, tierName: tierRow ? tierRow.name : 'Unassigned', isPresent, totalValue, totalUnits, items };
  });
  res.render('supervisor/daily', { dailyData, date, user: req.session.user });
});

router.get('/weekly', (req, res) => {
  let weekStart, weekEnd;
  if (req.query.start) {
    weekStart = req.query.start;
    const d = new Date(weekStart); d.setDate(d.getDate() + 6);
    weekEnd = d.toISOString().split('T')[0];
  } else {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now); monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    weekStart = monday.toISOString().split('T')[0];
    weekEnd = sunday.toISOString().split('T')[0];
  }
  const csrs = db.prepare("SELECT * FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL").all();
  const weeklyData = csrs.map(csr => {
    const entries = db.prepare("SELECT * FROM sales_entries WHERE csrId = ? AND date >= ? AND date <= ?").all(csr.id, weekStart, weekEnd);
    const presentDays = entries.filter(e => e.isPresent).length;
    let totalValue = 0, totalUnits = 0;
    entries.forEach(e => {
      const items = db.prepare("SELECT COALESCE(SUM(salesValue), 0) as val, COALESCE(SUM(quantity), 0) as qty FROM sales_entry_items WHERE entryId = ?").get(e.id);
      totalValue += items.val; totalUnits += items.qty;
    });
    const tierRow = db.prepare("SELECT t.* FROM target_tiers t INNER JOIN csr_tier ct ON ct.tierId = t.id WHERE ct.csrId = ?").get(csr.id);
    return { ...csr, tierName: tierRow ? tierRow.name : 'Unassigned', presentDays, totalValue, totalUnits };
  });
  res.render('supervisor/weekly', { weeklyData, weekStart, weekEnd, user: req.session.user });
});

router.get('/monthly', (req, res) => {
  const month = req.query.month || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const monthName = new Date(month + '-01').toLocaleString('default', { month: 'long', year: 'numeric' });
  const csrs = db.prepare("SELECT * FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL").all();
  const monthlyData = csrs.map(csr => {
    const payData = getCsrPayData(csr.id, month);
    return { ...csr, ...payData };
  });
  const paidTotal = monthlyData.reduce((s, c) => s + c.earnedPay, 0);
  res.render('supervisor/monthly', { monthlyData, monthName, month, paidTotal, user: req.session.user });
});

router.get('/inventory', (req, res) => {
  const csrs = db.prepare("SELECT * FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL").all();
  const products = db.prepare("SELECT * FROM products WHERE isActive = 1 ORDER BY name").all();
  const inventory = db.prepare("SELECT ci.*, p.name AS productName, p.grammage AS productGrammage, u.fullName AS csrName FROM csr_inventory ci INNER JOIN products p ON ci.productId = p.id INNER JOIN users u ON ci.csrId = u.id ORDER BY u.fullName, p.name").all();
  res.render('supervisor/inventory', { inventory, csrs, products, user: req.session.user });
});

router.post('/inventory/add', (req, res) => {
  const { csrId, productId, quantity } = req.body;
  const existing = db.prepare('SELECT id FROM csr_inventory WHERE csrId = ? AND productId = ?').get(parseInt(csrId), parseInt(productId));
  if (existing) {
    db.prepare("UPDATE csr_inventory SET quantity = quantity + ?, lastUpdated = datetime('now') WHERE id = ?").run(parseInt(quantity), existing.id);
  } else {
    db.prepare("INSERT INTO csr_inventory (csrId, productId, quantity, lastUpdated) VALUES (?, ?, ?, datetime('now'))").run(parseInt(csrId), parseInt(productId), parseInt(quantity));
  }
  res.redirect('/supervisor/inventory');
});

router.get('/products', (req, res) => {
  const products = db.prepare('SELECT * FROM products ORDER BY id').all();
  res.render('supervisor/products', { products, user: req.session.user, success: null, error: null });
});

router.get('/products/create', (req, res) => {
  res.render('supervisor/create-product', { user: req.session.user, error: null });
});

router.post('/products/create', (req, res) => {
  const { name, grammage } = req.body;
  if (!name || name.trim().length === 0) return res.render('supervisor/create-product', { user: req.session.user, error: 'Product name is required' });
  if (!grammage || grammage.trim().length === 0) return res.render('supervisor/create-product', { user: req.session.user, error: 'Grammage is required' });
  db.prepare("INSERT INTO products (name, grammage, createdBy, isActive, createdAt) VALUES (?, ?, ?, 1, datetime('now'))").run(name.trim(), grammage.trim(), req.session.user.id);
  res.redirect('/supervisor/products');
});

router.post('/products/:id/delete', (req, res) => {
  db.prepare('UPDATE products SET isActive = 0 WHERE id = ?').run(req.params.id);
  res.redirect('/supervisor/products');
});

router.get('/tiers', (req, res) => {
  const tiers = db.prepare('SELECT * FROM target_tiers ORDER BY monthlyTarget').all();
  const csrs = db.prepare("SELECT * FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL").all();
  const assignments = {};
  db.prepare('SELECT * FROM csr_tier').all().forEach(a => { assignments[a.csrId] = a.tierId; });
  res.render('supervisor/tiers', { tiers, csrs, assignments, user: req.session.user, success: null, error: null });
});

router.post('/tiers/create', (req, res) => {
  const { name, monthlyTarget, monthlySalary } = req.body;
  if (!name || name.trim().length === 0) {
    const tiers = db.prepare('SELECT * FROM target_tiers ORDER BY monthlyTarget').all();
    const csrs = db.prepare("SELECT * FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL").all();
    const assignments = {};
    db.prepare('SELECT * FROM csr_tier').all().forEach(a => { assignments[a.csrId] = a.tierId; });
    return res.render('supervisor/tiers', { tiers, csrs, assignments, user: req.session.user, success: null, error: 'Tier name is required' });
  }
  db.prepare("INSERT INTO target_tiers (name, monthlyTarget, monthlySalary, createdBy, createdAt) VALUES (?, ?, ?, ?, datetime('now'))").run(name.trim(), parseInt(monthlyTarget) || 0, parseInt(monthlySalary) || 0, req.session.user.id);
  res.redirect('/supervisor/tiers');
});

router.post('/tiers/:id/delete', (req, res) => {
  db.prepare('DELETE FROM csr_tier WHERE tierId = ?').run(req.params.id);
  db.prepare('DELETE FROM target_tiers WHERE id = ?').run(req.params.id);
  res.redirect('/supervisor/tiers');
});

router.post('/tiers/:id/edit', (req, res) => {
  const { name, monthlyTarget, monthlySalary } = req.body;
  db.prepare('UPDATE target_tiers SET name = ?, monthlyTarget = ?, monthlySalary = ? WHERE id = ?').run(name.trim(), parseInt(monthlyTarget) || 0, parseInt(monthlySalary) || 0, req.params.id);
  res.redirect('/supervisor/tiers');
});

router.post('/tiers/assign/:csrId', (req, res) => {
  const { tierId } = req.body;
  const csrId = parseInt(req.params.csrId);
  const existing = db.prepare('SELECT id FROM csr_tier WHERE csrId = ?').get(csrId);
  if (existing) {
    db.prepare('UPDATE csr_tier SET tierId = ? WHERE csrId = ?').run(parseInt(tierId), csrId);
  } else {
    db.prepare('INSERT INTO csr_tier (csrId, tierId) VALUES (?, ?)').run(csrId, parseInt(tierId));
  }
  res.redirect('/supervisor/tiers');
});

router.get('/paytable', (req, res) => {
  const csrs = db.prepare("SELECT * FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL").all();
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const payouts = csrs.map(csr => {
    const payData = getCsrPayData(csr.id, currentMonth);
    return { ...csr, ...payData };
  });
  res.render('supervisor/paytable', { payouts, currentMonth, user: req.session.user });
});

router.get('/paytable/export', (req, res) => {
  const csrs = db.prepare("SELECT * FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL").all();
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const data = csrs.map(csr => {
    const payData = getCsrPayData(csr.id, currentMonth);
    return { 'CSR Name': csr.fullName, 'Phone': csr.phoneNumber || '', 'State': csr.state || '', 'Tier': payData.tierName, 'Monthly Target': payData.target, 'Monthly Salary': payData.baseSalary, 'Days Present': payData.presentDays, 'Total Units': payData.totalUnits, 'Total Sales': payData.totalValue, '% of Target': payData.percentTarget + '%', 'Earned Pay': payData.earnedPay };
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [{ wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 22 }, { wch: 15 }, { wch: 15 }, { wch: 13 }, { wch: 13 }, { wch: 18 }, { wch: 15 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Pay Table');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename=paytable-${currentMonth}.xlsx`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

module.exports = router;
