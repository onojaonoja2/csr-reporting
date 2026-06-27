const express = require('express');
const router = express.Router();
const { isAuthenticated, roleGuard } = require('../middleware/auth');
const db = require('../db');

router.use(isAuthenticated, roleGuard('admin'));

router.get('/dashboard', (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY id').all();
  res.render('admin/dashboard', { users, user: req.session.user });
});

router.get('/users/create', (req, res) => {
  res.render('admin/create-user', { user: req.session.user, error: null });
});

router.post('/users/create', (req, res) => {
  const { email, password, fullName, phoneNumber, address, role, zone, state, lga } = req.body;

  if (!email || email.trim().length === 0) {
    return res.render('admin/create-user', { user: req.session.user, error: 'Email is required' });
  }

  const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim());
  if (existingEmail) {
    return res.render('admin/create-user', { user: req.session.user, error: 'Email already exists' });
  }

  function generateUsername(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
  }

  let username = generateUsername(fullName);
  let suffix = 1;
  while (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    username = generateUsername(fullName) + suffix;
    suffix++;
  }

  if (!password || password.trim().length === 0) {
    return res.render('admin/create-user', { user: req.session.user, error: 'Password is required' });
  }

  db.prepare(`
    INSERT INTO users (username, email, password, fullName, phoneNumber, address, role, zone, state, lga, isActive, theme, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'light', datetime('now'))
  `).run(username, email.trim(), password.trim(), fullName, phoneNumber || null, address || null, role || 'csr', zone || null, state || null, lga || null);
  res.redirect('/admin/dashboard');
});

router.get('/users/:id/edit', (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.redirect('/admin/dashboard');
  res.render('admin/edit-user', { user: req.session.user, target, error: null, success: null });
});

router.post('/users/:id/edit', (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.redirect('/admin/dashboard');

  const { email, fullName, phoneNumber, address, role, zone, state, lga, isActive, forcedPassword } = req.body;

  if (email && email.trim().length > 0) {
    const emailTaken = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email.trim(), target.id);
    if (emailTaken) {
      return res.render('admin/edit-user', { user: req.session.user, target, error: 'Email already in use by another account', success: null });
    }
  }

  db.prepare(`
    UPDATE users SET email = ?, fullName = ?, phoneNumber = ?, address = ?, role = ?, zone = ?, state = ?, lga = ?, isActive = ?
    WHERE id = ?
  `).run(email ? email.trim() : target.email, fullName, phoneNumber || null, address || null, role, zone || null, state || null, lga || null, isActive === 'on' ? 1 : 0, target.id);

  if (forcedPassword && forcedPassword.trim().length > 0) {
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(forcedPassword.trim(), target.id);
  }

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(target.id);
  res.render('admin/edit-user', { user: req.session.user, target: updated, error: null, success: 'User updated successfully' });
});

router.post('/users/:id/delete', (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.redirect('/admin/dashboard');
});

router.get('/products', (req, res) => {
  const products = db.prepare('SELECT * FROM products ORDER BY id').all();
  res.render('admin/products', { products, user: req.session.user, success: null, error: null });
});

router.get('/products/create', (req, res) => {
  res.render('admin/create-product', { user: req.session.user, error: null });
});

router.post('/products/create', (req, res) => {
  const { name, grammage } = req.body;

  if (!name || name.trim().length === 0) {
    return res.render('admin/create-product', { user: req.session.user, error: 'Product name is required' });
  }
  if (!grammage || grammage.trim().length === 0) {
    return res.render('admin/create-product', { user: req.session.user, error: 'Grammage is required' });
  }

  db.prepare(`
    INSERT INTO products (name, grammage, createdBy, isActive, createdAt)
    VALUES (?, ?, ?, 1, datetime('now'))
  `).run(name.trim(), grammage.trim(), req.session.user.id);

  res.redirect('/admin/products');
});

router.post('/products/:id/delete', (req, res) => {
  db.prepare('DELETE FROM sales_entry_items WHERE productId = ?').run(req.params.id);
  db.prepare('DELETE FROM csr_inventory WHERE productId = ?').run(req.params.id);
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.redirect('/admin/products');
});

module.exports = router;
