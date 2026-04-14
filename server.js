import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import csrf from 'csurf';

import { pool, ensureAdminSeed } from './src/db.js';
import { attachUserToLocals } from './src/middleware/auth.js';

import authRoutes from './src/routes/auth.js';
import publicRoutes from './src/routes/public.js';
import bookingRoutes from './src/routes/bookings.js';
import adminRoutes from './src/routes/admin.js';
import pesapalRoutes from './src/routes/pesapal.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({
  contentSecurityPolicy: false // keep simple for demo; in production, set strict CSP for inline scripts
}));
app.use(cookieParser());
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use(session({
  name: 'hb.sid',
  secret: process.env.SESSION_SECRET || 'dev_secret_change_me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false // set true behind HTTPS
  }
}));

// CSRF protection for browser forms.
// Note: Pesapal IPN is a server-to-server callback and must NOT be blocked by CSRF.
const csrfProtection = csrf({ cookie: false });

app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(attachUserToLocals);

// Attach CSRF token to all GET-rendered pages (except IPN endpoints)
app.use((req, res, next) => {
  // apply csrf to non-API browser routes
  // We will explicitly apply csrfProtection per-router for HTML pages.
  next();
});

app.get('/health', async (req, res) => {
  const [rows] = await pool.query('SELECT 1 as ok');
  res.json({ ok: true, db: rows[0].ok });
});

// Routers
app.use('/', publicRoutes(csrfProtection));
app.use('/auth', authRoutes(csrfProtection));
app.use('/bookings', bookingRoutes(csrfProtection));
app.use('/admin', adminRoutes(csrfProtection));
app.use('/pesapal', pesapalRoutes()); // IPN must not use CSRF

// Error handler (including CSRF)
app.use((err, req, res, next) => {
  if (err && err.code === 'EBADCSRFTOKEN') {
    return res.status(403).send('Invalid CSRF token. Please refresh and try again.');
  }
  console.error(err);
  res.status(500).send('Server error');
});

const port = Number(process.env.PORT || 3000);

(async () => {
  await ensureAdminSeed();
  app.listen(port, () => {
    console.log(`Server running on ${process.env.APP_BASE_URL || `http://localhost:${port}`}`);
  });
})();
