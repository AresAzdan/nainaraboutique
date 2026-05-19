-- ------------------------------------------------------------
-- E-Commerce API - Full Database Schema
-- Run this file to set up the database:
--   psql -U postgres -d ecommerce_db -f schema.sql
-- ------------------------------------------------------------

-- Drop tables in reverse dependency order (for clean resets)
DROP TABLE IF EXISTS promo_code_uses   CASCADE;
DROP TABLE IF EXISTS promo_codes       CASCADE;
DROP TABLE IF EXISTS user_addresses    CASCADE;
DROP TABLE IF EXISTS order_items       CASCADE;
DROP TABLE IF EXISTS orders            CASCADE;
DROP TABLE IF EXISTS cart_items        CASCADE;
DROP TABLE IF EXISTS carts             CASCADE;
DROP TABLE IF EXISTS discounts         CASCADE;
DROP TABLE IF EXISTS size_guides       CASCADE;
DROP TABLE IF EXISTS products          CASCADE;
DROP TABLE IF EXISTS categories        CASCADE;
DROP TABLE IF EXISTS users             CASCADE;

-- -------------------------
-- USERS
-- -------------------------
CREATE TABLE users (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100)        NOT NULL,
  email      VARCHAR(150)        UNIQUE NOT NULL,
  password   TEXT                NOT NULL,
  phone      VARCHAR(20),
  role       VARCHAR(20)         NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

-- -------------------------
-- USER ADDRESSES
-- -------------------------
CREATE TABLE user_addresses (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label          VARCHAR(50)  NOT NULL DEFAULT 'Home',
  recipient_name VARCHAR(100) NOT NULL,
  phone          VARCHAR(20),
  address        TEXT         NOT NULL,
  province_id    VARCHAR(20),
  province_name  VARCHAR(100),
  city_id        VARCHAR(20),
  city_name      VARCHAR(100),
  district_id    VARCHAR(20),
  district_name  VARCHAR(100),
  postal_code    VARCHAR(10),
  is_default     BOOLEAN      NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- -------------------------
-- CATEGORIES
-- -------------------------
CREATE TABLE categories (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) UNIQUE NOT NULL
);

-- -------------------------
-- PRODUCTS
-- -------------------------
CREATE TABLE products (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(200)   NOT NULL,
  description TEXT,
  price       NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  stock       INTEGER        NOT NULL DEFAULT 0 CHECK (stock >= 0),
  image_url   TEXT,
  category_id INTEGER        REFERENCES categories(id) ON DELETE SET NULL,
  size_guide_id INTEGER,
  size_guide_data JSONB,
  created_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- -------------------------
-- REUSABLE SIZE GUIDES
-- -------------------------
CREATE TABLE size_guides (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(120) NOT NULL,
  columns    JSONB        NOT NULL DEFAULT '[]'::jsonb,
  rows       JSONB        NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE products
  ADD CONSTRAINT products_size_guide_id_fkey
  FOREIGN KEY (size_guide_id) REFERENCES size_guides(id) ON DELETE SET NULL;

-- -------------------------
-- CARTS
-- -------------------------
CREATE TABLE carts (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE cart_items (
  id         SERIAL PRIMARY KEY,
  cart_id    INTEGER     NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id INTEGER     NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity   INTEGER     NOT NULL DEFAULT 1 CHECK (quantity > 0),
  UNIQUE(cart_id, product_id)
);

-- -------------------------
-- ORDERS
-- -------------------------
CREATE TABLE orders (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  total_amount     NUMERIC(10, 2) NOT NULL CHECK (total_amount >= 0),
  shipping_cost    NUMERIC(10, 2) NOT NULL DEFAULT 0,
  discount_amount  NUMERIC(10, 2) NOT NULL DEFAULT 0,
  promo_code       VARCHAR(50),
  shipping_address TEXT,
  shipping_method  VARCHAR(100),
  recipient_name   VARCHAR(100),
  phone            VARCHAR(20),
  tracking_number  VARCHAR(100),
  tracking_courier VARCHAR(50),
  status           VARCHAR(30)    NOT NULL DEFAULT 'pending'
                   CHECK (status IN (
                     'pending', 'paid', 'processing',
                     'shipped', 'completed', 'cancelled',
                     'return_requested', 'returned'
                   )),
  return_reason    TEXT,
  delivered_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE TABLE order_items (
  id         SERIAL PRIMARY KEY,
  order_id   INTEGER        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER        NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity   INTEGER        NOT NULL CHECK (quantity > 0),
  price      NUMERIC(10, 2) NOT NULL CHECK (price >= 0)
);

-- -------------------------
-- DISCOUNTS
-- -------------------------
CREATE TABLE discounts (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(150)   NOT NULL,
  percentage NUMERIC(5, 2)  NOT NULL CHECK (percentage > 0 AND percentage <= 100),
  start_date DATE           NOT NULL,
  end_date   DATE           NOT NULL,
  start_time TIME           NOT NULL DEFAULT '00:00:00',
  end_time   TIME           NOT NULL DEFAULT '23:59:59',
  CHECK (end_date >= start_date)
);

-- -------------------------
-- PROMO CODES
-- -------------------------
CREATE TABLE promo_codes (
  id                SERIAL PRIMARY KEY,
  code              VARCHAR(50)    UNIQUE NOT NULL,
  discount_pct      NUMERIC(5, 2)  NOT NULL CHECK (discount_pct > 0 AND discount_pct <= 100),
  applies_to_all    BOOLEAN        NOT NULL DEFAULT true,
  product_id        INTEGER        REFERENCES products(id) ON DELETE SET NULL,
  max_uses          INTEGER        NOT NULL DEFAULT 100,
  max_uses_per_user INTEGER        NOT NULL DEFAULT 1,
  used_count        INTEGER        NOT NULL DEFAULT 0,
  is_active         BOOLEAN        NOT NULL DEFAULT true,
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE TABLE promo_code_uses (
  id         SERIAL PRIMARY KEY,
  promo_id   INTEGER     NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  used_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -------------------------
-- SEED: Default Admin User
-- Password: admin123  (bcrypt hash)
-- -------------------------
INSERT INTO users (name, email, password, role) VALUES (
  'Admin',
  'admin@example.com',
  '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
  'admin'
);

-- Sample categories
INSERT INTO categories (name) VALUES ('Electronics'), ('Clothing'), ('Books'), ('Home & Garden');
