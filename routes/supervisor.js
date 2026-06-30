const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const { isAuthenticated, roleGuard } = require('../middleware/auth');
const db = require('../db');

router.use(isAuthenticated, roleGuard('supervisor', 'csr'));

async function getMonthSales(csrId, monthPrefix) {
  const entries = await db.prepare("SELECT * FROM sales_entries WHERE csrId = ? AND date LIKE ?").all(csrId, `${monthPrefix}%`);
  let totalValue = 0, totalUnits = 0;
  for (const e of entries) {
    const items = await db.prepare("SELECT COALESCE(SUM(salesValue), 0) as val, COALESCE(SUM(quantity), 0) as qty FROM sales_entry_items WHERE entryId = ?").get(e.id);
    totalValue += items.val;
    totalUnits += items.qty;
  }
  const presentDays = entries.filter(e => e.isPresent).length;
  return { totalValue, totalUnits, presentDays, entryCount: entries.length };
}

async function getCsrPayData(csrId, monthPrefix) {
  const tierRow = await db.prepare("SELECT t.* FROM target_tiers t INNER JOIN csr_tier ct ON ct.tierId = t.id WHERE ct.csrId = ?").get(csrId);
  const sales = await getMonthSales(csrId, monthPrefix);
  const target = tierRow ? tierRow.monthlyTarget : 0;
  const baseSalary = tierRow ? tierRow.monthlySalary : 0;
  const percentTarget = target > 0 ? Math.round((sales.totalValue / target) * 100) : 0;
  const earnedPay = target > 0 ? Math.round((sales.totalValue / target) * baseSalary) : 0;
  const paid = await db.prepare('SELECT id FROM payment_history WHERE csrId = ? AND month = ?').get(csrId, monthPrefix);
  return { ...sales, monthlySales: sales.totalValue, totalSales: sales.totalValue, tierName: tierRow ? tierRow.name : 'Unassigned', target, baseSalary, percentTarget, earnedPay, isPaid: !!paid };
}

async function isMonthArchived(month) {
  const row = await db.prepare('SELECT id FROM archived_months WHERE month = ?').get(month);
  return !!row;
}

async function autoArchivePreviousMonth() {
  const currentMonth = new Date().toISOString().substring(0, 7);
  const lastEntry = await db.prepare("SELECT DISTINCT DATE_FORMAT(date, '%Y-%m') as m FROM sales_entries ORDER BY m DESC LIMIT 1").get();
  if (!lastEntry) return;
  if (lastEntry.m >= currentMonth) return;
  const alreadyArchived = await isMonthArchived(lastEntry.m);
  if (alreadyArchived) return;
  await db.prepare('INSERT INTO archived_months (month, archivedBy, archivedAt) VALUES (?, 0, NOW())').run(lastEntry.m);
}

router.get('/dashboard', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  await autoArchivePreviousMonth();
  const currentMonthArchived = await isMonthArchived(today.substring(0, 7));
  const csrs = await db.prepare("SELECT * FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL").all();
  const products = await db.prepare("SELECT * FROM products WHERE isActive = 1 ORDER BY name").all();

  const csrData = [];
  for (const csr of csrs) {
    const payData = await getCsrPayData(csr.id, today.substring(0, 7));
    const todayEntries = await db.prepare("SELECT * FROM sales_entries WHERE csrId = ? AND date = ?").all(csr.id, today);
    const dayClosed = todayEntries.length > 0 && todayEntries.every(e => e.dayClosed);
    const isPresent = todayEntries.some(e => e.isPresent);
    let todayItems = [];
    let todayValue = 0;
    for (const e of todayEntries) {
      const items = await db.prepare("SELECT sei.*, p.name AS productName, p.grammage AS productGrammage FROM sales_entry_items sei LEFT JOIN products p ON sei.productId = p.id WHERE sei.entryId = ?").all(e.id);
      todayItems = todayItems.concat(items);
      todayValue += items.reduce((s, i) => s + i.salesValue, 0);
    }
    const inventory = await db.prepare("SELECT ci.*, p.name AS productName, p.grammage AS productGrammage FROM csr_inventory ci INNER JOIN products p ON ci.productId = p.id WHERE ci.csrId = ?").all(csr.id);
    csrData.push({ ...csr, ...payData, todayItems, todayValue, isPresent, dayClosed, inventory });
  }

  let allDaysClosed = false;
  if (csrs.length > 0) {
    const openCount = await db.prepare("SELECT COUNT(*) as cnt FROM sales_entries WHERE date = ? AND dayClosed = 0").get(today);
    const totalCount = await db.prepare("SELECT COUNT(*) as cnt FROM sales_entries WHERE date = ?").get(today);
    allDaysClosed = openCount.cnt === 0 && totalCount.cnt > 0;
  }

  res.render('supervisor/dashboard', { csrs, csrData, products, today, dayClosed: allDaysClosed, currentMonthArchived, user: req.session.user, success: req.query.success || null, error: req.query.error || null });
});

