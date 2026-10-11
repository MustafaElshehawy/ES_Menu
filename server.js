require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const { Pool } = require('pg');
const { rateLimit } = require('express-rate-limit');

const app = express();
const port = Number(process.env.PORT || 3000);
const jwtSecret = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'local-development-secret-change-before-deploy');
if (!jwtSecret) throw new Error('JWT_SECRET is required in production.');

let pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
});

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
            imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"]
        }
    },
    crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '3mb' }));

const sessionCookie = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000
};
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

function fail(status, message) {
    const error = new Error(message);
    error.status = status;
    throw error;
}

function cleanText(value, maxLength = 200) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function makeSlug(name) {
    const base = cleanText(name, 70).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'menu';
    return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

function setSession(res, user) {
    const token = jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: '7d' });
    res.cookie('dinesmart_session', token, sessionCookie);
}

async function requireAuth(req, res, next) {
    const token = req.cookies?.dinesmart_session;
    if (!token) return res.status(401).json({ error: 'سجّل الدخول للمتابعة.' });
    try {
        const payload = jwt.verify(token, jwtSecret);
        const result = await pool.query('SELECT id, name, email FROM users WHERE id = $1', [payload.sub]);
        if (!result.rowCount) return res.status(401).json({ error: 'الحساب غير موجود.' });
        req.user = result.rows[0];
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') return res.status(401).json({ error: 'انتهت الجلسة، سجّل الدخول مرة أخرى.' });
        next(error);
    }
}

app.use((req, res, next) => {
    const token = req.headers.cookie?.match(/(?:^|; )dinesmart_session=([^;]+)/)?.[1];
    req.cookies = req.cookies || {};
    if (token) req.cookies.dinesmart_session = decodeURIComponent(token);
    next();
});

async function readStore(storeRow, publicOnly = false) {
    const [categoriesResult, productsResult] = await Promise.all([
        pool.query('SELECT id, name, icon FROM categories WHERE store_id = $1 ORDER BY sort_order, id', [storeRow.id]),
        publicOnly
            ? pool.query('SELECT id, category_id, name, description, ingredients, price, calories, image, available FROM products WHERE store_id = $1 AND available = TRUE ORDER BY sort_order, id', [storeRow.id])
            : pool.query('SELECT id, category_id, name, description, ingredients, price, calories, image, available FROM products WHERE store_id = $1 ORDER BY sort_order, id', [storeRow.id])
    ]);
    return {
        id: storeRow.id,
        slug: storeRow.slug,
        profile: storeRow.profile,
        theme: storeRow.theme,
        currency: storeRow.currency,
        categories: categoriesResult.rows,
        menu: productsResult.rows.map(product => ({
            id: product.id,
            categoryId: product.category_id,
            name: product.name,
            description: product.description,
            ingredients: product.ingredients,
            price: Number(product.price),
            calories: product.calories,
            image: product.image,
            available: product.available
        }))
    };
}

async function readPlatform(userId) {
    const [storesResult, userResult] = await Promise.all([
        pool.query('SELECT id, slug, profile, theme, currency FROM stores WHERE owner_id = $1 ORDER BY created_at, id', [userId]),
        pool.query('SELECT active_store_id FROM users WHERE id = $1', [userId])
    ]);
    const stores = await Promise.all(storesResult.rows.map(row => readStore(row)));
    const savedActiveStoreId = userResult.rows[0]?.active_store_id;
    const activeStoreId = stores.some(store => store.id === savedActiveStoreId) ? savedActiveStoreId : stores[0]?.id || null;
    return { stores, activeStoreId };
}

