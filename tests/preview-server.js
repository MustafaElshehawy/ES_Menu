const fs = require('node:fs');
const path = require('node:path');
const { newDb } = require('pg-mem');
const { app, setDatabasePool } = require('../server');

async function startPreview() {
    const database = newDb({ autoCreateForeignKeyIndices: true });
    const { Pool } = database.adapters.createPg();
    const pool = new Pool();
    setDatabasePool(pool);
    const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    for (const statement of schema.split(';').map(part => part.trim()).filter(Boolean)) await pool.query(statement);
    const port = Number(process.env.PORT || 4173);
    const server = app.listen(port, '127.0.0.1', () => console.log(`Test preview available at http://127.0.0.1:${port}`));
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.on(signal, () => server.close(() => pool.end().finally(() => process.exit(0))));
    }
}

startPreview().catch(error => {
    console.error('Unable to start test preview:', error);
    process.exit(1);
});