router.post('/sales/log', async (req, res) => {
  const { csrId, date, isPresent, productIds, quantities, unitPrices } = req.body;
  const csrIdInt = parseInt(csrId);
  const month = date.substring(0, 7);

  try {
    if (await isMonthArchived(month)) return res.redirect('/supervisor/dashboard?error=Month+is+archived.+Cannot+log+entries.');

    const existingEntry = await db.prepare("SELECT id, dayClosed FROM sales_entries WHERE csrId = ? AND date = ?").get(csrIdInt, date);
    if (existingEntry && existingEntry.dayClosed) return res.redirect('/supervisor/dashboard?error=Day+is+closed.+Cannot+log+entries.');

    const pIds = Array.isArray(productIds) ? productIds : [productIds];
    const qtys = Array.isArray(quantities) ? quantities : [quantities];
    const prices = Array.isArray(unitPrices) ? unitPrices : [unitPrices];

    const filtered = [];
    for (let i = 0; i < pIds.length; i++) {
      if (!pIds[i] || pIds[i] === '') continue;
      const pid = parseInt(pIds[i]);
      const qty = parseInt(qtys[i]) || 0;
      const price = parseInt(prices[i]) || 0;
      if (qty <= 0) continue;
      filtered.push({ pid, qty, price });
    }

    await db.transaction(async (tx) => {
      let entry = existingEntry;
      if (!entry) {
        const result = await tx.prepare("INSERT INTO sales_entries (csrId, date, isPresent, loggedBy) VALUES (?, ?, ?, ?)").run(csrIdInt, date, isPresent === 'on' ? 1 : 0, req.session.user.id);
        entry = { id: result.lastInsertRowid };
      } else {
        await tx.prepare("UPDATE sales_entries SET isPresent = ? WHERE id = ?").run(isPresent === 'on' ? 1 : 0, entry.id);
      }

      await tx.prepare("DELETE FROM sales_entry_items WHERE entryId = ?").run(entry.id);

      for (const item of filtered) {
        await tx.prepare("INSERT INTO sales_entry_items (entryId, productId, quantity, unitPrice, salesValue) VALUES (?, ?, ?, ?, ?)").run(entry.id, item.pid, item.qty, item.price, item.qty * item.price);
        await tx.prepare("UPDATE csr_inventory SET quantity = quantity - ?, lastUpdated = NOW() WHERE csrId = ? AND productId = ?").run(item.qty, csrIdInt, item.pid);
      }
    });

    res.redirect('/supervisor/dashboard?success=Sales+logged+successfully');
  } catch (err) {
    const msg = encodeURIComponent(err.message || 'Failed to log sales');
    res.redirect(`/supervisor/dashboard?error=${msg}`);
  }
});

