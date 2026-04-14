import { Router } from 'express';
import { pool } from '../db.js';
import { getTransactionStatus } from '../services/pesapal.js';
import { sendEmail } from '../services/email.js';

function mapPesapalStatusToPayment(status) {
  // Pesapal commonly returns: COMPLETED, FAILED, INVALID, PENDING
  const s = String(status || '').toUpperCase();
  if (s === 'COMPLETED') return 'COMPLETED';
  if (s === 'FAILED' || s === 'INVALID') return 'FAILED';
  return 'PENDING';
}

export default function pesapalRoutes() {
  const router = Router();

  // User browser redirect back after checkout
  // Pesapal typically appends: OrderTrackingId, OrderMerchantReference
  router.get('/callback', async (req, res, next) => {
    try {
      const bookingId = Number(req.query.bookingId);
      // Show a friendly page; actual status is finalized via IPN, but we also try to verify here.
      if (!bookingId) return res.redirect('/dashboard');

      const [bookings] = await pool.query('SELECT * FROM bookings WHERE id=:id', { id: bookingId });
      if (!bookings.length) return res.redirect('/dashboard');

      const b = bookings[0];
      if (b.pesapal_order_tracking_id) {
        const status = await getTransactionStatus(b.pesapal_order_tracking_id);
        const paymentStatus = mapPesapalStatusToPayment(status.payment_status_description || status.status);

        // Best-effort update; IPN is authoritative but callback helps immediate UX.
        await pool.query(
          'UPDATE payments SET status=:status WHERE order_tracking_id=:tid',
          { status: paymentStatus, tid: b.pesapal_order_tracking_id }
        );
        if (paymentStatus === 'COMPLETED') {
          await pool.query('UPDATE bookings SET status=\'Paid\' WHERE id=:id AND status IN (\'PendingPayment\',\'PaymentFailed\')', { id: bookingId });
        }
      }

      res.redirect('/dashboard');
    } catch (e) {
      next(e);
    }
  });

  // IPN (Instant Payment Notification) listener.
  // Pesapal sends GET query params (commonly): OrderTrackingId, OrderMerchantReference, OrderNotificationType
  router.get('/ipn', async (req, res, next) => {
    try {
      const orderTrackingId = req.query.OrderTrackingId || req.query.orderTrackingId || req.query.order_tracking_id;
      const merchantReference = req.query.OrderMerchantReference || req.query.orderMerchantReference || req.query.merchant_reference;

      if (!orderTrackingId) return res.status(400).send('Missing OrderTrackingId');

      // Verify status with Pesapal API (never trust IPN params alone)
      const status = await getTransactionStatus(orderTrackingId);
      const paymentStatus = mapPesapalStatusToPayment(status.payment_status_description || status.status);

      // Update payments + booking atomically
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        // Upsert payment record
        const [pRows] = await conn.query('SELECT id, booking_id FROM payments WHERE order_tracking_id=:tid LIMIT 1 FOR UPDATE', { tid: orderTrackingId });

        if (pRows.length) {
          await conn.query(
            `UPDATE payments
             SET status=:status,
                 merchant_reference=COALESCE(merchant_reference, :merchantReference),
                 confirmation_code=:confirmation_code,
                 payment_method=:payment_method,
                 raw_ipn=:raw_ipn
             WHERE order_tracking_id=:tid`,
            {
              status: paymentStatus,
              merchantReference: merchantReference || null,
              confirmation_code: status.confirmation_code || null,
              payment_method: status.payment_method || null,
              raw_ipn: JSON.stringify({ ipn: req.query, verification: status }),
              tid: orderTrackingId
            }
          );
        }

        const [bRows] = await conn.query(
          'SELECT id, user_id, status, pesapal_order_tracking_id FROM bookings WHERE pesapal_order_tracking_id=:tid LIMIT 1 FOR UPDATE',
          { tid: orderTrackingId }
        );

        if (bRows.length) {
          const booking = bRows[0];
          if (paymentStatus === 'COMPLETED') {
            await conn.query(
              'UPDATE bookings SET status=\'Paid\' WHERE id=:id AND status IN (\'PendingPayment\',\'PaymentFailed\')',
              { id: booking.id }
            );
          } else if (paymentStatus === 'FAILED') {
            await conn.query(
              'UPDATE bookings SET status=\'PaymentFailed\' WHERE id=:id AND status=\'PendingPayment\'',
              { id: booking.id }
            );
          }

          // Send payment email (best effort)
          const [uRows] = await conn.query('SELECT email, name FROM users WHERE id=:id', { id: booking.user_id });
          if (uRows.length && paymentStatus === 'COMPLETED') {
            sendEmail(uRows[0].email, 'Payment Received - Booking Paid',
              `<p>Hi ${uRows[0].name},</p><p>Your payment was received successfully. Your booking is now <b>Paid</b>.</p>`
            ).catch(() => {});
          }
        }

        await conn.commit();
      } catch (e) {
        try { await conn.rollback(); } catch {}
        throw e;
      } finally {
        conn.release();
      }

      // Pesapal expects a 200 OK quickly.
      res.status(200).send('OK');
    } catch (e) {
      next(e);
    }
  });

  return router;
}
