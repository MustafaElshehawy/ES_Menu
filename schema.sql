CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    active_store_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS active_store_id TEXT;

CREATE TABLE IF NOT EXISTS stores (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug TEXT NOT NULL UNIQUE,
    profile JSONB NOT NULL DEFAULT '{}'::jsonb,
    theme JSONB NOT NULL DEFAULT '{"primary":"#2563eb","background":"#f8fafc"}'::jsonb,
    currency TEXT NOT NULL DEFAULT 'SAR',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS stores_owner_id_idx ON stores(owner_id);

CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name JSONB NOT NULL,
    icon TEXT NOT NULL DEFAULT '🍽️',
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS categories_store_id_idx ON categories(store_id);

CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
    name JSONB NOT NULL,
    description JSONB NOT NULL DEFAULT '{}'::jsonb,
    ingredients JSONB NOT NULL DEFAULT '{}'::jsonb,
    price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
    calories INTEGER NOT NULL DEFAULT 0 CHECK (calories >= 0),
    image TEXT NOT NULL DEFAULT '',
    available BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS products_store_id_idx ON products(store_id);
CREATE INDEX IF NOT EXISTS products_category_id_idx ON products(category_id);