router.post('/sales/present', async (req, res) => {
  const { csrId } = req.body;
  const date = new Date().toISOString().split('T')[0];
  try {
    if (csrId) {
      const existing = await db.prepare("SELECT id FROM sales_entries WHERE csrId = ? AND date = ?").get(parseInt(csrId), date);
      if (existing) {
        await db.prepare("UPDATE sales_entries SET isPresent = 1 WHERE id = ?").run(existing.id);
      } else {
        await db.prepare("INSERT INTO sales_entries (csrId, date, isPresent, loggedBy) VALUES (?, ?, 1, ?)").run(parseInt(csrId), date, req.session.user.id);
      }
    } else {
      const csrs = await db.prepare("SELECT id FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL").all();
      for (const c of csrs) {
        const existing = await db.prepare("SELECT id FROM sales_entries WHERE csrId = ? AND date = ?").get(c.id, date);
        if (existing) {
          await db.prepare("UPDATE sales_entries SET isPresent = 1 WHERE id = ?").run(existing.id);
        } else {
          await db.prepare("INSERT INTO sales_entries (csrId, date, isPresent, loggedBy) VALUES (?, ?, 1, ?)").run(c.id, date, req.session.user.id);
        }
      }
    }
    res.redirect('/supervisor/dashboard?success=Present+marked+successfully');
  } catch (err) {
    res.redirect('/supervisor/dashboard?error=Failed+to+mark+present');
  }
});

router.post('/day/close', async (req, res) => {
  try {
    const { date } = req.body;
    const month = date.substring(0, 7);
    if (await isMonthArchived(month)) return res.redirect('/supervisor/dashboard?error=Month+is+archived.+Cannot+close+days.');

    const csrs = await db.prepare("SELECT id FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL").all();
    await db.transaction(async (tx) => {
      for (const csr of csrs) {
        let entry = await tx.prepare("SELECT id FROM sales_entries WHERE csrId = ? AND date = ?").get(csr.id, date);
        if (!entry) {
          const result = await tx.prepare("INSERT INTO sales_entries (csrId, date, isPresent, loggedBy) VALUES (?, ?, 0, ?)").run(csr.id, date, req.session.user.id);
          await tx.prepare("UPDATE sales_entries SET dayClosed = 1, closedAt = NOW() WHERE id = ?").run(result.lastInsertRowid);
        } else {
          await tx.prepare("UPDATE sales_entries SET dayClosed = 1, closedAt = NOW() WHERE id = ?").run(entry.id);
        }
      }
    });
    res.redirect('/supervisor/dashboard?success=Day+closed+successfully');
  } catch (err) {
    res.redirect('/supervisor/dashboard?error=Failed+to+close+day');
  }
});

router.post('/day/reopen', async (req, res) => {
  try {
    const { date } = req.body;
    const month = date.substring(0, 7);
    if (await isMonthArchived(month)) return res.redirect('/supervisor/dashboard?error=Month+is+archived.+Cannot+reopen+days.');

    const csrs = await db.prepare("SELECT id FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL").all();
    await db.transaction(async (tx) => {
      for (const csr of csrs) {
        const entry = await tx.prepare("SELECT id FROM sales_entries WHERE csrId = ? AND date = ?").get(csr.id, date);
        if (entry) {
          await tx.prepare("UPDATE sales_entries SET dayClosed = 0, closedAt = NULL WHERE id = ?").run(entry.id);
        }
      }
    });
    res.redirect('/supervisor/dashboard?success=Day+reopened+successfully');
  } catch (err) {
    res.redirect('/supervisor/dashboard?error=Failed+to+reopen+day');
  }
});

router.post('/month/end', async (req, res) => {
  try {
    const { month } = req.body;
    const m = month || new Date().toISOString().substring(0, 7);
    const already = await isMonthArchived(m);
    if (already) return res.redirect('/supervisor/dashboard?error=Month+already+archived.');
    await db.prepare('INSERT INTO archived_months (month, archivedBy, archivedAt) VALUES (?, ?, NOW())').run(m, req.session.user.id);
    res.redirect('/supervisor/dashboard?success=Month+archived+successfully');
  } catch (err) {
    res.redirect('/supervisor/dashboard?error=Failed+to+archive+month');
  }
});

