using DineSmart.Mvc.Data;
using Microsoft.AspNetCore.Mvc;

namespace DineSmart.Mvc.Controllers;

[ApiController]
[Route("api")]
public sealed class PublicMenuController(SqlStoreService stores) : ControllerBase
{
    [HttpGet("health")]
    public async Task<IActionResult> Health(CancellationToken cancellationToken)
    {
        try
        {
            await stores.IsHealthyAsync(cancellationToken);
            return Ok(new { status = "ok", database = "connected" });
        }
        catch
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { status = "error", database = "unavailable" });
        }
    }

    [HttpGet("public/{slug}")]
    public async Task<IActionResult> GetMenu(string slug, CancellationToken cancellationToken)
    {
        var store = await stores.ReadPublicStoreAsync(slug, cancellationToken);
        if (store is null) return NotFound(new { error = "المنيو غير موجود." });
        Response.Headers.CacheControl = "no-store";
        return Ok(store);
    }
}