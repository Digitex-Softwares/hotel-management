import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// Pesapal v3 endpoints
const env = (process.env.PESAPAL_ENV || 'sandbox').toLowerCase();
const BASE = env === 'production'
  ? 'https://pay.pesapal.com/v3'
  : 'https://cybqa.pesapal.com/pesapalv3';

function must(value, name) {
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export async function getAccessToken() {
  const consumer_key = must(process.env.PESAPAL_CONSUMER_KEY, 'PESAPAL_CONSUMER_KEY');
  const consumer_secret = must(process.env.PESAPAL_CONSUMER_SECRET, 'PESAPAL_CONSUMER_SECRET');

  const url = `${BASE}/api/Auth/RequestToken`;
  const res = await axios.post(url, {
    consumer_key,
    consumer_secret
  }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 20000
  });

  if (!res.data || !res.data.token) {
    throw new Error('Failed to obtain Pesapal access token');
  }
  return res.data.token;
}

export async function registerIpnUrl(notificationUrl) {
  // If you already have an IPN ID from Pesapal portal, you can skip registration.
  const token = await getAccessToken();
  const url = `${BASE}/api/URLSetup/RegisterIPN`;
  const res = await axios.post(url, {
    url: notificationUrl,
    ipn_notification_type: 'GET' // Pesapal sends query params in GET to your IPN URL
  }, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    timeout: 20000
  });

  if (!res.data || !res.data.ipn_id) throw new Error('Failed to register IPN URL');
  return res.data.ipn_id;
}

export async function submitOrderRequest({
  amount,
  currency,
  description,
  callback_url,
  notification_id,
  merchant_reference,
  billing_address
}) {
  const token = await getAccessToken();
  const url = `${BASE}/api/Transactions/SubmitOrderRequest`;

  const payload = {
    id: merchant_reference,
    currency,
    amount: Number(amount),
    description,
    callback_url,
    notification_id,
    billing_address
  };

  const res = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    timeout: 20000
  });

  // Expected: {order_tracking_id, merchant_reference, redirect_url, error, status}
  if (!res.data || !res.data.redirect_url || !res.data.order_tracking_id) {
    throw new Error(`Pesapal submit order failed: ${JSON.stringify(res.data)}`);
  }

  return res.data;
}

export async function getTransactionStatus(orderTrackingId) {
  const token = await getAccessToken();
  const url = `${BASE}/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(orderTrackingId)}`;

  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 20000
  });

  return res.data;
}