router.post('/month/open', async (req, res) => {
  try {
    const { month } = req.body;
    const m = month || new Date().toISOString().substring(0, 7);
    const existing = await db.prepare('SELECT id FROM archived_months WHERE month = ?').get(m);
    if (!existing) return res.redirect('/supervisor/dashboard?error=Month+is+not+archived.');
    await db.prepare('DELETE FROM archived_months WHERE month = ?').run(m);
    res.redirect('/supervisor/dashboard?success=Month+reopened+successfully');
  } catch (err) {
    res.redirect('/supervisor/dashboard?error=Failed+to+reopen+month');
  }
});

router.get('/csr/create', async (req, res) => {
  const tiers = await db.prepare('SELECT * FROM target_tiers ORDER BY monthlyTarget').all();
  const csrs = await db.prepare("SELECT id, fullName, phoneNumber FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL ORDER BY fullName").all();
  res.render('supervisor/create-csr', { user: req.session.user, error: null, csr: null, csrs, zones: require('../config/nigeriaGeopoliticalData'), tiers });
});

router.post('/csr/create', async (req, res) => {
  try {
    const { email, password, fullName, phoneNumber, address, zone, state, lga, tierId } = req.body;
    if (!email || email.trim().length === 0) {
      const csrs = await db.prepare("SELECT id, fullName, phoneNumber FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL ORDER BY fullName").all();
      return res.render('supervisor/create-csr', { user: req.session.user, error: 'Email is required', csr: null, csrs, zones: require('../config/nigeriaGeopoliticalData'), tiers: await db.prepare('SELECT * FROM target_tiers ORDER BY monthlyTarget').all() });
    }
    if (!password || password.trim().length === 0) {
      const csrs = await db.prepare("SELECT id, fullName, phoneNumber FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL ORDER BY fullName").all();
      return res.render('supervisor/create-csr', { user: req.session.user, error: 'Password is required', csr: null, csrs, zones: require('../config/nigeriaGeopoliticalData'), tiers: await db.prepare('SELECT * FROM target_tiers ORDER BY monthlyTarget').all() });
    }
    if (!fullName || fullName.trim().length === 0) {
      const csrs = await db.prepare("SELECT id, fullName, phoneNumber FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL ORDER BY fullName").all();
      return res.render('supervisor/create-csr', { user: req.session.user, error: 'Full name is required', csr: null, csrs, zones: require('../config/nigeriaGeopoliticalData'), tiers: await db.prepare('SELECT * FROM target_tiers ORDER BY monthlyTarget').all() });
    }

    const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim());
    if (existing) {
      const csrs = await db.prepare("SELECT id, fullName, phoneNumber FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL ORDER BY fullName").all();
      return res.render('supervisor/create-csr', { user: req.session.user, error: 'Email already exists', csr: null, csrs, zones: require('../config/nigeriaGeopoliticalData'), tiers: await db.prepare('SELECT * FROM target_tiers ORDER BY monthlyTarget').all() });
    }

    function generateUsername(name) { return name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, ''); }
    let username = generateUsername(fullName);
    let suffix = 1;
    while (await db.prepare('SELECT id FROM users WHERE username = ?').get(username)) { username = generateUsername(fullName) + suffix; suffix++; }

    const result = await db.prepare("INSERT INTO users (username, email, password, fullName, phoneNumber, address, role, zone, state, lga, isActive, theme, createdAt) VALUES (?, ?, ?, ?, ?, ?, 'csr', ?, ?, ?, 1, 'light', NOW())")
      .run(username, email.trim(), password.trim(), fullName, phoneNumber || null, address || null, zone || null, state || null, lga || null);

    if (tierId) {
      await db.prepare('INSERT INTO csr_tier (csrId, tierId) VALUES (?, ?)').run(result.lastInsertRowid, parseInt(tierId));
    }

    res.redirect('/supervisor/dashboard?success=CSR+created+successfully');
  } catch (err) {
    res.redirect('/supervisor/dashboard?error=Failed+to+create+CSR');
  }
});

router.get('/csr/edit', async (req, res) => {
  const csrId = parseInt(req.query.csrId);
  if (!csrId) return res.redirect('/supervisor/csr/create');
  res.redirect(`/supervisor/csr/edit/${csrId}`);
});

