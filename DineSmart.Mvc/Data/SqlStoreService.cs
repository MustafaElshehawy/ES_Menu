using System.Data;
using System.Text.Json;
using DineSmart.Mvc.Models;
using Microsoft.Data.SqlClient;

namespace DineSmart.Mvc.Data;

public sealed class StoreConflictException(int statusCode, string message) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}

public sealed class SqlStoreService(IConfiguration configuration, IWebHostEnvironment environment)
{
    private readonly string _connectionString = configuration.GetConnectionString("Default")
        ?? throw new InvalidOperationException("ConnectionStrings:Default must be configured.");

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        var schemaPath = Path.Combine(environment.ContentRootPath, "Database", "schema.sql");
        var schema = await File.ReadAllTextAsync(schemaPath, cancellationToken);
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = new SqlCommand(schema, connection);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<bool> IsHealthyAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = new SqlCommand("SELECT 1", connection);
        return Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken)) == 1;
    }

    public async Task<AccountRecord?> FindAccountByEmailAsync(string email, CancellationToken cancellationToken = default)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = new SqlCommand("SELECT Id, Name, Email, PasswordHash FROM dbo.Users WHERE Email = @Email", connection);
        AddString(command, "@Email", email, 254);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? new AccountRecord(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3))
            : null;
    }

    public async Task<UserDto?> FindUserByIdAsync(string id, CancellationToken cancellationToken = default)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = new SqlCommand("SELECT Id, Name, Email FROM dbo.Users WHERE Id = @Id", connection);
        AddString(command, "@Id", id, 80);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? new UserDto(reader.GetString(0), reader.GetString(1), reader.GetString(2))
            : null;
    }

    public async Task CreateAccountAsync(UserDto user, string passwordHash, StoreDto store, CancellationToken cancellationToken = default)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            await using (var command = new SqlCommand(
                "INSERT INTO dbo.Users (Id, Name, Email, PasswordHash) VALUES (@Id, @Name, @Email, @PasswordHash)", connection, transaction))
            {
                AddString(command, "@Id", user.Id, 80);
                AddString(command, "@Name", user.Name, 80);
                AddString(command, "@Email", user.Email, 254);
                AddString(command, "@PasswordHash", passwordHash, 200);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await using (var command = new SqlCommand(
                "INSERT INTO dbo.Stores (Id, OwnerId, Slug, Profile, Theme, Currency) VALUES (@Id, @OwnerId, @Slug, @Profile, @Theme, @Currency)", connection, transaction))
            {
                AddStoreParameters(command, store);
                AddString(command, "@OwnerId", user.Id, 80);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await using (var command = new SqlCommand("UPDATE dbo.Users SET ActiveStoreId = @StoreId WHERE Id = @UserId", connection, transaction))
            {
                AddString(command, "@StoreId", store.Id, 80);
                AddString(command, "@UserId", user.Id, 80);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<PlatformDto> ReadPlatformAsync(string userId, CancellationToken cancellationToken = default)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        var stores = new List<StoreDto>();
        await using (var command = new SqlCommand(
            "SELECT Id, Slug, Profile, Theme, Currency FROM dbo.Stores WHERE OwnerId = @OwnerId ORDER BY CreatedAt, Id", connection))
        {
            AddString(command, "@OwnerId", userId, 80);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                stores.Add(new StoreDto
                {
                    Id = reader.GetString(0),
                    Slug = reader.GetString(1),
                    Profile = ParseJson(reader.GetString(2)),
                    Theme = ParseJson(reader.GetString(3)),
                    Currency = reader.GetString(4)
                });
            }
        }

        foreach (var store in stores)
        {
            await ReadStoreItemsAsync(connection, store, publicOnly: false, cancellationToken);
        }

        string? savedActiveStoreId;
        await using (var command = new SqlCommand("SELECT ActiveStoreId FROM dbo.Users WHERE Id = @Id", connection))
        {
            AddString(command, "@Id", userId, 80);
            savedActiveStoreId = (string?)await command.ExecuteScalarAsync(cancellationToken);
        }

        var activeStoreId = stores.Any(store => store.Id == savedActiveStoreId)
            ? savedActiveStoreId
            : stores.FirstOrDefault()?.Id;
        return new PlatformDto(stores, activeStoreId);
    }

    public async Task<StoreDto?> ReadPublicStoreAsync(string slug, CancellationToken cancellationToken = default)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        StoreDto? store;
        await using (var command = new SqlCommand(
            "SELECT Id, Slug, Profile, Theme, Currency FROM dbo.Stores WHERE Slug = @Slug", connection))
        {
            AddString(command, "@Slug", slug, 90);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            store = await reader.ReadAsync(cancellationToken)
                ? new StoreDto
                {
                    Id = reader.GetString(0),
                    Slug = reader.GetString(1),
                    Profile = ParseJson(reader.GetString(2)),
                    Theme = ParseJson(reader.GetString(3)),
                    Currency = reader.GetString(4)
                }
                : null;
        }

        if (store is not null)
        {
            await ReadStoreItemsAsync(connection, store, publicOnly: true, cancellationToken);
        }
        return store;
    }

    public async Task SavePlatformAsync(string userId, IReadOnlyList<StoreDto> stores, string activeStoreId, CancellationToken cancellationToken = default)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);

        foreach (var store in stores)
        {
            await using (var command = new SqlCommand("SELECT OwnerId FROM dbo.Stores WHERE Id = @Id", connection, transaction))
            {
                AddString(command, "@Id", store.Id, 80);
                var existingOwner = (string?)await command.ExecuteScalarAsync(cancellationToken);
                if (existingOwner is not null && existingOwner != userId)
                {
                    throw new StoreConflictException(403, "غير مسموح بتعديل هذا المتجر.");
                }
            }

            await using (var command = new SqlCommand("SELECT Id FROM dbo.Stores WHERE Slug = @Slug", connection, transaction))
            {
                AddString(command, "@Slug", store.Slug, 90);
                var existingId = (string?)await command.ExecuteScalarAsync(cancellationToken);
                if (existingId is not null && existingId != store.Id)
                {
                    throw new StoreConflictException(409, "رابط المتجر مستخدم بالفعل، غيّر اسم الرابط.");
                }
            }

            var owned = await IsStoreOwnedAsync(connection, transaction, store.Id, userId, cancellationToken);
            var sql = owned
                ? "UPDATE dbo.Stores SET Slug=@Slug, Profile=@Profile, Theme=@Theme, Currency=@Currency, UpdatedAt=SYSUTCDATETIME() WHERE Id=@Id AND OwnerId=@OwnerId"
                : "INSERT INTO dbo.Stores (Id, OwnerId, Slug, Profile, Theme, Currency) VALUES (@Id, @OwnerId, @Slug, @Profile, @Theme, @Currency)";
            await using (var command = new SqlCommand(sql, connection, transaction))
            {
                AddStoreParameters(command, store);
                AddString(command, "@OwnerId", userId, 80);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await using (var command = new SqlCommand("DELETE FROM dbo.Products WHERE StoreId = @StoreId; DELETE FROM dbo.Categories WHERE StoreId = @StoreId;", connection, transaction))
            {
                AddString(command, "@StoreId", store.Id, 80);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            for (var index = 0; index < store.Categories.Count; index++)
            {
                var category = store.Categories[index];
                await using var command = new SqlCommand(
                    "INSERT INTO dbo.Categories (Id, StoreId, Name, Icon, Image, SortOrder) VALUES (@Id, @StoreId, @Name, @Icon, @Image, @SortOrder)", connection, transaction);
                AddString(command, "@Id", category.Id, 80);
                AddString(command, "@StoreId", store.Id, 80);
                AddJson(command, "@Name", category.Name);
                AddString(command, "@Icon", CleanText(category.Icon, 12) is { Length: > 0 } icon ? icon : "🍽️", 12);
                AddString(command, "@Image", CleanText(category.Image, 1_500_000), -1);
                command.Parameters.Add("@SortOrder", SqlDbType.Int).Value = index;
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            for (var index = 0; index < store.Menu.Count; index++)
            {
                var product = store.Menu[index];
                await using var command = new SqlCommand(
                    "INSERT INTO dbo.Products (Id, StoreId, CategoryId, Name, Description, Ingredients, Price, Calories, Image, Available, SortOrder) VALUES (@Id, @StoreId, @CategoryId, @Name, @Description, @Ingredients, @Price, @Calories, @Image, @Available, @SortOrder)", connection, transaction);
                AddString(command, "@Id", product.Id, 80);
                AddString(command, "@StoreId", store.Id, 80);
                AddString(command, "@CategoryId", product.CategoryId, 80);
                AddJson(command, "@Name", product.Name);
                AddJson(command, "@Description", product.Description);
                AddJson(command, "@Ingredients", product.Ingredients);
                var price = command.Parameters.Add("@Price", SqlDbType.Decimal);
                price.Precision = 12;
                price.Scale = 2;
                price.Value = product.Price;
                command.Parameters.Add("@Calories", SqlDbType.Int).Value = Math.Max(product.Calories, 0);
                AddString(command, "@Image", CleanText(product.Image, 1_500_000), -1);
                command.Parameters.Add("@Available", SqlDbType.Bit).Value = product.Available;
                command.Parameters.Add("@SortOrder", SqlDbType.Int).Value = index;
                await command.ExecuteNonQueryAsync(cancellationToken);
            }
        }

        await using (var command = new SqlCommand("UPDATE dbo.Users SET ActiveStoreId = @StoreId WHERE Id = @UserId", connection, transaction))
        {
            AddString(command, "@StoreId", activeStoreId, 80);
            AddString(command, "@UserId", userId, 80);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
    }

    private static async Task ReadStoreItemsAsync(SqlConnection connection, StoreDto store, bool publicOnly, CancellationToken cancellationToken)
    {
        await using (var command = new SqlCommand(
            "SELECT Id, Name, Icon, Image FROM dbo.Categories WHERE StoreId = @StoreId ORDER BY SortOrder, Id", connection))
        {
            AddString(command, "@StoreId", store.Id, 80);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                store.Categories.Add(new CategoryDto
                {
                    Id = reader.GetString(0),
                    Name = ParseJson(reader.GetString(1)),
                    Icon = reader.GetString(2),
                    Image = reader.GetString(3)
                });
            }
        }

        var productQuery = publicOnly
            ? "SELECT Id, CategoryId, Name, Description, Ingredients, Price, Calories, Image, Available FROM dbo.Products WHERE StoreId = @StoreId AND Available = 1 ORDER BY SortOrder, Id"
            : "SELECT Id, CategoryId, Name, Description, Ingredients, Price, Calories, Image, Available FROM dbo.Products WHERE StoreId = @StoreId ORDER BY SortOrder, Id";
        await using (var command = new SqlCommand(productQuery, connection))
        {
            AddString(command, "@StoreId", store.Id, 80);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                store.Menu.Add(new ProductDto
                {
                    Id = reader.GetString(0),
                    CategoryId = reader.IsDBNull(1) ? null : reader.GetString(1),
                    Name = ParseJson(reader.GetString(2)),
                    Description = ParseJson(reader.GetString(3)),
                    Ingredients = ParseJson(reader.GetString(4)),
                    Price = reader.GetDecimal(5),
                    Calories = reader.GetInt32(6),
                    Image = reader.GetString(7),
                    Available = reader.GetBoolean(8)
                });
            }
        }
    }

    private static async Task<bool> IsStoreOwnedAsync(SqlConnection connection, SqlTransaction transaction, string storeId, string userId, CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand("SELECT COUNT(1) FROM dbo.Stores WHERE Id=@Id AND OwnerId=@OwnerId", connection, transaction);
        AddString(command, "@Id", storeId, 80);
        AddString(command, "@OwnerId", userId, 80);
        return Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken)) > 0;
    }

    private async Task<SqlConnection> OpenConnectionAsync(CancellationToken cancellationToken)
    {
        var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        return connection;
    }

    private static void AddStoreParameters(SqlCommand command, StoreDto store)
    {
        AddString(command, "@Id", store.Id, 80);
        AddString(command, "@Slug", store.Slug, 90);
        AddJson(command, "@Profile", store.Profile);
        AddJson(command, "@Theme", store.Theme);
        AddString(command, "@Currency", CleanText(store.Currency, 4) is { Length: > 0 } currency ? currency : "SAR", 4);
    }

    private static void AddString(SqlCommand command, string name, string? value, int size)
    {
        command.Parameters.Add(name, SqlDbType.NVarChar, size).Value = (object?)value ?? DBNull.Value;
    }

    private static void AddJson(SqlCommand command, string name, JsonElement value)
    {
        command.Parameters.Add(name, SqlDbType.NVarChar, -1).Value = JsonSerializer.Serialize(value);
    }

    private static JsonElement ParseJson(string value) => JsonDocument.Parse(value).RootElement.Clone();

    private static string CleanText(string? value, int maxLength) =>
        (value ?? "").Trim() is var cleaned && cleaned.Length > maxLength ? cleaned[..maxLength] : cleaned;
}