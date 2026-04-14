-- MySQL schema for hotel booking app
-- Create DB then run: mysql -u root -p hotel_booking < db/schema.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('user','admin') NOT NULL DEFAULT 'user',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS hotels (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(180) NOT NULL,
  location VARCHAR(180) NOT NULL,
  description TEXT,
  image_url VARCHAR(512),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_hotels_location (location)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS rooms (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hotel_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(180) NOT NULL,
  room_type VARCHAR(80) NOT NULL,
  price_per_night DECIMAL(10,2) NOT NULL,
  description TEXT,
  image_url VARCHAR(512),
  capacity INT NOT NULL DEFAULT 2,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_rooms_hotel (hotel_id),
  KEY idx_rooms_price (price_per_night),
  KEY idx_rooms_type (room_type),
  CONSTRAINT fk_rooms_hotel FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bookings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  room_id BIGINT UNSIGNED NOT NULL,
  check_in DATE NOT NULL,
  check_out DATE NOT NULL,
  nights INT NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  status ENUM('PendingPayment','Paid','Approved','Cancelled','Completed','PaymentFailed') NOT NULL DEFAULT 'PendingPayment',
  pesapal_order_tracking_id VARCHAR(190),
  pesapal_merchant_reference VARCHAR(190),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bookings_user (user_id),
  KEY idx_bookings_room (room_id),
  KEY idx_bookings_dates (check_in, check_out),
  KEY idx_bookings_tracking (pesapal_order_tracking_id),
  CONSTRAINT fk_bookings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_bookings_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id BIGINT UNSIGNED NOT NULL,
  provider ENUM('PESAPAL') NOT NULL DEFAULT 'PESAPAL',
  currency VARCHAR(10) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  status ENUM('INITIATED','PENDING','COMPLETED','FAILED') NOT NULL DEFAULT 'INITIATED',
  merchant_reference VARCHAR(190),
  order_tracking_id VARCHAR(190),
  confirmation_code VARCHAR(190),
  payment_method VARCHAR(190),
  raw_ipn JSON,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_tracking (order_tracking_id),
  KEY idx_payments_booking (booking_id),
  CONSTRAINT fk_payments_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Seed demo data (optional)
INSERT INTO hotels (name, location, description, image_url)
SELECT 'Sunset Resort', 'Nairobi', 'Modern city hotel with great views.', '/uploads/demo-hotel.jpg'
WHERE NOT EXISTS (SELECT 1 FROM hotels WHERE name='Sunset Resort');

INSERT INTO rooms (hotel_id, name, room_type, price_per_night, description, image_url, capacity)
SELECT h.id, 'Deluxe Queen', 'Deluxe', 8500.00, 'Spacious room with queen bed.', '/uploads/demo-room.jpg', 2
FROM hotels h
WHERE h.name='Sunset Resort'
  AND NOT EXISTS (SELECT 1 FROM rooms r WHERE r.name='Deluxe Queen' AND r.hotel_id=h.id);
