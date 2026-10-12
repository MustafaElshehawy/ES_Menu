# DineSmart deployment

## Requirements

- Node.js 20 or newer
- A PostgreSQL database
- A host that runs a persistent Node.js web service (Render, Railway, Fly.io, or a VPS)

## Local setup

1. Create a PostgreSQL database and copy its connection URL.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` and a long random `JWT_SECRET`.
3. Install dependencies and build production CSS with `npm install` and `npm run build:css`.
4. Start the app with `npm start` and open `http://localhost:3000`.

The server creates the tables in `schema.sql` on its first start. Keep `.env` private and out of source control.

## Vercel

The repository includes a catch-all Node.js function for `/api/*` and a build command for the generated stylesheet. Import the GitHub repository into Vercel and deploy it with the default **Other** framework preset.

Create a PostgreSQL database, then add these environment variables to the Vercel project for every environment you deploy:

- `DATABASE_URL`
- `JWT_SECRET` (at least 32 random characters)
- `NODE_ENV=production`
- `DATABASE_SSL=true` only if your database provider requires TLS

The schema is initialized on the first API request. After setting the variables, redeploy and verify `/api/health` returns `{"status":"ok","database":"connected"}`.

## Persistent Node.js hosting

For Render, Railway, Fly.io, or a VPS, create a PostgreSQL database and a Node web service from this project. Set the build command to `npm install && npm run build:css`, the start command to `npm start`, and the health-check path to `/api/health`. Add `DATABASE_URL`, `JWT_SECRET` (at least 32 random characters), and `NODE_ENV=production` to the service environment. Set `DATABASE_SSL=true` only if your provider requires TLS for database connections. The app listens on the host-provided `PORT`.

Serve the app and its API from the same public domain. Use HTTPS; production cookies are marked Secure. Back up PostgreSQL regularly. Product photos are currently supplied as image URLs or small uploaded logos; use object storage (S3-compatible) for larger photo libraries.

## Accounts and customer data

Each signup gets an account and an independent store. The owner check is enforced in the API; public menu pages expose only available products and public branding. Share a store using the URL generated in the dashboard. Do not expose the database URL or JWT secret in frontend files.
