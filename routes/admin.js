const express = require('express');
const router = express.Router();
const { isAuthenticated, roleGuard } = require('../middleware/auth');
const db = require('../db');

router.use(isAuthenticated, roleGuard('admin'));

router.get('/dashboard', async (req, res) => {
  try {
    const users = await db.prepare('SELECT * FROM users ORDER BY id').all();
    res.render('admin/dashboard', { users, user: req.session.user, success: req.query.success || null, error: req.query.error || null });
  } catch (err) {
    res.render('admin/dashboard', { users: [], user: req.session.user, success: null, error: 'Failed to load dashboard' });
  }
});

router.get('/users/create', (req, res) => {
  res.render('admin/create-user', { user: req.session.user, error: null });
});

router.post('/users/create', async (req, res) => {
  try {
    const { email, password, fullName, phoneNumber, address, role, zone, state, lga } = req.body;
    if (!email || email.trim().length === 0) {
      return res.render('admin/create-user', { user: req.session.user, error: 'Email is required' });
    }
    const existingEmail = await db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim());
    if (existingEmail) {
      return res.render('admin/create-user', { user: req.session.user, error: 'Email already exists' });
    }
    function generateUsername(name) {
      return name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
    }
    let username = generateUsername(fullName);
    let suffix = 1;
    while (await db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
      username = generateUsername(fullName) + suffix;
      suffix++;
    }
    if (!password || password.trim().length === 0) {
      return res.render('admin/create-user', { user: req.session.user, error: 'Password is required' });
    }
    await db.prepare(`
      INSERT INTO users (username, email, password, fullName, phoneNumber, address, role, zone, state, lga, isActive, theme, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'light', NOW())
    `).run(username, email.trim(), password.trim(), fullName, phoneNumber || null, address || null, role || 'csr', zone || null, state || null, lga || null);
    res.redirect('/admin/dashboard?success=User+created');
  } catch (err) {
    res.redirect('/admin/dashboard?error=Failed+to+create+user');
  }
});

router.get('/users/:id/edit', async (req, res) => {
  const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.redirect('/admin/dashboard');
  res.render('admin/edit-user', { user: req.session.user, target, error: null, success: null });
});

router.post('/users/:id/edit', async (req, res) => {
  try {
    const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!target) return res.redirect('/admin/dashboard');

    const { email, fullName, phoneNumber, address, role, zone, state, lga, isActive, forcedPassword } = req.body;

    if (email && email.trim().length > 0) {
      const emailTaken = await db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email.trim(), target.id);
      if (emailTaken) {
        return res.render('admin/edit-user', { user: req.session.user, target, error: 'Email already in use by another account', success: null });
      }
    }

    await db.prepare(`
      UPDATE users SET email = ?, fullName = ?, phoneNumber = ?, address = ?, role = ?, zone = ?, state = ?, lga = ?, isActive = ?
      WHERE id = ?
    `).run(email ? email.trim() : target.email, fullName, phoneNumber || null, address || null, role, zone || null, state || null, lga || null, isActive === 'on' ? 1 : 0, target.id);

    if (forcedPassword && forcedPassword.trim().length > 0) {
      await db.prepare('UPDATE users SET password = ? WHERE id = ?').run(forcedPassword.trim(), target.id);
    }

    const updated = await db.prepare('SELECT * FROM users WHERE id = ?').get(target.id);
    res.render('admin/edit-user', { user: req.session.user, target: updated, error: null, success: 'User updated successfully' });
  } catch (err) {
    res.redirect('/admin/dashboard?error=Failed+to+update+user');
  }
});

