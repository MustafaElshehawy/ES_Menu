using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using DineSmart.Mvc.Data;
using DineSmart.Mvc.Models;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Data.SqlClient;
using System.Text.Json;

namespace DineSmart.Mvc.Controllers;

[ApiController]
[Route("api/auth")]
public sealed class AuthController(SqlStoreService stores) : ControllerBase
{
    [HttpPost("register")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Register(RegisterRequest request, CancellationToken cancellationToken)
    {
        var name = CleanText(request.Name, 80);
        var email = CleanText(request.Email, 254).ToLowerInvariant();
        var password = request.Password ?? "";
        var storeName = CleanText(request.StoreName, 70);
        if (name.Length < 2 || !Regex.IsMatch(email, @"^[^\s@]+@[^\s@]+\.[^\s@]+$") || password.Length < 10 || storeName.Length == 0)
        {
            return BadRequest(new { error = "أكمل البيانات، واستخدم كلمة مرور لا تقل عن 10 أحرف." });
        }

        var user = new UserDto(Guid.NewGuid().ToString(), name, email);
        var store = new StoreDto
        {
            Id = Guid.NewGuid().ToString(),
            Slug = MakeSlug(storeName),
            Profile = JsonSerializer.SerializeToElement(new
            {
                siteName = storeName,
                name = new { ar = storeName, en = storeName },
                address = new { ar = "", en = "" },
                logo = ""
            }),
            Theme = JsonSerializer.SerializeToElement(new { primary = "#245b49", background = "#f6f7f3" }),
            Currency = "EGP"
        };

        try
        {
            await stores.CreateAccountAsync(user, PasswordSecurity.Hash(password), store, cancellationToken);
        }
        catch (SqlException exception) when (exception.Number is 2601 or 2627)
        {
            return Conflict(new { error = "البريد الإلكتروني مستخدم بالفعل." });
        }

        await SignInAsync(user);
        return StatusCode(StatusCodes.Status201Created, new AuthResponse(user, new PlatformDto([store], store.Id)));
    }

    [HttpPost("login")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Login(LoginRequest request, CancellationToken cancellationToken)
    {
        var email = CleanText(request.Email, 254).ToLowerInvariant();
        var account = await stores.FindAccountByEmailAsync(email, cancellationToken);
        if (account is null || !PasswordSecurity.Verify(request.Password ?? "", account.PasswordHash))
        {
            return Unauthorized(new { error = "البريد الإلكتروني أو كلمة المرور غير صحيحة." });
        }

        var user = new UserDto(account.Id, account.Name, account.Email);
        await SignInAsync(user);
        return Ok(new AuthResponse(user, await stores.ReadPlatformAsync(user.Id, cancellationToken)));
    }

    [HttpPost("logout")]
    public async Task<IActionResult> Logout()
    {
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return Ok(new { loggedOut = true });
    }

    [HttpGet("me")]
    [Authorize]
    public async Task<IActionResult> Me(CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var user = userId is null ? null : await stores.FindUserByIdAsync(userId, cancellationToken);
        if (user is null) return Unauthorized(new { error = "الحساب غير موجود." });
        return Ok(new AuthResponse(user, await stores.ReadPlatformAsync(user.Id, cancellationToken)));
    }

    private async Task SignInAsync(UserDto user)
    {
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id),
            new Claim(ClaimTypes.Name, user.Name),
            new Claim(ClaimTypes.Email, user.Email)
        };
        var identity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
        await HttpContext.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            new ClaimsPrincipal(identity),
            new AuthenticationProperties { IsPersistent = true, ExpiresUtc = DateTimeOffset.UtcNow.AddDays(7) });
    }

    private static string CleanText(string? value, int maxLength)
    {
        var cleaned = (value ?? "").Trim();
        return cleaned.Length > maxLength ? cleaned[..maxLength] : cleaned;
    }

    private static string MakeSlug(string name)
    {
        var builder = new System.Text.StringBuilder();
        var previousWasSeparator = false;
        foreach (var character in name.Normalize(System.Text.NormalizationForm.FormD).ToLowerInvariant())
        {
            if (char.IsAsciiLetterOrDigit(character))
            {
                builder.Append(character);
                previousWasSeparator = false;
            }
            else if (builder.Length > 0 && !previousWasSeparator)
            {
                builder.Append('-');
                previousWasSeparator = true;
            }
        }

        var slug = builder.ToString().Trim('-');
        if (slug.Length == 0) slug = "menu";
        return $"{slug}-{Convert.ToHexString(RandomNumberGenerator.GetBytes(3)).ToLowerInvariant()}";
    }
}

internal static class PasswordSecurity
{
    private const int Iterations = 310_000;
    private const int SaltSize = 16;
    private const int HashSize = 32;

    public static string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, HashSize);
        return $"pbkdf2-sha256${Iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
    }

    public static bool Verify(string password, string storedHash)
    {
        var parts = storedHash.Split('$');
        if (parts.Length != 4 || parts[0] != "pbkdf2-sha256" || !int.TryParse(parts[1], out var iterations)) return false;
        try
        {
            var salt = Convert.FromBase64String(parts[2]);
            var expected = Convert.FromBase64String(parts[3]);
            var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, expected.Length);
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch (FormatException)
        {
            return false;
        }
    }
}