router.get('/csr/edit/:csrId', async (req, res) => {
  try {
    const csrId = parseInt(req.params.csrId);
    const csr = await db.prepare("SELECT * FROM users WHERE id = ? AND role = 'csr'").get(csrId);
    if (!csr) return res.redirect('/supervisor/csr/create?error=CSR+not+found');
    const tierRow = await db.prepare("SELECT tierId FROM csr_tier WHERE csrId = ?").get(csrId);
    csr.tierId = tierRow ? tierRow.tierId : null;
    const tiers = await db.prepare('SELECT * FROM target_tiers ORDER BY monthlyTarget').all();
    const csrs = await db.prepare("SELECT id, fullName, phoneNumber FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL ORDER BY fullName").all();
    res.render('supervisor/create-csr', { user: req.session.user, error: null, csr, csrs, zones: require('../config/nigeriaGeopoliticalData'), tiers });
  } catch (err) {
    res.redirect('/supervisor/csr/create?error=Failed+to+load+CSR');
  }
});

router.post('/csr/edit/:csrId', async (req, res) => {
  try {
    const csrId = parseInt(req.params.csrId);
    const { fullName, email, password, phoneNumber, address, zone, state, lga, tierId } = req.body;
    if (!fullName || fullName.trim().length === 0) throw new Error('Full name is required');
    if (!email || email.trim().length === 0) throw new Error('Email is required');

    const existingEmail = await db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email.trim(), csrId);
    if (existingEmail) {
      const tiers = await db.prepare('SELECT * FROM target_tiers ORDER BY monthlyTarget').all();
      const csrs = await db.prepare("SELECT id, fullName, phoneNumber FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL ORDER BY fullName").all();
      const csr = await db.prepare("SELECT * FROM users WHERE id = ?").get(csrId);
      const tierRow = await db.prepare("SELECT tierId FROM csr_tier WHERE csrId = ?").get(csrId);
      csr.tierId = tierRow ? tierRow.tierId : null;
      return res.render('supervisor/create-csr', { user: req.session.user, error: 'Email already in use', csr, csrs, zones: require('../config/nigeriaGeopoliticalData'), tiers });
    }

    if (password && password.trim().length > 0) {
      await db.prepare("UPDATE users SET fullName = ?, email = ?, password = ?, phoneNumber = ?, address = ?, zone = ?, state = ?, lga = ? WHERE id = ?")
        .run(fullName.trim(), email.trim(), password.trim(), phoneNumber || null, address || null, zone || null, state || null, lga || null, csrId);
    } else {
      await db.prepare("UPDATE users SET fullName = ?, email = ?, phoneNumber = ?, address = ?, zone = ?, state = ?, lga = ? WHERE id = ?")
        .run(fullName.trim(), email.trim(), phoneNumber || null, address || null, zone || null, state || null, lga || null, csrId);
    }

    if (tierId) {
      const existing = await db.prepare('SELECT id FROM csr_tier WHERE csrId = ?').get(csrId);
      if (existing) {
        await db.prepare('UPDATE csr_tier SET tierId = ? WHERE csrId = ?').run(parseInt(tierId), csrId);
      } else {
        await db.prepare('INSERT INTO csr_tier (csrId, tierId) VALUES (?, ?)').run(csrId, parseInt(tierId));
      }
    } else {
      await db.prepare('DELETE FROM csr_tier WHERE csrId = ?').run(csrId);
    }

    res.redirect(`/supervisor/csr/edit/${csrId}?success=CSR+updated+successfully`);
  } catch (err) {
    res.redirect(`/supervisor/csr/edit/${req.params.csrId}?error=Failed+to+update+CSR`);
  }
});

router.post('/csr/remove/:csrId', async (req, res) => {
  try {
    await db.prepare("UPDATE users SET isActive = 0, removedBy = ?, removedAt = NOW() WHERE id = ?").run(req.session.user.id, parseInt(req.params.csrId));
    res.redirect('/supervisor/dashboard?success=CSR+removed+successfully');
  } catch (err) {
    res.redirect('/supervisor/dashboard?error=Failed+to+remove+CSR');
  }
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

  res.render('supervisor/removed', { removedCsrs: result, user: req.session.user });
});

