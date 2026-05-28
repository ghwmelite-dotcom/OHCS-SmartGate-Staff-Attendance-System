"""
capture_screenshots.py — capture deck assets from the OHCS PWAs via Playwright.

Targets smartgate.ohcsghana.org and staff-attendance.ohcsghana.org, logs into
each app ONCE (then persists session state so re-runs skip login), navigates
to each screen, and saves PNGs to decks/_assets/screenshots/.

One-time setup
--------------
    python -m pip install playwright python-dotenv
    python -m playwright install chromium

Credentials
-----------
Create decks/_scripts/.env (NOT committed) with:

    VMS_URL=https://smartgate.ohcsghana.org
    STAFF_URL=https://staff-attendance.ohcsghana.org
    STAFF_ID=<staff_id>
    STAFF_PIN=<4-digit PIN>

Both apps share the same Staff ID + PIN credentials.

Usage
-----
    python decks/_scripts/capture_screenshots.py               # capture all web-capturable
    python decks/_scripts/capture_screenshots.py S01 S08      # capture specific IDs
    python decks/_scripts/capture_screenshots.py --headed     # show the browser
    python decks/_scripts/capture_screenshots.py --list       # list capturable IDs
    python decks/_scripts/capture_screenshots.py --fresh      # ignore cached sessions

What's NOT capturable here
--------------------------
S05 (Telegram visitor-arrival notification) is a phone-app screenshot.
"""
from __future__ import annotations
import argparse
import asyncio
import os
import sys
from pathlib import Path
from typing import Callable, Awaitable

try:
    from playwright.async_api import async_playwright, Page, Browser, BrowserContext
except ImportError:
    sys.exit("playwright not installed. Run: python -m pip install playwright && python -m playwright install chromium")

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
    pass

SCRIPT_DIR = Path(__file__).parent
OUTPUT_DIR = SCRIPT_DIR.parent / "_assets" / "screenshots"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Persisted session state — cookies + localStorage. Skips repeat login.
VMS_STATE   = SCRIPT_DIR / "_state_vms.json"
STAFF_STATE = SCRIPT_DIR / "_state_staff.json"

VIEWPORT = {"width": 1600, "height": 1000}
HQ_GEO          = {"latitude": 5.55269, "longitude": -0.19752, "accuracy": 10}
OUTSIDE_HQ_GEO  = {"latitude": 5.56269, "longitude": -0.18752, "accuracy": 15}  # ~1km NE


# ─── Config ──────────────────────────────────────────────────────────────────

def env(name: str) -> str:
    v = os.environ.get(name)
    if v is None:
        sys.exit(f"Missing required env var: {name}. See decks/_scripts/.env.example.")
    return v


# ─── Login (idempotent — skips form if cookie session already valid) ─────────

async def login_vms(page: Page) -> None:
    await page.goto(env("VMS_URL"), wait_until="domcontentloaded")
    await page.wait_for_load_state("networkidle")
    if "/login" not in page.url:
        return
    await page.locator("input[type='text']").first.fill(env("STAFF_ID"))
    await page.locator("input[type='password']").first.fill(env("STAFF_PIN"))
    await page.get_by_role("button", name="Sign In", exact=True).click()
    await page.wait_for_url(lambda url: "/login" not in url, timeout=15000)
    await page.wait_for_load_state("networkidle")
    await page.wait_for_timeout(800)


async def login_staff(page: Page) -> None:
    await page.goto(env("STAFF_URL"), wait_until="domcontentloaded")
    await page.wait_for_load_state("networkidle")
    if "/login" not in page.url:
        return
    try:
        await page.get_by_role("button", name="Staff", exact=True).click(timeout=2000)
    except Exception:
        pass
    await page.locator("#login-identifier").fill(env("STAFF_ID"))
    await page.locator("#login-pin").fill(env("STAFF_PIN"))
    await page.get_by_role("button", name="Sign In", exact=True).click()
    await page.wait_for_url(lambda url: "/login" not in url, timeout=15000)
    await page.wait_for_load_state("networkidle")
    await page.wait_for_timeout(800)


# ─── Screenshot helper ───────────────────────────────────────────────────────

async def save(page: Page, name: str, *, full_page: bool = False, selector: str | None = None) -> None:
    path = OUTPUT_DIR / f"{name}.png"
    if selector:
        await page.locator(selector).screenshot(path=str(path))
    else:
        await page.screenshot(path=str(path), full_page=full_page)
    size_kb = path.stat().st_size / 1024
    print(f"  saved {path.name} ({size_kb:.1f} KB)")


# ─── Capture functions (each receives a logged-in context) ───────────────────

async def capture_s01(ctx: BrowserContext) -> None:
    """S01 — Check-in form, blank."""
    page = await ctx.new_page()
    await page.goto(f"{env('VMS_URL')}/check-in", wait_until="networkidle")
    await page.wait_for_timeout(1500)
    await save(page, "S01-checkin-form-blank")
    await page.close()


async def capture_s03(ctx: BrowserContext) -> None:
    """S03 — Visitor badge view (currently captures the check-in page as fallback)."""
    page = await ctx.new_page()
    await page.goto(f"{env('VMS_URL')}/check-in", wait_until="networkidle")
    await page.wait_for_timeout(1500)
    await save(page, "S03-visitor-badge")
    await page.close()


async def capture_s06(ctx: BrowserContext) -> None:
    """S06 — Visit reports."""
    page = await ctx.new_page()
    await page.goto(f"{env('VMS_URL')}/reports", wait_until="networkidle")
    await page.wait_for_timeout(1500)
    await save(page, "S06-visit-report")
    await page.close()


