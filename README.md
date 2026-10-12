# DineSmart

Multi-store restaurant menus with an Arabic admin dashboard, customer-facing menus, account authentication, and SQL Server persistence. The application backend is ASP.NET Core MVC on .NET 10; the existing HTML, CSS, and JavaScript frontend is served by the MVC app.

## Requirements

- .NET 10 SDK
- SQL Server 2019 or newer

## Run locally

1. Create the database if needed:

   ```powershell
   sqlcmd -S localhost -E -Q "IF DB_ID(N'DineSmart') IS NULL CREATE DATABASE [DineSmart]"
   ```

2. Set `ConnectionStrings__Default` if your SQL Server is not the local Windows-authenticated instance.
3. Run the app:

   ```powershell
   dotnet run --project DineSmart.Mvc
   ```

The app creates its tables on startup. Open `https://localhost:7276/admin-dashboard.html`; accept or trust the local .NET development certificate if prompted. API health is available at `/api/health`.

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md). Vercel does not run this ASP.NET Core server; deploy the included Docker image to a .NET-compatible host and provide a SQL Server connection string.

The original Node.js files remain in the repository for now, but the supported application entry point is `DineSmart.Mvc`.