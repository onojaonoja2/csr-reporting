const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const db = require('../db');

const loginLimiter = rateLimit({
  windowMs: parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.LOGIN_RATE_LIMIT_MAX) || 5,
  message: 'Too many login attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/', (req, res) => {
  if (req.session.user) {
    const roleRedirects = { admin: '/admin/dashboard', supervisor: '/supervisor/dashboard', manager: '/manager/dashboard', csr: '/supervisor/dashboard' };
    return res.redirect(roleRedirects[req.session.user.role] || '/');
  }
  res.render('index', { error: null });
});

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  const user = await db.prepare('SELECT * FROM users WHERE email = ? AND isActive = 1').get(email);
  if (!user || user.password !== password) {
    return res.render('index', { error: 'Invalid credentials or inactive account' });
  }
  req.session.user = { id: user.id, email: user.email, fullName: user.fullName, role: user.role, zone: user.zone, state: user.state, lga: user.lga, theme: user.theme };
  const roleRedirects = { admin: '/admin/dashboard', supervisor: '/supervisor/dashboard', manager: '/manager/dashboard', csr: '/supervisor/dashboard' };
  res.redirect(roleRedirects[user.role] || '/');
});

router.get('/logout', (req, res) => {
  res.render('confirm-logout', { user: req.session.user });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

router.get('/profile', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  res.render('profile', { user: req.session.user, error: null, success: null });
});

router.post('/profile', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const { currentPassword, newPassword, confirmPassword } = req.body;
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  if (!user) return res.redirect('/');

  if (newPassword && newPassword.trim().length > 0) {
    if (!currentPassword || user.password !== currentPassword) {
      return res.render('profile', { user: req.session.user, error: 'Current password is incorrect', success: null });
    }
    if (newPassword !== confirmPassword) {
      return res.render('profile', { user: req.session.user, error: 'New passwords do not match', success: null });
    }
    await db.prepare('UPDATE users SET password = ? WHERE id = ?').run(newPassword.trim(), user.id);
    return res.render('profile', { user: req.session.user, error: null, success: 'Password updated successfully' });
  }

  return res.render('profile', { user: req.session.user, error: null, success: null });
});

router.get('/api/states/:zone', (req, res) => {
  const data = require('../config/nigeriaGeopoliticalData');
  const states = data[req.params.zone] ? Object.keys(data[req.params.zone]) : [];
  res.json(states);
});

router.get('/api/lgas/:zone/:state', (req, res) => {
  const data = require('../config/nigeriaGeopoliticalData');
  const zone = data[req.params.zone];
  const lgas = zone && zone[req.params.state] ? zone[req.params.state] : [];
  res.json(lgas);
});

module.exports = router;