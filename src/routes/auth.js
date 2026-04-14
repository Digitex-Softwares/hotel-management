import { Router } from 'express';
import bcrypt from 'bcrypt';
import { body, validationResult } from 'express-validator';
import { pool } from '../db.js';

export default function authRoutes(csrfProtection) {
  const router = Router();

  router.get('/register', csrfProtection, (req, res) => {
    res.render('auth/register', { csrfToken: req.csrfToken(), errors: [], old: {} });
  });

  router.post(
    '/register',
    csrfProtection,
    body('name').trim().isLength({ min: 2, max: 120 }),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8, max: 100 }),
    async (req, res, next) => {
      try {
        const errors = validationResult(req);
        const old = { name: req.body.name, email: req.body.email };
        if (!errors.isEmpty()) {
          return res.status(400).render('auth/register', { csrfToken: req.csrfToken(), errors: errors.array(), old });
        }

        const { name, email, password } = req.body;
        const [existing] = await pool.query('SELECT id FROM users WHERE email = :email LIMIT 1', { email });
        if (existing.length) {
          return res.status(400).render('auth/register', {
            csrfToken: req.csrfToken(),
            errors: [{ msg: 'Email already registered.' }],
            old
          });
        }

        const password_hash = await bcrypt.hash(password, 12);
        const [result] = await pool.query(
          'INSERT INTO users (name, email, password_hash, role) VALUES (:name, :email, :password_hash, :role)',
          { name, email, password_hash, role: 'user' }
        );

        req.session.userId = result.insertId;
        res.redirect('/dashboard');
      } catch (e) {
        next(e);
      }
    }
  );

  router.get('/login', csrfProtection, (req, res) => {
    res.render('auth/login', { csrfToken: req.csrfToken(), errors: [], old: {} });
  });

  router.post(
    '/login',
    csrfProtection,
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 1 }),
    async (req, res, next) => {
      try {
        const errors = validationResult(req);
        const old = { email: req.body.email };
        if (!errors.isEmpty()) {
          return res.status(400).render('auth/login', { csrfToken: req.csrfToken(), errors: errors.array(), old });
        }

        const { email, password } = req.body;
        const [rows] = await pool.query('SELECT id, password_hash, role FROM users WHERE email = :email LIMIT 1', { email });
        if (!rows.length) {
          return res.status(401).render('auth/login', { csrfToken: req.csrfToken(), errors: [{ msg: 'Invalid credentials.' }], old });
        }

        const ok = await bcrypt.compare(password, rows[0].password_hash);
        if (!ok) {
          return res.status(401).render('auth/login', { csrfToken: req.csrfToken(), errors: [{ msg: 'Invalid credentials.' }], old });
        }

        req.session.userId = rows[0].id;
        if (rows[0].role === 'admin') return res.redirect('/admin');
        res.redirect('/dashboard');
      } catch (e) {
        next(e);
      }
    }
  );

  router.post('/logout', csrfProtection, (req, res) => {
    req.session.destroy(() => res.redirect('/'));
  });

  return router;
}
