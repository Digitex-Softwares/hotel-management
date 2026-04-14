import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { body, validationResult } from 'express-validator';
import { pool } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, '../../uploads')),
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      cb(null, `${Date.now()}-${safe}`);
    }
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Invalid image type'), ok);
  }
});

export default function adminRoutes(csrfProtection) {
  const router = Router();

  router.get('/', requireAdmin, csrfProtection, async (req, res, next) => {
    try {
      const [[stats]] = await pool.query(
        `SELECT
          (SELECT COUNT(*) FROM bookings) AS total_bookings,
          (SELECT COUNT(*) FROM bookings WHERE status='Paid') AS paid_bookings,
          (SELECT IFNULL(SUM(total_amount),0) FROM bookings WHERE status IN ('Paid','Approved','Completed')) AS revenue`
      );
      res.render('admin/index', { csrfToken: req.csrfToken(), stats });
    } catch (e) {
      next(e);
    }
  });

  router.get('/hotels', requireAdmin, csrfProtection, async (req, res, next) => {
    try {
      const [hotels] = await pool.query('SELECT * FROM hotels ORDER BY created_at DESC');
      res.render('admin/hotels', { csrfToken: req.csrfToken(), hotels, errors: [] });
    } catch (e) {
      next(e);
    }
  });

  router.post(
    '/hotels',
    requireAdmin,
    csrfProtection,
    upload.single('image'),
    body('name').trim().isLength({ min: 2, max: 180 }),
    body('location').trim().isLength({ min: 2, max: 180 }),
    body('description').trim().isLength({ min: 0, max: 5000 }),
    async (req, res, next) => {
      try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          const [hotels] = await pool.query('SELECT * FROM hotels ORDER BY created_at DESC');
          return res.status(400).render('admin/hotels', { csrfToken: req.csrfToken(), hotels, errors: errors.array() });
        }

        const image_url = req.file ? `/uploads/${req.file.filename}` : null;
        await pool.query(
          'INSERT INTO hotels (name, location, description, image_url) VALUES (:name, :location, :description, :image_url)',
          { name: req.body.name, location: req.body.location, description: req.body.description, image_url }
        );
        res.redirect('/admin/hotels');
      } catch (e) {
        next(e);
      }
    }
  );

  router.post('/hotels/:id/delete', requireAdmin, csrfProtection, async (req, res, next) => {
    try {
      await pool.query('DELETE FROM hotels WHERE id=:id', { id: Number(req.params.id) });
      res.redirect('/admin/hotels');
    } catch (e) {
      next(e);
    }
  });

  router.get('/rooms', requireAdmin, csrfProtection, async (req, res, next) => {
    try {
      const [rooms] = await pool.query(
        `SELECT r.*, h.name as hotel_name
         FROM rooms r JOIN hotels h ON h.id=r.hotel_id
         ORDER BY r.created_at DESC`
      );
      const [hotels] = await pool.query('SELECT id, name FROM hotels ORDER BY name ASC');
      res.render('admin/rooms', { csrfToken: req.csrfToken(), rooms, hotels, errors: [] });
    } catch (e) {
      next(e);
    }
  });

  router.post(
    '/rooms',
    requireAdmin,
    csrfProtection,
    upload.single('image'),
    body('hotel_id').isInt({ min: 1 }).toInt(),
    body('name').trim().isLength({ min: 2, max: 180 }),
    body('room_type').trim().isLength({ min: 2, max: 80 }),
    body('price_per_night').isFloat({ min: 0 }).toFloat(),
    body('capacity').isInt({ min: 1, max: 20 }).toInt(),
    body('description').trim().isLength({ min: 0, max: 5000 }),
    async (req, res, next) => {
      try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          const [rooms] = await pool.query(
            `SELECT r.*, h.name as hotel_name
             FROM rooms r JOIN hotels h ON h.id=r.hotel_id
             ORDER BY r.created_at DESC`
          );
          const [hotels] = await pool.query('SELECT id, name FROM hotels ORDER BY name ASC');
          return res.status(400).render('admin/rooms', { csrfToken: req.csrfToken(), rooms, hotels, errors: errors.array() });
        }

        const image_url = req.file ? `/uploads/${req.file.filename}` : null;

        await pool.query(
          `INSERT INTO rooms (hotel_id, name, room_type, price_per_night, description, image_url, capacity)
           VALUES (:hotel_id, :name, :room_type, :price_per_night, :description, :image_url, :capacity)`,
          {
            hotel_id: req.body.hotel_id,
            name: req.body.name,
            room_type: req.body.room_type,
            price_per_night: req.body.price_per_night,
            description: req.body.description,
            image_url,
            capacity: req.body.capacity
          }
        );
        res.redirect('/admin/rooms');
      } catch (e) {
        next(e);
      }
    }
  );

  router.post('/rooms/:id/delete', requireAdmin, csrfProtection, async (req, res, next) => {
    try {
      await pool.query('DELETE FROM rooms WHERE id=:id', { id: Number(req.params.id) });
      res.redirect('/admin/rooms');
    } catch (e) {
      next(e);
    }
  });

  router.get('/bookings', requireAdmin, csrfProtection, async (req, res, next) => {
    try {
      const [bookings] = await pool.query(
        `SELECT b.*, u.email as user_email, r.name as room_name, h.name as hotel_name
         FROM bookings b
         JOIN users u ON u.id=b.user_id
         JOIN rooms r ON r.id=b.room_id
         JOIN hotels h ON h.id=r.hotel_id
         ORDER BY b.created_at DESC
         LIMIT 200`
      );
      res.render('admin/bookings', { csrfToken: req.csrfToken(), bookings });
    } catch (e) {
      next(e);
    }
  });

  router.post('/bookings/:id/status', requireAdmin, csrfProtection, async (req, res, next) => {
    try {
      const bookingId = Number(req.params.id);
      const status = String(req.body.status || '');
      const allowed = new Set(['Approved', 'Cancelled', 'Completed']);
      if (!allowed.has(status)) return res.status(400).send('Invalid status');

      await pool.query('UPDATE bookings SET status=:status WHERE id=:id', { status, id: bookingId });
      res.redirect('/admin/bookings');
    } catch (e) {
      next(e);
    }
  });

  router.get('/payments', requireAdmin, csrfProtection, async (req, res, next) => {
    try {
      const [payments] = await pool.query(
        `SELECT p.*, b.user_id, b.total_amount, b.status as booking_status
         FROM payments p
         JOIN bookings b ON b.id=p.booking_id
         ORDER BY p.created_at DESC
         LIMIT 200`
      );
      res.render('admin/payments', { csrfToken: req.csrfToken(), payments });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
