# ES_Menu

Multi-store restaurant menu platform with an Arabic admin dashboard, customer-facing menus, account authentication, and PostgreSQL persistence.

## Requirements

- Node.js 20 or newer
- PostgreSQL

## Run locally

1. Copy `.env.example` to `.env` and configure `DATABASE_URL` and `JWT_SECRET`.
2. Install dependencies and build the stylesheet:

   ```sh
   npm install
   npm run build:css
   ```

3. Start the app with `npm start` and open `http://localhost:3000/admin-dashboard.html`.

## Checks

```sh
npm run check
npm test
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for hosting instructions. Keep `.env` and database credentials private.