router.post('/payment/confirm/:csrId', async (req, res) => {
  try {
    const { month } = req.body;
    const csrId = parseInt(req.params.csrId);
    const payData = await getCsrPayData(csrId, month);
    const existing = await db.prepare('SELECT id FROM payment_history WHERE csrId = ? AND month = ?').get(csrId, month);
    if (!existing) {
      await db.prepare("INSERT INTO payment_history (csrId, month, totalSales, target, baseSalary, earnedPay, percentTarget, confirmedBy, confirmedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())")
        .run(csrId, month, payData.totalValue, payData.target, payData.baseSalary, payData.earnedPay, payData.percentTarget, req.session.user.id);
    }
    res.redirect(req.get('Referer') || '/supervisor/dashboard?success=Payment+confirmed');
  } catch (err) {
    res.redirect(req.get('Referer') || '/supervisor/dashboard?error=Failed+to+confirm+payment');
  }
});

router.post('/payment/bulk', async (req, res) => {
  try {
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
    res.redirect(req.get('Referer') || '/supervisor/dashboard?success=Payments+confirmed');
  } catch (err) {
    res.redirect(req.get('Referer') || '/supervisor/dashboard?error=Failed+to+process+payments');
  }
});

router.get('/previous', async (req, res) => {
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
  res.render('supervisor/previous', { dailyData, date, user: req.session.user, csrfToken: req.session.csrfToken, success: req.query.success || null, error: req.query.error || null });
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
  res.render('supervisor/daily', { dailyData, date, user: req.session.user });
});

router.get('/weekly', async (req, res) => {
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
  res.render('supervisor/weekly', { weeklyData, weekStart, weekEnd, user: req.session.user });
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
  res.render('supervisor/monthly', { monthlyData, monthName, month, paidTotal, user: req.session.user });
});

router.get('/inventory', async (req, res) => {
  const csrs = await db.prepare("SELECT * FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL").all();
  const products = await db.prepare("SELECT * FROM products WHERE isActive = 1 ORDER BY name").all();
  const inventory = await db.prepare("SELECT ci.*, p.name AS productName, p.grammage AS productGrammage, u.fullName AS csrName, u.phoneNumber AS csrPhone, u.state AS csrState FROM csr_inventory ci INNER JOIN products p ON ci.productId = p.id INNER JOIN users u ON ci.csrId = u.id ORDER BY u.fullName, p.name").all();
  res.render('supervisor/inventory', { inventory, csrs, products, user: req.session.user });
});

router.post('/inventory/add', async (req, res) => {
  try {
    const { csrId, productId, quantity } = req.body;
    const existing = await db.prepare('SELECT id FROM csr_inventory WHERE csrId = ? AND productId = ?').get(parseInt(csrId), parseInt(productId));
    if (existing) {
      await db.prepare("UPDATE csr_inventory SET quantity = quantity + ?, lastUpdated = NOW() WHERE id = ?").run(parseInt(quantity), existing.id);
    } else {
      await db.prepare("INSERT INTO csr_inventory (csrId, productId, quantity, lastUpdated) VALUES (?, ?, ?, NOW())").run(parseInt(csrId), parseInt(productId), parseInt(quantity));
    }
    res.redirect('/supervisor/inventory?success=Inventory+updated');
  } catch (err) {
    res.redirect('/supervisor/inventory?error=Failed+to+update+inventory');
  }
});

router.get('/products', async (req, res) => {
  try {
    const products = await db.prepare('SELECT * FROM products ORDER BY id').all();
    res.render('supervisor/products', { products, user: req.session.user, success: req.query.success || null, error: req.query.error || null });
  } catch (err) {
    res.render('supervisor/products', { products: [], user: req.session.user, success: null, error: 'Failed to load products' });
  }
});

router.get('/products/create', (req, res) => {
  res.render('supervisor/create-product', { user: req.session.user, error: null });
});