function validatePlatformPayload(stores) {
    if (!Array.isArray(stores) || stores.length < 1 || stores.length > 100) return 'بيانات المتاجر غير صالحة.';
    const storeIds = new Set();
    const slugs = new Set();
    const categoryIds = new Set();
    const productIds = new Set();

    for (const store of stores) {
        if (!store || typeof store.id !== 'string' || typeof store.slug !== 'string' || !store.profile || !Array.isArray(store.categories) || !Array.isArray(store.menu)) return 'بيانات المتجر غير مكتملة.';
        if (storeIds.has(store.id) || slugs.has(store.slug)) return 'يوجد متجر أو رابط مكرر في الطلب.';
        storeIds.add(store.id);
        slugs.add(store.slug);
        if (store.categories.length > 200 || store.menu.length > 5000) return 'تجاوزت حدود عدد الأقسام أو المنتجات.';
        if (!/^[a-z0-9-]{1,90}$/.test(store.slug)) return 'رابط المتجر يجب أن يحتوي على أحرف إنجليزية وأرقام وشرطات فقط.';
        if (!store.profile.name || typeof store.profile.name !== 'object') return 'اسم المتجر مطلوب.';
        const theme = store.theme || {};
        if ((theme.primary && !/^#[0-9a-f]{6}$/i.test(theme.primary)) || (theme.background && !/^#[0-9a-f]{6}$/i.test(theme.background))) return 'ألوان المنيو غير صالحة.';

        const localCategoryIds = new Set();
        for (const category of store.categories) {
            if (!category || typeof category.id !== 'string' || !category.name || typeof category.name !== 'object') return 'بيانات أحد الأقسام غير صالحة.';
            if (localCategoryIds.has(category.id) || categoryIds.has(category.id)) return 'معرّف القسم مكرر.';
            localCategoryIds.add(category.id);
            categoryIds.add(category.id);
        }
        for (const product of store.menu) {
            if (!product || typeof product.id !== 'string' || !product.name || typeof product.name !== 'object') return 'بيانات أحد المنتجات غير صالحة.';
            if (productIds.has(product.id) || !Number.isFinite(Number(product.price)) || Number(product.price) < 0) return 'معرّف المنتج أو السعر غير صالح.';
            if (product.categoryId && !localCategoryIds.has(product.categoryId)) return 'القسم المختار للمنتج غير صالح.';
            const image = cleanText(product.image, 1500000);
            if (image && !/^(https?:\/\/|data:image\/)/i.test(image)) return 'رابط صورة المنتج غير صالح.';
            productIds.add(product.id);
        }
    }
    return null;
}

app.post('/api/auth/register', authLimiter, async (req, res, next) => {
    const name = cleanText(req.body.name, 80);
    const email = cleanText(req.body.email, 254).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const storeName = cleanText(req.body.storeName, 70);
    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10 || !storeName) {
        return res.status(400).json({ error: 'أكمل البيانات، واستخدم كلمة مرور لا تقل عن 10 أحرف.' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const user = { id: crypto.randomUUID(), name, email };
        const hash = await bcrypt.hash(password, 12);
        await client.query('INSERT INTO users(id, name, email, password_hash) VALUES($1, $2, $3, $4)', [user.id, name, email, hash]);
        const store = {
            id: crypto.randomUUID(),
            slug: makeSlug(storeName),
            profile: { siteName: storeName, name: { ar: storeName, en: storeName }, address: { ar: '', en: '' }, logo: '' },
            theme: { primary: '#245b49', background: '#f6f7f3' },
            currency: 'EGP'
        };
        await client.query('INSERT INTO stores(id, owner_id, slug, profile, theme, currency) VALUES($1, $2, $3, $4, $5, $6)', [store.id, user.id, store.slug, store.profile, store.theme, store.currency]);
        await client.query('UPDATE users SET active_store_id = $1 WHERE id = $2', [store.id, user.id]);
        await client.query('COMMIT');
        setSession(res, user);
        res.status(201).json({ user, platform: { stores: [{ ...store, categories: [], menu: [] }], activeStoreId: store.id } });
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') return res.status(409).json({ error: 'البريد الإلكتروني مستخدم بالفعل.' });
        next(error);
    } finally {
        client.release();
    }
});

app.post('/api/auth/login', authLimiter, async (req, res, next) => {
    const email = cleanText(req.body.email, 254).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    try {
        const result = await pool.query('SELECT id, name, email, password_hash FROM users WHERE email = $1', [email]);
        const account = result.rows[0];
        if (!account || !(await bcrypt.compare(password, account.password_hash))) return res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' });
        const user = { id: account.id, name: account.name, email: account.email };
        setSession(res, user);
        res.json({ user, platform: await readPlatform(user.id) });
    } catch (error) {
        next(error);
    }
});

app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('dinesmart_session', { ...sessionCookie, maxAge: undefined });
    res.json({ loggedOut: true });
});

app.get('/api/auth/me', requireAuth, async (req, res, next) => {
    try { res.json({ user: req.user, platform: await readPlatform(req.user.id) }); }
    catch (error) { next(error); }
});

app.put('/api/platform', requireAuth, async (req, res, next) => {
    const stores = req.body?.stores;
    const validationError = validatePlatformPayload(stores);
    if (validationError) return res.status(400).json({ error: validationError });

    try {
        for (const store of stores) {
            const existingId = await pool.query('SELECT owner_id FROM stores WHERE id = $1', [store.id]);
            if (existingId.rowCount && existingId.rows[0].owner_id !== req.user.id) return res.status(403).json({ error: 'غير مسموح بتعديل هذا المتجر.' });
            const existingSlug = await pool.query('SELECT id FROM stores WHERE slug = $1', [store.slug]);
            if (existingSlug.rowCount && existingSlug.rows[0].id !== store.id) return res.status(409).json({ error: 'رابط المتجر مستخدم بالفعل، غيّر اسم الرابط.' });
        }
    } catch (error) {
        return next(error);
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const owned = await client.query('SELECT id FROM stores WHERE owner_id = $1', [req.user.id]);
        const ownedIds = new Set(owned.rows.map(row => row.id));
        for (const store of stores) {
            if (!store || typeof store.id !== 'string' || typeof store.slug !== 'string' || !store.profile || !Array.isArray(store.categories) || !Array.isArray(store.menu)) fail(400, 'بيانات المتجر غير مكتملة.');
            if (store.categories.length > 200 || store.menu.length > 5000) fail(400, 'تجاوزت حدود عدد الأقسام أو المنتجات.');
            if (!/^[a-z0-9-]{1,90}$/.test(store.slug)) fail(400, 'رابط المتجر يجب أن يحتوي على أحرف إنجليزية وأرقام وشرطات فقط.');
            if (!store.profile.name || typeof store.profile.name !== 'object') fail(400, 'اسم المتجر مطلوب.');
            const theme = store.theme || {};
            if (theme.primary && !/^#[0-9a-f]{6}$/i.test(theme.primary)) fail(400, 'اللون الأساسي غير صالح.');
            if (theme.background && !/^#[0-9a-f]{6}$/i.test(theme.background)) fail(400, 'لون الخلفية غير صالح.');
            if (ownedIds.has(store.id)) {
                const updated = await client.query(
                    'UPDATE stores SET slug=$1, profile=$2, theme=$3, currency=$4, updated_at=NOW() WHERE id=$5 AND owner_id=$6 RETURNING id',
                    [cleanText(store.slug, 90), store.profile, store.theme || {}, cleanText(store.currency, 4) || 'SAR', store.id, req.user.id]
                );
                if (!updated.rowCount) fail(403, 'غير مسموح بتعديل هذا المتجر.');
            } else {
                await client.query(
                    'INSERT INTO stores(id, owner_id, slug, profile, theme, currency) VALUES($1, $2, $3, $4, $5, $6)',
                    [store.id, req.user.id, cleanText(store.slug, 90), store.profile, store.theme || {}, cleanText(store.currency, 4) || 'SAR']
                );
                ownedIds.add(store.id);
            }
            await client.query('DELETE FROM products WHERE store_id = $1', [store.id]);
            await client.query('DELETE FROM categories WHERE store_id = $1', [store.id]);
            const categoryIds = new Set();
            for (const [index, category] of store.categories.entries()) {
                if (!category || typeof category.id !== 'string' || !category.name) fail(400, 'بيانات أحد الأقسام غير صالحة.');
                categoryIds.add(category.id);
                await client.query('INSERT INTO categories(id, store_id, name, icon, sort_order) VALUES($1, $2, $3, $4, $5)', [category.id, store.id, category.name, cleanText(category.icon, 12) || '🍽️', index]);
            }
            for (const [index, product] of store.menu.entries()) {
                if (!product || typeof product.id !== 'string' || !product.name || !Number.isFinite(Number(product.price)) || Number(product.price) < 0) fail(400, 'بيانات أحد المنتجات غير صالحة.');
                const image = cleanText(product.image, 1500000);
                if (image && !/^(https?:\/\/|data:image\/)/i.test(image)) fail(400, 'رابط صورة المنتج غير صالح.');
                const categoryId = categoryIds.has(product.categoryId) ? product.categoryId : null;
                await client.query(
                    'INSERT INTO products(id, store_id, category_id, name, description, ingredients, price, calories, image, available, sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
                    [product.id, store.id, categoryId, product.name, product.description || {}, product.ingredients || {}, Number(product.price), Math.max(0, Number(product.calories) || 0), image, product.available !== false, index]
                );
            }
        }
        const selectedStore = stores.find(store => store.id === req.body.activeStoreId) || stores[0];
        await client.query('UPDATE users SET active_store_id = $1 WHERE id = $2', [selectedStore.id, req.user.id]);
        await client.query('COMMIT');
        res.json(await readPlatform(req.user.id));
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        if (error.code === '23505') return res.status(409).json({ error: 'المتجر أو أحد عناصره موجود بالفعل.' });
        if (error.code === '23503') return res.status(400).json({ error: 'القسم المحدد غير صالح.' });
        next(error);
    } finally {
        client?.release();
    }
});

app.get('/api/public/:slug', async (req, res, next) => {
    try {
        const result = await pool.query('SELECT id, slug, profile, theme, currency FROM stores WHERE slug = $1', [cleanText(req.params.slug, 90)]);
        if (!result.rowCount) return res.status(404).json({ error: 'المنيو غير موجود.' });
        res.set('Cache-Control', 'no-store');
        res.json(await readStore(result.rows[0], true));
    } catch (error) {
        next(error);
    }
});

app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', database: 'connected' });
    } catch {
        res.status(503).json({ status: 'error', database: 'unavailable' });
    }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'المسار غير موجود.' }));
