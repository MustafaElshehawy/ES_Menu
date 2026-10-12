using System.Security.Claims;
using System.Text.Json;
using System.Text.RegularExpressions;
using DineSmart.Mvc.Data;
using DineSmart.Mvc.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DineSmart.Mvc.Controllers;

[ApiController]
[Authorize]
[Route("api/platform")]
public sealed class PlatformController(SqlStoreService stores) : ControllerBase
{
    [HttpPut]
    public async Task<IActionResult> Save(PlatformRequest request, CancellationToken cancellationToken)
    {
        var validationError = Validate(request.Stores);
        if (validationError is not null) return BadRequest(new { error = validationError });

        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId is null) return Unauthorized(new { error = "سجّل الدخول للمتابعة." });
        var submittedStores = request.Stores!;
        var activeStoreId = submittedStores.Any(store => store.Id == request.ActiveStoreId)
            ? request.ActiveStoreId!
            : submittedStores[0].Id;

        try
        {
            await stores.SavePlatformAsync(userId, submittedStores, activeStoreId, cancellationToken);
        }
        catch (StoreConflictException exception)
        {
            return StatusCode(exception.StatusCode, new { error = exception.Message });
        }

        return Ok(await stores.ReadPlatformAsync(userId, cancellationToken));
    }

    private static string? Validate(IReadOnlyList<StoreDto>? stores)
    {
        if (stores is null || stores.Count is < 1 or > 100) return "بيانات المتاجر غير صالحة.";
        var storeIds = new HashSet<string>(StringComparer.Ordinal);
        var slugs = new HashSet<string>(StringComparer.Ordinal);
        var allCategoryIds = new HashSet<string>(StringComparer.Ordinal);
        var allProductIds = new HashSet<string>(StringComparer.Ordinal);

        foreach (var store in stores)
        {
            if (string.IsNullOrWhiteSpace(store.Id) || string.IsNullOrWhiteSpace(store.Slug) || !IsObject(store.Profile) || store.Categories is null || store.Menu is null)
                return "بيانات المتجر غير مكتملة.";
            if (!storeIds.Add(store.Id) || !slugs.Add(store.Slug)) return "يوجد متجر أو رابط مكرر في الطلب.";
            if (store.Categories.Count > 200 || store.Menu.Count > 5000) return "تجاوزت حدود عدد الأقسام أو المنتجات.";
            if (!Regex.IsMatch(store.Slug, "^[a-z0-9-]{1,90}$")) return "رابط المتجر يجب أن يحتوي على أحرف إنجليزية وأرقام وشرطات فقط.";
            if (!store.Profile.TryGetProperty("name", out var profileName) || !IsObject(profileName)) return "اسم المتجر مطلوب.";

            if (store.Theme.ValueKind == JsonValueKind.Object)
            {
                if (!ValidColor(store.Theme, "primary") || !ValidColor(store.Theme, "background")) return "ألوان المنيو غير صالحة.";
            }

            var localCategoryIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (var category in store.Categories)
            {
                if (string.IsNullOrWhiteSpace(category.Id) || !IsObject(category.Name)) return "بيانات أحد الأقسام غير صالحة.";
                if (!localCategoryIds.Add(category.Id) || !allCategoryIds.Add(category.Id)) return "معرّف القسم مكرر.";
                var categoryImage = (category.Image ?? "").Trim();
                if (categoryImage.Length > 1_500_000 || (categoryImage.Length > 0 && !categoryImage.StartsWith("https://", StringComparison.OrdinalIgnoreCase) && !categoryImage.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !categoryImage.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase)))
                    return "صورة القسم غير صالحة.";
            }

            foreach (var product in store.Menu)
            {
                if (string.IsNullOrWhiteSpace(product.Id) || !IsObject(product.Name)) return "بيانات أحد المنتجات غير صالحة.";
                if (!allProductIds.Add(product.Id) || product.Price < 0) return "معرّف المنتج أو السعر غير صالح.";
                if (!string.IsNullOrEmpty(product.CategoryId) && !localCategoryIds.Contains(product.CategoryId)) return "القسم المختار للمنتج غير صالح.";
                if (product.Calories < 0) return "بيانات أحد المنتجات غير صالحة.";
                var image = (product.Image ?? "").Trim();
                if (image.Length > 1_500_000 || (image.Length > 0 && !image.StartsWith("https://", StringComparison.OrdinalIgnoreCase) && !image.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !image.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase)))
                    return "رابط صورة المنتج غير صالح.";
            }
        }

        return null;
    }

    private static bool IsObject(JsonElement value) => value.ValueKind == JsonValueKind.Object;

    private static bool ValidColor(JsonElement theme, string key)
    {
        if (!theme.TryGetProperty(key, out var color)) return true;
        return color.ValueKind == JsonValueKind.String && Regex.IsMatch(color.GetString() ?? "", "^#[0-9a-f]{6}$", RegexOptions.IgnoreCase);
    }
}