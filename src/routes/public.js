import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

export default function publicRoutes(csrfProtection) {
  const router = Router();

  router.get('/', csrfProtection, async (req, res, next) => {
    try {
      const [hotels] = await pool.query('SELECT * FROM hotels ORDER BY created_at DESC LIMIT 12');
      res.render('public/index', { csrfToken: req.csrfToken(), hotels });
    } catch (e) {
      next(e);
    }
  });

  router.get('/hotels', csrfProtection, async (req, res, next) => {
    try {
      const q = (req.query.q || '').trim();
      const location = (req.query.location || '').trim();
      const minPrice = req.query.minPrice ? Number(req.query.minPrice) : null;
      const maxPrice = req.query.maxPrice ? Number(req.query.maxPrice) : null;
      const roomType = (req.query.roomType || '').trim();

      // Search hotels + show min room price
      const where = [];
      const params = {};
      if (q) {
        where.push('(h.name LIKE :q OR h.description LIKE :q)');
        params.q = `%${q}%`;
      }
      if (location) {
        where.push('(h.location LIKE :location)');
        params.location = `%${location}%`;
      }

      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const [hotels] = await pool.query(
        `SELECT h.*, MIN(r.price_per_night) AS starting_price
         FROM hotels h
         LEFT JOIN rooms r ON r.hotel_id = h.id
         ${whereSql}
         GROUP BY h.id
         ORDER BY h.created_at DESC`,
        params
      );

      res.render('public/hotels', {
        csrfToken: req.csrfToken(),
        hotels,
        filters: { q, location, minPrice, maxPrice, roomType }
      });
    } catch (e) {
      next(e);
    }
  });

  router.get('/hotels/:id', csrfProtection, async (req, res, next) => {
    try {
      const hotelId = Number(req.params.id);
      const [hotels] = await pool.query('SELECT * FROM hotels WHERE id=:id', { id: hotelId });
      if (!hotels.length) return res.status(404).send('Hotel not found');

      // Basic room filters
      const minPrice = req.query.minPrice ? Number(req.query.minPrice) : null;
      const maxPrice = req.query.maxPrice ? Number(req.query.maxPrice) : null;
      const roomType = (req.query.roomType || '').trim();

      const where = ['hotel_id = :hotel_id'];
      const params = { hotel_id: hotelId };
      if (Number.isFinite(minPrice)) {
        where.push('price_per_night >= :minPrice');
        params.minPrice = minPrice;
      }
      if (Number.isFinite(maxPrice)) {
        where.push('price_per_night <= :maxPrice');
        params.maxPrice = maxPrice;
      }
      if (roomType) {
        where.push('room_type = :roomType');
        params.roomType = roomType;
      }

      const [rooms] = await pool.query(
        `SELECT * FROM rooms WHERE ${where.join(' AND ')} ORDER BY price_per_night ASC`,
        params
      );

      res.render('public/hotel', {
        csrfToken: req.csrfToken(),
        hotel: hotels[0],
        rooms,
        filters: { minPrice, maxPrice, roomType }
      });
    } catch (e) {
      next(e);
    }
  });

  router.get('/dashboard', requireAuth, csrfProtection, async (req, res, next) => {
    try {
      const userId = req.session.userId;
      const [bookings] = await pool.query(
        `SELECT b.*, r.name as room_name, r.room_type, h.name as hotel_name, h.location
         FROM bookings b
         JOIN rooms r ON r.id=b.room_id
         JOIN hotels h ON h.id=r.hotel_id
         WHERE b.user_id=:userId
         ORDER BY b.created_at DESC`,
        { userId }
      );
      res.render('public/dashboard', { csrfToken: req.csrfToken(), bookings });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
