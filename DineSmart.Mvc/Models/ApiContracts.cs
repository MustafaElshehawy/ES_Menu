using System.Text.Json;

namespace DineSmart.Mvc.Models;

public sealed record UserDto(string Id, string Name, string Email);
public sealed record AccountRecord(string Id, string Name, string Email, string PasswordHash);
public sealed record PlatformDto(IReadOnlyList<StoreDto> Stores, string? ActiveStoreId);
public sealed record AuthResponse(UserDto User, PlatformDto Platform);

public sealed class RegisterRequest
{
    public string? Name { get; init; }
    public string? Email { get; init; }
    public string? Password { get; init; }
    public string? StoreName { get; init; }
}

public sealed class LoginRequest
{
    public string? Email { get; init; }
    public string? Password { get; init; }
}

public sealed class PlatformRequest
{
    public List<StoreDto>? Stores { get; init; }
    public string? ActiveStoreId { get; init; }
}

public sealed class StoreDto
{
    public string Id { get; set; } = "";
    public string Slug { get; set; } = "";
    public JsonElement Profile { get; set; } = JsonDefaults.EmptyObject;
    public JsonElement Theme { get; set; } = JsonDefaults.EmptyObject;
    public string Currency { get; set; } = "SAR";
    public List<CategoryDto> Categories { get; set; } = [];
    public List<ProductDto> Menu { get; set; } = [];
}

public sealed class CategoryDto
{
    public string Id { get; set; } = "";
    public JsonElement Name { get; set; } = JsonDefaults.EmptyObject;
    public string Icon { get; set; } = "";
    public string Image { get; set; } = "";
}

public sealed class ProductDto
{
    public string Id { get; set; } = "";
    public string? CategoryId { get; set; }
    public JsonElement Name { get; set; } = JsonDefaults.EmptyObject;
    public JsonElement Description { get; set; } = JsonDefaults.EmptyObject;
    public JsonElement Ingredients { get; set; } = JsonDefaults.EmptyObject;
    public decimal Price { get; set; }
    public int Calories { get; set; }
    public string Image { get; set; } = "";
    public bool Available { get; set; } = true;
}

public static class JsonDefaults
{
    public static JsonElement EmptyObject { get; } = JsonDocument.Parse("{}").RootElement.Clone();
}