app.use((req, res, next) => {
    const blockedFiles = new Set([
        '/server.js', '/schema.sql', '/package.json', '/package-lock.json', '/.env.example',
        '/.gitignore', '/.npmrc', '/DEPLOYMENT.md', '/tailwind.config.js', '/tailwind.input.css'
    ]);
    if (blockedFiles.has(req.path) || req.path.startsWith('/.env') || req.path.startsWith('/tests/') || req.path.startsWith('/node_modules/')) return res.sendStatus(404);
    next();
});
app.use(express.static(__dirname, { extensions: ['html'], dotfiles: 'deny' }));
app.use((error, req, res, next) => {
    console.error(error);
    if (res.headersSent) return next(error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'حصل خطأ غير متوقع. حاول مرة ثانية.' });
});

async function start() {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Copy .env.example to .env and set it.');
    await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    const server = app.listen(port, '0.0.0.0', () => console.log(`DineSmart listening on port ${port}`));
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.on(signal, () => server.close(() => pool.end().finally(() => process.exit(0))));
    }
}

if (require.main === module) {
    start().catch(error => {
        console.error('Unable to start DineSmart:', error);
        process.exit(1);
    });
}

module.exports = {
    app,
    start,
    setDatabasePool(databasePool) {
        pool = databasePool;
    }
};
