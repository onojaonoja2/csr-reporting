function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect('/');
}

function roleGuard(...allowedRoles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) return res.redirect('/');
    if (!allowedRoles.includes(req.session.user.role)) {
      return res.status(403).send('Access denied');
    }
    next();
  };
}

module.exports = { isAuthenticated, roleGuard };
