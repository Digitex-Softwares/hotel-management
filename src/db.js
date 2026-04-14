import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

export const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
  charset: 'utf8mb4'
});

export async function ensureAdminSeed() {
  const email = process.env.ADMIN_EMAIL;
  const pass = process.env.ADMIN_PASSWORD;
  if (!email || !pass) return;

  const [existing] = await pool.query('SELECT id FROM users WHERE email = :email LIMIT 1', { email });
  if (existing.length) return;

  const password_hash = await bcrypt.hash(pass, 12);
  await pool.query(
    'INSERT INTO users (name, email, password_hash, role) VALUES (:name, :email, :password_hash, :role)',
    { name: 'Administrator', email, password_hash, role: 'admin' }
  );
  console.log(`Seeded admin user: ${email}`);
}