async def capture_s08(ctx: BrowserContext) -> None:
    """S08 — Clock-in screen, GPS inside OHCS HQ fence."""
    await ctx.set_geolocation(HQ_GEO)
    page = await ctx.new_page()
    await page.goto(f"{env('STAFF_URL')}/clock", wait_until="networkidle")
    await page.wait_for_timeout(3500)  # let GPS resolve + render
    await save(page, "S08-clockin-success")
    await page.close()


async def capture_s10(ctx: BrowserContext) -> None:
    """S10 — Clock-in rejection (GPS ~1km outside fence)."""
    await ctx.set_geolocation(OUTSIDE_HQ_GEO)
    page = await ctx.new_page()
    await page.goto(f"{env('STAFF_URL')}/clock", wait_until="networkidle")
    await page.wait_for_timeout(3500)
    await save(page, "S10-clockin-rejected")
    await page.close()


async def capture_s12(ctx: BrowserContext) -> None:
    """S12 — Streak banner (full clock page; crop manually if needed)."""
    await ctx.set_geolocation(HQ_GEO)
    page = await ctx.new_page()
    await page.goto(f"{env('STAFF_URL')}/clock", wait_until="networkidle")
    await page.wait_for_timeout(2500)
    await save(page, "S12-streak-banner")
    await page.close()


# ─── Registry ────────────────────────────────────────────────────────────────

# Map of ID → (app, capture function)
CAPTURES: dict[str, tuple[str, Callable[[BrowserContext], Awaitable[None]]]] = {
    "S01": ("vms",   capture_s01),
    "S03": ("vms",   capture_s03),
    "S06": ("vms",   capture_s06),
    "S08": ("staff", capture_s08),
    "S10": ("staff", capture_s10),
    "S12": ("staff", capture_s12),
}

NOT_WEB_CAPTURABLE = {
    "S05": "Telegram visitor-arrival notification — capture from phone Telegram app",
}


# ─── Runner ──────────────────────────────────────────────────────────────────

async def get_or_create_ctx(browser: Browser, app: str, fresh: bool) -> BrowserContext:
    """Build a context for `app`, loading persisted state if available."""
    if app == "vms":
        state_file = VMS_STATE
        ctx = await browser.new_context(
            viewport=VIEWPORT,
            storage_state=str(state_file) if state_file.exists() and not fresh else None,
        )
    else:  # staff
        state_file = STAFF_STATE
        ctx = await browser.new_context(
            viewport=VIEWPORT,
            permissions=["geolocation"],
            geolocation=HQ_GEO,
            storage_state=str(state_file) if state_file.exists() and not fresh else None,
        )
    # Always run idempotent login (skips if session already valid)
    page = await ctx.new_page()
    if app == "vms":
        await login_vms(page)
    else:
        await login_staff(page)
    await page.close()
    return ctx


async def run(ids: list[str], headed: bool, fresh: bool) -> None:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=not headed)
        ctx_by_app: dict[str, BrowserContext] = {}
        failed: list[tuple[str, str]] = []
        try:
            for sid in ids:
                print(f"\n== {sid}")
                if sid not in CAPTURES:
                    print(f"  skipped — not web-capturable")
                    continue
                app, fn = CAPTURES[sid]
                if app not in ctx_by_app:
                    print(f"  building {app} context (login if needed)…")
                    ctx_by_app[app] = await get_or_create_ctx(browser, app, fresh)
                try:
                    await fn(ctx_by_app[app])
                except Exception as exc:
                    print(f"  FAILED: {type(exc).__name__}: {str(exc)[:200]}")
                    failed.append((sid, str(exc)[:200]))
            # Persist storage state so the next run skips login
            if "vms" in ctx_by_app:
                await ctx_by_app["vms"].storage_state(path=str(VMS_STATE))
                print(f"\nSaved VMS session -> {VMS_STATE.name}")
            if "staff" in ctx_by_app:
                await ctx_by_app["staff"].storage_state(path=str(STAFF_STATE))
                print(f"Saved Staff session -> {STAFF_STATE.name}")
        finally:
            for ctx in ctx_by_app.values():
                await ctx.close()
            await browser.close()
        if failed:
            print("\nFailures:")
            for sid, msg in failed:
                print(f"  {sid}: {msg}")
        else:
            print("\nAll requested captures saved.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("ids", nargs="*", help="Specific screenshot IDs to capture (default: all)")
    parser.add_argument("--headed", action="store_true", help="Show the browser window")
    parser.add_argument("--list",   action="store_true", help="List capturable IDs and exit")
    parser.add_argument("--fresh",  action="store_true", help="Ignore cached session state, force re-login")
    args = parser.parse_args()

    if args.list:
        print("Web-capturable (Playwright):")
        for sid, (app, fn) in CAPTURES.items():
            doc = fn.__doc__.splitlines()[0] if fn.__doc__ else ""
            print(f"  {sid}  [{app}]  {doc}")
        print("\nManual capture required:")
        for sid, note in NOT_WEB_CAPTURABLE.items():
            print(f"  {sid}  {note}")
        return

    ids = args.ids if args.ids else list(CAPTURES.keys())
    for sid in ids:
        if sid not in CAPTURES and sid not in NOT_WEB_CAPTURABLE:
            sys.exit(f"Unknown screenshot ID: {sid}. Run with --list to see options.")
    web_ids = [s for s in ids if s in CAPTURES]
    asyncio.run(run(web_ids, headed=args.headed, fresh=args.fresh))

    skipped = [s for s in ids if s in NOT_WEB_CAPTURABLE]
    if skipped:
        print("\nNot captured here (manual):")
        for sid in skipped:
            print(f"  {sid}  {NOT_WEB_CAPTURABLE[sid]}")


if __name__ == "__main__":
    main()
