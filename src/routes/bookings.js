import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { submitOrderRequest, registerIpnUrl } from '../services/pesapal.js';
import { sendEmail } from '../services/email.js';

function daysBetween(checkIn, checkOut) {
  const inD = new Date(`${checkIn}T00:00:00Z`);
  const outD = new Date(`${checkOut}T00:00:00Z`);
  const diff = (outD - inD) / (1000 * 60 * 60 * 24);
  return Math.floor(diff);
}

async function isRoomAvailable(roomId, checkIn, checkOut) {
  // Overlap rule: existing.check_in < new.check_out AND existing.check_out > new.check_in
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM bookings
     WHERE room_id = :roomId
       AND status IN ('PendingPayment','Paid','Approved','Completed')
       AND check_in < :checkOut
       AND check_out > :checkIn`,
    { roomId, checkIn, checkOut }
  );
  return rows[0].cnt === 0;
}

export default function bookingRoutes(csrfProtection) {
  const router = Router();

  router.get('/new/:roomId', requireAuth, csrfProtection, async (req, res, next) => {
    try {
      const roomId = Number(req.params.roomId);
      const [rooms] = await pool.query(
        `SELECT r.*, h.name as hotel_name, h.location
         FROM rooms r JOIN hotels h ON h.id=r.hotel_id
         WHERE r.id=:id`,
        { id: roomId }
      );
      if (!rooms.length) return res.status(404).send('Room not found');

      res.render('public/booking_new', { csrfToken: req.csrfToken(), room: rooms[0], errors: [], old: {} });
    } catch (e) {
      next(e);
    }
  });

  router.post(
    '/preview',
    requireAuth,
    csrfProtection,
    body('room_id').isInt({ min: 1 }).toInt(),
    body('check_in').isISO8601().toDate(),
    body('check_out').isISO8601().toDate(),
    async (req, res, next) => {
      try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).send('Invalid input');

        const roomId = req.body.room_id;
        const checkIn = req.body.check_in.toISOString().slice(0, 10);
        const checkOut = req.body.check_out.toISOString().slice(0, 10);
        const nights = daysBetween(checkIn, checkOut);
        if (nights <= 0) return res.status(400).send('Check-out must be after check-in');

        const [rooms] = await pool.query(
          `SELECT r.*, h.name as hotel_name, h.location
           FROM rooms r JOIN hotels h ON h.id=r.hotel_id
           WHERE r.id=:id`,
          { id: roomId }
        );
        if (!rooms.length) return res.status(404).send('Room not found');

        const available = await isRoomAvailable(roomId, checkIn, checkOut);
        if (!available) {
          return res.status(409).send('Selected dates are not available for this room.');
        }

        const total = Number(rooms[0].price_per_night) * nights;

        res.render('public/booking_preview', {
          csrfToken: req.csrfToken(),
          room: rooms[0],
          booking: { checkIn, checkOut, nights, total }
        });
      } catch (e) {
        next(e);
      }
    }
  );

  router.post(
    '/create-and-pay',
    requireAuth,
    csrfProtection,
    body('room_id').isInt({ min: 1 }).toInt(),
    body('check_in').isISO8601(),
    body('check_out').isISO8601(),
    async (req, res, next) => {
      const conn = await pool.getConnection();
      try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).send('Invalid input');

        const userId = req.session.userId;
        const roomId = req.body.room_id;
        const checkIn = String(req.body.check_in);
        const checkOut = String(req.body.check_out);

        const nights = daysBetween(checkIn, checkOut);
        if (nights <= 0) return res.status(400).send('Check-out must be after check-in');

        await conn.beginTransaction();

        // Lock room row to reduce race conditions
        const [rooms] = await conn.query(
          `SELECT r.*, h.name as hotel_name, h.location
           FROM rooms r
           JOIN hotels h ON h.id=r.hotel_id
           WHERE r.id=:id
           FOR UPDATE`,
          { id: roomId }
        );
        if (!rooms.length) {
          await conn.rollback();
          return res.status(404).send('Room not found');
        }

        const available = await (async () => {
          const [rows] = await conn.query(
            `SELECT COUNT(*) AS cnt
             FROM bookings
             WHERE room_id = :roomId
               AND status IN ('PendingPayment','Paid','Approved','Completed')
               AND check_in < :checkOut
               AND check_out > :checkIn
             FOR UPDATE`,
            { roomId, checkIn, checkOut }
          );
          return rows[0].cnt === 0;
        })();

        if (!available) {
          await conn.rollback();
          return res.status(409).send('Selected dates are not available for this room.');
        }

        const total = Number(rooms[0].price_per_night) * nights;

        const merchant_reference = `HB-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

        const [bookingResult] = await conn.query(
          `INSERT INTO bookings
           (user_id, room_id, check_in, check_out, nights, total_amount, status, pesapal_merchant_reference)
           VALUES (:user_id, :room_id, :check_in, :check_out, :nights, :total, 'PendingPayment', :merchant_reference)`,
          { user_id: userId, room_id: roomId, check_in: checkIn, check_out: checkOut, nights, total, merchant_reference }
        );
        const bookingId = bookingResult.insertId;

        const currency = process.env.CURRENCY || 'KES';

        // Ensure we have an IPN ID
        let ipnId = process.env.PESAPAL_IPN_ID;
        if (!ipnId) {
          const ipnUrl = `${process.env.APP_BASE_URL}/pesapal/ipn`;
          ipnId = await registerIpnUrl(ipnUrl);
          // For production you should persist it; for simplicity we keep it in memory via env.
          process.env.PESAPAL_IPN_ID = ipnId;
        }

        // Get user info for billing
        const [users] = await conn.query('SELECT name, email FROM users WHERE id=:id', { id: userId });

        const callback_url = `${process.env.APP_BASE_URL}/pesapal/callback?bookingId=${bookingId}`;

        const order = await submitOrderRequest({
          amount: total,
          currency,
          description: `Booking for ${rooms[0].hotel_name} - ${rooms[0].name} (${checkIn} to ${checkOut})`,
          callback_url,
          notification_id: ipnId,
          merchant_reference,
          billing_address: {
            email_address: users[0].email,
            phone_number: '',
            country_code: 'KE',
            first_name: users[0].name,
            last_name: ''
          }
        });

        // Persist tracking id
        await conn.query(
          'UPDATE bookings SET pesapal_order_tracking_id=:tid WHERE id=:id',
          { tid: order.order_tracking_id, id: bookingId }
        );

        await conn.query(
          `INSERT INTO payments (booking_id, provider, currency, amount, status, merchant_reference, order_tracking_id)
           VALUES (:booking_id, 'PESAPAL', :currency, :amount, 'INITIATED', :merchant_reference, :order_tracking_id)`,
          {
            booking_id: bookingId,
            currency,
            amount: total,
            merchant_reference,
            order_tracking_id: order.order_tracking_id
          }
        );

        await conn.commit();

        // Email notification (best-effort)
        sendEmail(users[0].email, 'Booking Created - Awaiting Payment',
          `<p>Your booking has been created and is awaiting payment.</p>
           <p><b>Hotel:</b> ${rooms[0].hotel_name} (${rooms[0].location})<br/>
           <b>Room:</b> ${rooms[0].name}<br/>
           <b>Dates:</b> ${checkIn} to ${checkOut}<br/>
           <b>Total:</b> ${currency} ${total.toFixed(2)}</p>`
        ).catch(() => {});

        // Redirect to Pesapal hosted payment page
        return res.redirect(order.redirect_url);
      } catch (e) {
        try { await conn.rollback(); } catch {}
        next(e);
      } finally {
        conn.release();
      }
    }
  );

  return router;
}