router.post('/users/:id/delete', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (id === req.session.user.id) {
      return res.redirect('/admin/dashboard?error=Cannot+delete+your+own+account');
    }

    const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!target) return res.redirect('/admin/dashboard?error=User+not+found');

    const reassignTo = parseInt(req.body.reassignTo) || null;

    await db.transaction(async (tx) => {
      if (reassignTo) {
        await tx.prepare('UPDATE sales_entries SET loggedBy = ? WHERE loggedBy = ?').run(reassignTo, id);
        await tx.prepare('UPDATE payment_history SET confirmedBy = ? WHERE confirmedBy = ?').run(reassignTo, id);
        await tx.prepare('UPDATE products SET createdBy = ? WHERE createdBy = ?').run(reassignTo, id);
        await tx.prepare('UPDATE target_tiers SET createdBy = ? WHERE createdBy = ?').run(reassignTo, id);
        await tx.prepare('UPDATE users SET removedBy = ? WHERE removedBy = ?').run(reassignTo, id);
        await tx.prepare('UPDATE archived_months SET archivedBy = ? WHERE archivedBy = ?').run(reassignTo, id);
      } else {
        await tx.prepare('UPDATE sales_entries SET loggedBy = NULL WHERE loggedBy = ?').run(id);
        await tx.prepare('UPDATE payment_history SET confirmedBy = NULL WHERE confirmedBy = ?').run(id);
        await tx.prepare('UPDATE products SET createdBy = NULL WHERE createdBy = ?').run(id);
        await tx.prepare('UPDATE target_tiers SET createdBy = NULL WHERE createdBy = ?').run(id);
        await tx.prepare('UPDATE users SET removedBy = NULL WHERE removedBy = ?').run(id);
        await tx.prepare('UPDATE archived_months SET archivedBy = NULL WHERE archivedBy = ?').run(id);
      }

      const entryRows = await tx.prepare('SELECT id FROM sales_entries WHERE csrId = ?').all(id);
      const entryIds = entryRows.map(r => r.id);
      if (entryIds.length > 0) {
        const placeholders = entryIds.map(() => '?').join(',');
        await tx.prepare(`DELETE FROM sales_entry_items WHERE entryId IN (${placeholders})`).run(...entryIds);
      }
      await tx.prepare('DELETE FROM sales_entries WHERE csrId = ?').run(id);
      await tx.prepare('DELETE FROM payment_history WHERE csrId = ?').run(id);
      await tx.prepare('DELETE FROM csr_inventory WHERE csrId = ?').run(id);
      await tx.prepare('DELETE FROM csr_tier WHERE csrId = ?').run(id);
      await tx.prepare('DELETE FROM users WHERE id = ?').run(id);
    });

    res.redirect('/admin/dashboard?success=User+deleted');
  } catch (err) {
    res.redirect('/admin/dashboard?error=Failed+to+delete+user');
  }
});

router.get('/products', async (req, res) => {
  const products = await db.prepare('SELECT * FROM products ORDER BY id').all();
  res.render('admin/products', { products, user: req.session.user, success: null, error: null });
});

router.get('/products/create', (req, res) => {
  res.render('admin/create-product', { user: req.session.user, error: null });
});

router.post('/products/create', async (req, res) => {
  try {
    const { name, grammage } = req.body;
    if (!name || name.trim().length === 0) {
      return res.render('admin/create-product', { user: req.session.user, error: 'Product name is required' });
    }
    if (!grammage || grammage.trim().length === 0) {
      return res.render('admin/create-product', { user: req.session.user, error: 'Grammage is required' });
    }
    await db.prepare(`
      INSERT INTO products (name, grammage, createdBy, isActive, createdAt)
      VALUES (?, ?, ?, 1, NOW())
    `).run(name.trim(), grammage.trim(), req.session.user.id);
    res.redirect('/admin/products?success=Product+created');
  } catch (err) {
    res.redirect('/admin/products?error=Failed+to+create+product');
  }
});

router.post('/products/:id/delete', async (req, res) => {
  try {
    await db.prepare('DELETE FROM sales_entry_items WHERE productId = ?').run(req.params.id);
    await db.prepare('DELETE FROM csr_inventory WHERE productId = ?').run(req.params.id);
    await db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    res.redirect('/admin/products?success=Product+deleted');
  } catch (err) {
    res.redirect('/admin/products?error=Failed+to+delete+product');
  }
});

module.exports = router;