router.post('/products/create', async (req, res) => {
  try {
    const { name, grammage } = req.body;
    if (!name || name.trim().length === 0) return res.render('supervisor/create-product', { user: req.session.user, error: 'Product name is required' });
    if (!grammage || grammage.trim().length === 0) return res.render('supervisor/create-product', { user: req.session.user, error: 'Grammage is required' });
    await db.prepare("INSERT INTO products (name, grammage, createdBy, isActive, createdAt) VALUES (?, ?, ?, 1, NOW())").run(name.trim(), grammage.trim(), req.session.user.id);
    res.redirect('/supervisor/products?success=Product+created');
  } catch (err) {
    res.redirect('/supervisor/products?error=Failed+to+create+product');
  }
});

router.post('/products/:id/delete', async (req, res) => {
  try {
    await db.prepare('UPDATE products SET isActive = 0 WHERE id = ?').run(req.params.id);
    res.redirect('/supervisor/products?success=Product+deleted');
  } catch (err) {
    res.redirect('/supervisor/products?error=Failed+to+delete+product');
  }
});

router.get('/tiers', async (req, res) => {
  try {
    const tiers = await db.prepare('SELECT * FROM target_tiers ORDER BY monthlyTarget').all();
    const csrs = await db.prepare("SELECT * FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL").all();
    const assignments = {};
    const csrTiers = await db.prepare('SELECT * FROM csr_tier').all();
    csrTiers.forEach(a => { assignments[a.csrId] = a.tierId; });
    res.render('supervisor/tiers', { tiers, csrs, assignments, user: req.session.user, success: req.query.success || null, error: req.query.error || null });
  } catch (err) {
    res.render('supervisor/tiers', { tiers: [], csrs: [], assignments: {}, user: req.session.user, success: null, error: 'Failed to load tiers' });
  }
});

router.post('/tiers/create', async (req, res) => {
  try {
    const { name, monthlyTarget, monthlySalary } = req.body;
    if (!name || name.trim().length === 0) {
      const tiers = await db.prepare('SELECT * FROM target_tiers ORDER BY monthlyTarget').all();
      const csrs = await db.prepare("SELECT * FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL").all();
      const assignments = {};
      const csrTiers = await db.prepare('SELECT * FROM csr_tier').all();
      csrTiers.forEach(a => { assignments[a.csrId] = a.tierId; });
      return res.render('supervisor/tiers', { tiers, csrs, assignments, user: req.session.user, success: null, error: 'Tier name is required' });
    }
    await db.prepare("INSERT INTO target_tiers (name, monthlyTarget, monthlySalary, createdBy, createdAt) VALUES (?, ?, ?, ?, NOW())").run(name.trim(), parseInt(monthlyTarget) || 0, parseInt(monthlySalary) || 0, req.session.user.id);
    res.redirect('/supervisor/tiers?success=Tier+created');
  } catch (err) {
    res.redirect('/supervisor/tiers?error=Failed+to+create+tier');
  }
});

router.post('/tiers/:id/delete', async (req, res) => {
  try {
    await db.prepare('DELETE FROM csr_tier WHERE tierId = ?').run(req.params.id);
    await db.prepare('DELETE FROM target_tiers WHERE id = ?').run(req.params.id);
    res.redirect('/supervisor/tiers?success=Tier+deleted');
  } catch (err) {
    res.redirect('/supervisor/tiers?error=Failed+to+delete+tier');
  }
});

router.post('/tiers/:id/edit', async (req, res) => {
  try {
    const { name, monthlyTarget, monthlySalary } = req.body;
    await db.prepare('UPDATE target_tiers SET name = ?, monthlyTarget = ?, monthlySalary = ? WHERE id = ?').run(name.trim(), parseInt(monthlyTarget) || 0, parseInt(monthlySalary) || 0, req.params.id);
    res.redirect('/supervisor/tiers?success=Tier+updated');
  } catch (err) {
    res.redirect('/supervisor/tiers?error=Failed+to+update+tier');
  }
});

