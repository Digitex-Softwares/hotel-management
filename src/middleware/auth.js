import { pool } from '../db.js';

export async function attachUserToLocals(req, res, next) {
  try {
    res.locals.currentUser = null;
    if (!req.session.userId) return next();

    const [rows] = await pool.query(
      'SELECT id, name, email, role FROM users WHERE id = :id LIMIT 1',
      { id: req.session.userId }
    );
    if (rows.length) res.locals.currentUser = rows[0];
    return next();
  } catch (e) {
    return next(e);
  }
}

export function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/auth/login');
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.redirect('/auth/login');
  if (!res.locals.currentUser || res.locals.currentUser.role !== 'admin') return res.status(403).send('Forbidden');
  next();
}
