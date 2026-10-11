const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { newDb } = require('pg-mem');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-secret-that-is-long-enough';
const { app, setDatabasePool } = require('../server');

const memoryDb = newDb({ autoCreateForeignKeyIndices: true });
const { Pool } = memoryDb.adapters.createPg();
const pool = new Pool();
setDatabasePool(pool);

async function applySchema() {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    for (const statement of schema.split(';').map(part => part.trim()).filter(Boolean)) {
        await pool.query(statement);
    }
}

function storePayload(store, suffix = 'first') {
    return {
        ...store,
        profile: { siteName: 'مطعم الاختبار', name: { ar: 'مطعم الاختبار', en: 'Test Restaurant' }, address: { ar: 'القاهرة', en: 'Cairo' }, logo: '' },
        theme: { primary: '#245b49', background: '#f6f7f3' },
        currency: 'EGP',
        categories: [{ id: `category-${suffix}`, name: { ar: 'أطباق رئيسية', en: 'Mains' }, icon: '🍲' }],
        menu: [
            { id: `product-${suffix}`, categoryId: `category-${suffix}`, name: { ar: 'طبق متاح', en: 'Available dish' }, description: { ar: 'وصف', en: 'Description' }, ingredients: { ar: 'مكونات', en: 'Ingredients' }, price: 125.5, calories: 300, image: 'https://example.com/dish.jpg', available: true },
            { id: `hidden-${suffix}`, categoryId: `category-${suffix}`, name: { ar: 'طبق مخفي', en: 'Hidden dish' }, description: { ar: '', en: '' }, ingredients: { ar: '', en: '' }, price: 60, calories: 0, image: '', available: false }
        ]
    };
}

test('API auth, tenant isolation, persistence, public menu and static security', async t => {
    await applySchema();
    t.after(async () => pool.end());

    const health = await request(app).get('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.database, 'connected');

    const unauthenticated = await request(app).get('/api/auth/me');
    assert.equal(unauthenticated.status, 401);

    const alice = request.agent(app);
    const invalidRegistration = await alice.post('/api/auth/register').send({ name: 'A', email: 'bad', password: 'short', storeName: '' });
    assert.equal(invalidRegistration.status, 400);

    const registration = await alice.post('/api/auth/register').send({
        name: 'Alice Owner', email: 'ALICE@example.test', password: 'a-very-secure-password', storeName: 'Test Restaurant'
    });
    assert.equal(registration.status, 201);
    assert.equal(registration.headers['set-cookie'][0].toLowerCase().includes('httponly'), true);
    assert.equal(registration.body.user.email, 'alice@example.test');
    assert.equal(Object.hasOwn(registration.body.user, 'password_hash'), false);
    assert.equal(registration.body.platform.stores.length, 1);
    const aliceStore = registration.body.platform.stores[0];
    assert.equal(registration.body.platform.activeStoreId, aliceStore.id);

    const duplicate = await request(app).post('/api/auth/register').send({
        name: 'Alice Again', email: 'alice@example.test', password: 'a-very-secure-password', storeName: 'Another'
    });
    assert.equal(duplicate.status, 409);

    const aliceSession = await alice.get('/api/auth/me');
    assert.equal(aliceSession.status, 200);
    assert.equal(aliceSession.body.user.email, 'alice@example.test');

    const firstStore = storePayload(aliceStore, 'alice');
    const secondStore = {
        id: 'store-alice-second', slug: 'alice-second-shop',
        profile: { siteName: 'فرع ثاني', name: { ar: 'فرع ثاني', en: 'Second Shop' }, address: { ar: '', en: '' }, logo: '' },
        theme: { primary: '#2563eb', background: '#f8fafc' }, currency: 'SAR', categories: [], menu: []
    };
    const savedPlatform = await alice.put('/api/platform').send({ stores: [firstStore, secondStore], activeStoreId: secondStore.id });
    assert.equal(savedPlatform.status, 200);
    assert.equal(savedPlatform.body.stores.length, 2);
    assert.equal(savedPlatform.body.activeStoreId, secondStore.id);

    const reopenedSession = await alice.get('/api/auth/me');
    assert.equal(reopenedSession.body.platform.activeStoreId, secondStore.id);
    assert.equal(reopenedSession.body.platform.stores.find(store => store.id === firstStore.id).menu.length, 2);

    const publicMenu = await request(app).get(`/api/public/${firstStore.slug}`);
    assert.equal(publicMenu.status, 200);
    assert.equal(publicMenu.body.menu.length, 1);
    assert.equal(publicMenu.body.menu[0].name.ar, 'طبق متاح');
    assert.equal(publicMenu.body.menu[0].price, 125.5);
    assert.equal(publicMenu.body.categories.length, 1);
    assert.equal(publicMenu.headers['cache-control'], 'no-store');

    const badPrice = { ...firstStore, menu: [{ ...firstStore.menu[0], price: -1 }] };
    const rejectedProduct = await alice.put('/api/platform').send({ stores: [badPrice, secondStore], activeStoreId: firstStore.id });
    assert.equal(rejectedProduct.status, 400);
    const unchangedPublicMenu = await request(app).get(`/api/public/${firstStore.slug}`);
    assert.equal(unchangedPublicMenu.body.menu[0].price, 125.5);

    const bob = request.agent(app);
    const bobRegistration = await bob.post('/api/auth/register').send({
        name: 'Bob Owner', email: 'bob@example.test', password: 'another-secure-password', storeName: 'Bob Cafe'
    });
    assert.equal(bobRegistration.status, 201);
    assert.equal(bobRegistration.body.platform.stores.length, 1);
    const bobStore = bobRegistration.body.platform.stores[0];
    assert.notEqual(bobStore.id, aliceStore.id);
    assert.notEqual(bobStore.slug, aliceStore.slug);

    const crossTenantWrite = await bob.put('/api/platform').send({
        stores: [bobStore, firstStore], activeStoreId: bobStore.id
    });
    assert.equal(crossTenantWrite.status, 403);
    const bobOwnData = await bob.get('/api/auth/me');
    assert.deepEqual(bobOwnData.body.platform.stores.map(store => store.id), [bobStore.id]);
    const aliceStillOwnsData = await alice.get('/api/auth/me');
    assert.equal(aliceStillOwnsData.body.platform.stores.length, 2);

    const invalidSlug = { ...firstStore, slug: 'unsafe/slug' };
    const rejectedSlug = await alice.put('/api/platform').send({ stores: [invalidSlug, secondStore], activeStoreId: firstStore.id });
    assert.equal(rejectedSlug.status, 400);

    const wrongLogin = await request(app).post('/api/auth/login').send({ email: 'alice@example.test', password: 'not-the-password' });
    assert.equal(wrongLogin.status, 401);
    const logout = await alice.post('/api/auth/logout');
    assert.equal(logout.status, 200);
    assert.equal(logout.body.loggedOut, true);
    assert.equal((await alice.get('/api/auth/me')).status, 401);
    const login = await alice.post('/api/auth/login').send({ email: 'alice@example.test', password: 'a-very-secure-password' });
    assert.equal(login.status, 200);
    assert.equal(login.body.platform.activeStoreId, secondStore.id);

    assert.equal((await request(app).get('/admin-dashboard.html')).status, 200);
    assert.equal((await request(app).get('/server.js')).status, 404);
    assert.equal((await request(app).get('/package.json')).status, 404);
    assert.equal((await request(app).get('/tests/api.test.js')).status, 404);
    assert.equal((await request(app).get('/tailwind.config.js')).status, 404);
    assert.equal((await request(app).get('/node_modules/express/package.json')).status, 404);
});