router.post('/tiers/assign/:csrId', async (req, res) => {
  try {
    const { tierId } = req.body;
    const csrId = parseInt(req.params.csrId);
    const existing = await db.prepare('SELECT id FROM csr_tier WHERE csrId = ?').get(csrId);
    if (existing) {
      await db.prepare('UPDATE csr_tier SET tierId = ? WHERE csrId = ?').run(parseInt(tierId), csrId);
    } else {
      await db.prepare('INSERT INTO csr_tier (csrId, tierId) VALUES (?, ?)').run(csrId, parseInt(tierId));
    }
    res.redirect('/supervisor/tiers?success=Tier+assigned');
  } catch (err) {
    res.redirect('/supervisor/tiers?error=Failed+to+assign+tier');
  }
});

router.get('/activities', async (req, res) => {
  const view = req.query.view || 'daily';
  if (view === 'weekly') {
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
    const csrs = await db.prepare("SELECT * FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL").all();
    const weeklyData = [];
    for (const csr of csrs) {
      const entries = await db.prepare("SELECT * FROM sales_entries WHERE csrId = ? AND date >= ? AND date <= ?").all(csr.id, weekStart, weekEnd);
      if (entries.length === 0) continue;
      const presentDays = entries.filter(e => e.isPresent).length;
      let totalValue = 0, totalUnits = 0;
      for (const e of entries) {
        const items = await db.prepare("SELECT COALESCE(SUM(salesValue), 0) as val, COALESCE(SUM(quantity), 0) as qty FROM sales_entry_items WHERE entryId = ?").get(e.id);
        totalValue += items.val; totalUnits += items.qty;
      }
      const tierRow = await db.prepare("SELECT t.* FROM target_tiers t INNER JOIN csr_tier ct ON ct.tierId = t.id WHERE ct.csrId = ?").get(csr.id);
      weeklyData.push({ ...csr, tierName: tierRow ? tierRow.name : 'Unassigned', presentDays, totalValue, totalUnits });
    }
    return res.render('supervisor/activities', { view, weeklyData, weekStart, weekEnd, user: req.session.user });
  }
  if (view === 'monthly') {
    const month = req.query.month || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const monthName = new Date(month + '-01').toLocaleString('default', { month: 'long', year: 'numeric' });
    const csrs = await db.prepare("SELECT * FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL").all();
    const monthlyData = [];
    for (const csr of csrs) {
      const payData = await getCsrPayData(csr.id, month);
      if (payData.totalValue === 0 && payData.presentDays === 0) continue;
      monthlyData.push({ ...csr, ...payData });
    }
    const paidTotal = monthlyData.reduce((s, c) => s + c.earnedPay, 0);
    return res.render('supervisor/activities', { view, monthlyData, monthName, month, paidTotal, user: req.session.user });
  }
  // default: daily
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const csrs = await db.prepare("SELECT * FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL").all();
  const dailyData = [];
  for (const csr of csrs) {
    const entries = await db.prepare("SELECT * FROM sales_entries WHERE csrId = ? AND date = ?").all(csr.id, date);
    if (entries.length === 0) continue;
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
  res.render('supervisor/activities', { view, dailyData, date, user: req.session.user });
});

router.get('/paytable', async (req, res) => {
  const csrs = await db.prepare("SELECT * FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL").all();
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const payouts = [];
  for (const csr of csrs) {
    const payData = await getCsrPayData(csr.id, currentMonth);
    payouts.push({ ...csr, ...payData });
  }
  res.render('supervisor/paytable', { payouts, currentMonth, user: req.session.user });
});

router.get('/paytable/export', async (req, res) => {
  const csrs = await db.prepare("SELECT * FROM users WHERE role = 'csr' AND isActive = 1 AND removedAt IS NULL").all();
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const data = [];
  for (const csr of csrs) {
    const payData = await getCsrPayData(csr.id, currentMonth);
    data.push({ 'CSR Name': csr.fullName, 'Phone': csr.phoneNumber || '', 'State': csr.state || '', 'Tier': payData.tierName, 'Monthly Target': payData.target, 'Monthly Salary': payData.baseSalary, 'Days Present': payData.presentDays, 'Total Units': payData.totalUnits, 'Total Sales': payData.totalValue, '% of Target': payData.percentTarget + '%', 'Earned Pay': payData.earnedPay });
  }
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