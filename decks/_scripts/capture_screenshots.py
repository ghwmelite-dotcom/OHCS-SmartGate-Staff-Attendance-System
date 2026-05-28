"""
capture_screenshots.py — capture deck assets from the OHCS PWAs via Playwright.

Targets staff-attendance.pages.dev and ohcs-smartgate.pages.dev (configurable),
logs in once per app, navigates to each screen referenced by the deck outlines,
and saves PNGs to decks/_assets/screenshots/.

One-time setup
--------------
    python -m pip install playwright python-dotenv
    python -m playwright install chromium

Credentials
-----------
Create decks/_scripts/.env (NOT committed) with at minimum:

    VMS_URL=https://ohcs-smartgate.pages.dev
    VMS_EMAIL=<receptionist or admin account>
    VMS_PASSWORD=<password>
    VMS_HOST_EMAIL=<a host officer account, for the bell screenshot>
    VMS_HOST_PASSWORD=<host's password>

    STAFF_URL=https://staff-attendance.pages.dev
    STAFF_ID=<staff_id, e.g. OHCS-0042>
    STAFF_PIN=<PIN>

A .env.example is committed alongside this file as a template.

Usage
-----
    python decks/_scripts/capture_screenshots.py               # capture all web-capturable
    python decks/_scripts/capture_screenshots.py S01 S08      # capture specific IDs
    python decks/_scripts/capture_screenshots.py --headed     # show the browser
    python decks/_scripts/capture_screenshots.py --list       # list capturable IDs

What's NOT capturable here
--------------------------
S05 (Telegram visitor-arrival notification) is a screenshot of the Telegram app
on a phone — capture it manually and save as S05-telegram-arrival.png in the
output directory.

About selectors
---------------
The selectors below are best-guess based on the README and feature descriptions.
If a step fails, run with --headed to see what the page looks like, then update
the selector for that capture function. Selectors marked "# VERIFY" are the
ones most likely to need adjustment for your build.
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
    pass  # python-dotenv optional; env vars can also be set in the shell

OUTPUT_DIR = Path(__file__).parent.parent / "_assets" / "screenshots"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

VIEWPORT = {"width": 1600, "height": 1000}
NAV_TIMEOUT_MS = 15_000


# ─── Config (read from env) ──────────────────────────────────────────────────

def env(name: str, default: str | None = None) -> str:
    v = os.environ.get(name, default)
    if v is None:
        sys.exit(f"Missing required env var: {name}. See decks/_scripts/.env.example.")
    return v


# ─── Login helpers ───────────────────────────────────────────────────────────

async def login_vms(page: Page, email: str, password: str) -> None:
    """Log into the SmartGate (VMS) admin app."""
    await page.goto(env("VMS_URL"), wait_until="domcontentloaded")
    # VERIFY — selectors below assume an email + password flow
    await page.get_by_label("Email", exact=False).fill(email)
    await page.get_by_label("Password", exact=False).fill(password)
    await page.get_by_role("button", name="Sign in").click()
    await page.wait_for_load_state("networkidle")


async def login_staff(page: Page, staff_id: str, pin: str) -> None:
    """Log into the Staff Attendance PWA via Staff ID + PIN."""
    await page.goto(env("STAFF_URL"), wait_until="domcontentloaded")
    # VERIFY — selectors based on README's PIN + staff_id flow
    await page.get_by_label("Staff ID", exact=False).fill(staff_id)
    await page.get_by_label("PIN", exact=False).fill(pin)
    await page.get_by_role("button", name="Sign in").click()
    await page.wait_for_load_state("networkidle")


# ─── Screenshot helpers ──────────────────────────────────────────────────────

async def save(page: Page, name: str, *, full_page: bool = False, selector: str | None = None) -> Path:
    """Take a screenshot and save to the assets folder."""
    path = OUTPUT_DIR / f"{name}.png"
    if selector:
        await page.locator(selector).screenshot(path=str(path))
    else:
        await page.screenshot(path=str(path), full_page=full_page)
    print(f"  saved {path.name}")
    return path


# ─── VMS captures ────────────────────────────────────────────────────────────

async def capture_s01_checkin_form_blank(ctx: BrowserContext) -> None:
    """S01 — Reception check-in form, blank."""
    page = await ctx.new_page()
    await login_vms(page, env("VMS_EMAIL"), env("VMS_PASSWORD"))
    # VERIFY — adjust path to your reception check-in route
    await page.goto(f"{env('VMS_URL')}/reception/checkin", wait_until="networkidle")
    await save(page, "S01-checkin-form-blank")
    await page.close()


async def capture_s03_visitor_badge(ctx: BrowserContext) -> None:
    """S03 — Visitor badge view (after a check-in submit)."""
    page = await ctx.new_page()
    await login_vms(page, env("VMS_EMAIL"), env("VMS_PASSWORD"))
    await page.goto(f"{env('VMS_URL')}/reception/checkin", wait_until="networkidle")
    # VERIFY — these are illustrative; replace with your form field labels
    await page.get_by_label("Visitor name", exact=False).fill("Demo Visitor")
    await page.get_by_label("Phone", exact=False).fill("0000000000")
    await page.get_by_label("Host", exact=False).fill("Demo Host")
    await page.get_by_label("Purpose", exact=False).select_option(index=1)
    await page.get_by_role("button", name="Check in").click()
    await page.wait_for_load_state("networkidle")
    # Wait for badge view to render
    await page.wait_for_selector("[data-testid='visitor-badge']", timeout=NAV_TIMEOUT_MS)  # VERIFY
    await save(page, "S03-visitor-badge")
    await page.close()


async def capture_s06_visit_report(ctx: BrowserContext) -> None:
    """S06 — Director visit report (date range)."""
    page = await ctx.new_page()
    await login_vms(page, env("VMS_EMAIL"), env("VMS_PASSWORD"))
    await page.goto(f"{env('VMS_URL')}/admin/reports", wait_until="networkidle")  # VERIFY
    await save(page, "S06-visit-report")
    await page.close()


# ─── Staff captures ──────────────────────────────────────────────────────────

async def capture_s08_clockin_success(ctx: BrowserContext) -> None:
    """S08 — Clock-in screen, GPS acquired, inside fence.

    NOTE: GPS state depends on geolocation permissions and an inside-fence
    coordinate. We override geolocation to the OHCS HQ centroid below.
    """
    # Override geolocation to OHCS HQ (5.55269, -0.19752) so the fence accepts
    geo_ctx = await ctx.browser.new_context(  # type: ignore[union-attr]
        viewport=VIEWPORT,
        geolocation={"latitude": 5.55269, "longitude": -0.19752, "accuracy": 10},
        permissions=["geolocation"],
    )
    page = await geo_ctx.new_page()
    await login_staff(page, env("STAFF_ID"), env("STAFF_PIN"))
    await page.goto(f"{env('STAFF_URL')}/clock", wait_until="networkidle")  # VERIFY
    # Wait for GPS lock indicator before screenshotting
    await page.wait_for_selector("[data-testid='gps-ready']", timeout=NAV_TIMEOUT_MS)  # VERIFY
    await save(page, "S08-clockin-success")
    await geo_ctx.close()


async def capture_s10_clockin_rejected(ctx: BrowserContext) -> None:
    """S10 — Clock-in rejection with clear distance + accuracy.

    Override geolocation to a coordinate clearly outside the 75m fence
    (e.g., 1km away).
    """
    geo_ctx = await ctx.browser.new_context(  # type: ignore[union-attr]
        viewport=VIEWPORT,
        geolocation={"latitude": 5.56269, "longitude": -0.18752, "accuracy": 15},  # ~1km NE
        permissions=["geolocation"],
    )
    page = await geo_ctx.new_page()
    await login_staff(page, env("STAFF_ID"), env("STAFF_PIN"))
    await page.goto(f"{env('STAFF_URL')}/clock", wait_until="networkidle")
    # Attempt clock-in to trigger the rejection UI
    await page.get_by_role("button", name="Clock in").click()  # VERIFY
    # Wait for the rejection panel
    await page.wait_for_selector("[data-testid='clockin-rejected']", timeout=NAV_TIMEOUT_MS)  # VERIFY
    await save(page, "S10-clockin-rejected")
    await geo_ctx.close()


async def capture_s12_streak_banner(ctx: BrowserContext) -> None:
    """S12 — Streak banner with 'best-ever' badge (the streak module on the clock page)."""
    page = await ctx.new_page()
    await login_staff(page, env("STAFF_ID"), env("STAFF_PIN"))
    await page.goto(f"{env('STAFF_URL')}/clock", wait_until="networkidle")
    # Screenshot just the streak banner element rather than the whole page
    await save(page, "S12-streak-banner", selector="[data-testid='streak-banner']")  # VERIFY
    await page.close()


# ─── Registry ────────────────────────────────────────────────────────────────

CAPTURE_FUNCS: dict[str, Callable[[BrowserContext], Awaitable[None]]] = {
    "S01": capture_s01_checkin_form_blank,
    "S03": capture_s03_visitor_badge,
    "S06": capture_s06_visit_report,
    "S08": capture_s08_clockin_success,
    "S10": capture_s10_clockin_rejected,
    "S12": capture_s12_streak_banner,
}

NOT_WEB_CAPTURABLE = {
    "S05": "Telegram visitor-arrival notification — capture from phone Telegram app, save as S05-telegram-arrival.png",
}


# ─── Runner ──────────────────────────────────────────────────────────────────

async def run(ids: list[str], headed: bool) -> None:
    async with async_playwright() as p:
        browser: Browser = await p.chromium.launch(headless=not headed)
        ctx = await browser.new_context(viewport=VIEWPORT)
        failed: list[tuple[str, str]] = []
        for sid in ids:
            print(f"\n== {sid}")
            fn = CAPTURE_FUNCS.get(sid)
            if fn is None:
                print(f"  skipped — not in CAPTURE_FUNCS (or not web-capturable)")
                continue
            try:
                await fn(ctx)
            except Exception as exc:
                print(f"  FAILED: {type(exc).__name__}: {exc}")
                failed.append((sid, str(exc)))
        await ctx.close()
        await browser.close()
        if failed:
            print("\nFailures:")
            for sid, msg in failed:
                print(f"  {sid}: {msg}")
            print("\nRun with --headed to debug, then update the VERIFY selectors.")
        else:
            print("\nAll requested captures saved.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("ids", nargs="*", help="Specific screenshot IDs to capture (default: all)")
    parser.add_argument("--headed", action="store_true", help="Show the browser window")
    parser.add_argument("--list", action="store_true", help="List capturable IDs and exit")
    args = parser.parse_args()

    if args.list:
        print("Web-capturable (Playwright):")
        for sid, fn in CAPTURE_FUNCS.items():
            print(f"  {sid}  {fn.__doc__.splitlines()[0] if fn.__doc__ else ''}")
        print("\nManual capture required:")
        for sid, note in NOT_WEB_CAPTURABLE.items():
            print(f"  {sid}  {note}")
        return

    ids = args.ids if args.ids else list(CAPTURE_FUNCS.keys())
    for sid in ids:
        if sid not in CAPTURE_FUNCS and sid not in NOT_WEB_CAPTURABLE:
            sys.exit(f"Unknown screenshot ID: {sid}. Run with --list to see options.")
    web_ids = [s for s in ids if s in CAPTURE_FUNCS]
    asyncio.run(run(web_ids, headed=args.headed))

    skipped = [s for s in ids if s in NOT_WEB_CAPTURABLE]
    if skipped:
        print("\nNot captured here (manual):")
        for sid in skipped:
            print(f"  {sid}  {NOT_WEB_CAPTURABLE[sid]}")


if __name__ == "__main__":
    main()
