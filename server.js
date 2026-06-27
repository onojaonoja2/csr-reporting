require('dotenv').config();
const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-change-me',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

const globalLimiter = rateLimit({
  windowMs: parseInt(process.env.GLOBAL_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.GLOBAL_RATE_LIMIT_MAX) || 100,
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

function csrfProtection(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateCsrfToken();
  }
  res.locals.csrfToken = req.session.csrfToken;

  if (req.method === 'GET') {
    return next();
  }

  const token = req.body._csrf || req.headers['x-csrf-token'];
  if (!token || token !== req.session.csrfToken) {
    req.session.csrfToken = generateCsrfToken();
    res.locals.csrfToken = req.session.csrfToken;
    return res.status(403).render('index', { error: 'Invalid or missing CSRF token. Please try again.' });
  }
  req.session.csrfToken = generateCsrfToken();
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.currentPath = req.path;
  next();
});

app.use(csrfProtection);

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const supervisorRoutes = require('./routes/supervisor');
const managerRoutes = require('./routes/manager');

app.use('/', authRoutes);
app.use('/admin', adminRoutes);
app.use('/supervisor', supervisorRoutes);
app.use('/manager', managerRoutes);

app.listen(PORT, () => {
  console.log(`Elkris CSR Reporting running at http://localhost:${PORT}`);
});
