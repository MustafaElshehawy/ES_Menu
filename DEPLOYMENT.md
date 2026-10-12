# DineSmart deployment

## Requirements

- .NET 10 runtime
- SQL Server 2019 or newer
- A host that supports ASP.NET Core or Docker, such as Azure App Service or a container service

Vercel does not host this ASP.NET Core application. The prior Vercel deployment must be replaced with a .NET-compatible host; the frontend and API are served together by the MVC app.

## SQL Server

Create a SQL Server database named `DineSmart` (or choose another name in the connection string). On application startup, the app creates the tables from `DineSmart.Mvc/Database/schema.sql`. The application identity needs permission to create these tables on first startup.

Configure `ConnectionStrings__Default` in the host's environment. For Azure SQL, use a SQL-authenticated connection string with encryption enabled, for example:

```text
Server=tcp:<server>.database.windows.net,1433;Initial Catalog=DineSmart;Persist Security Info=False;User ID=<user>;Password=<password>;MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;
```

Never commit production credentials. Use the host's secret/environment-variable settings.

## Docker deployment

From the repository root, build and run the application:

```sh
docker build -f DineSmart.Mvc/Dockerfile -t dinesmart .
docker run --rm -p 8080:8080 -e ConnectionStrings__Default="<sql-server-connection-string>" dinesmart
```

Configure the same connection string in the hosting service, expose port `8080`, and use `/api/health` as the health-check path. Serve the app over HTTPS so its authentication cookie remains secure.

## Data migration

This version creates a new SQL Server schema; it does not automatically copy accounts or menu data from the previous PostgreSQL database. Export and transform existing records before switching traffic if existing customer data must be retained. Password hashes from the old system are not compatible with the new PBKDF2 format, so users must register new accounts unless a dedicated credential migration is performed.

Each new account receives an independent store. The API checks store ownership, and public menu responses include available products only. Back up SQL Server regularly.
