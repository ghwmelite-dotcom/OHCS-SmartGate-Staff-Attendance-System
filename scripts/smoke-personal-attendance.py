"""Mock-only UI smoke check. Run with webapp-testing's with_server helper on :5181."""
import json
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True)
    output = Path(tempfile.mkdtemp(prefix="ohcs-personal-attendance-"))
    for role, width, height in [("staff", 320, 640), ("staff", 375, 720), ("staff", 390, 740), ("staff", 430, 820), ("admin", 768, 960), ("admin", 844, 390), ("admin", 1024, 800), ("admin", 1440, 960), ("director", 1440, 960)]:
        print(f'Checking {role} {width}x{height}', flush=True)
        context = browser.new_context(viewport={"width": width, "height": height})
        page = context.new_page()
        page.clock.install()
        page.add_init_script("localStorage.setItem('ohcs.vms.wizard.v1.seen:fixture', '1')")
        calls = []
        state = {"failed": False, "empty": False}
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))

        def handle(route):
            path = route.request.url.split("/api/")[-1]
            calls.append(path)
            data = []
            if path == "auth/me":
                data = {"user": {"id": "fixture", "name": "Demo Officer With A Longer Display Name", "email": "demo@example.test", "role": role, "staff_id": "TEST001", "phone": None, "pin_acknowledged": True}}
            elif path.startswith("clock/"):
                if state["failed"]:
                    route.fulfill(status=503, json={"data": None, "error": {"code": "UNAVAILABLE", "message": "Test outage"}})
                    return
                if path == "clock/my-status":
                    data = {"clocked_in": not state["empty"], "clocked_out": False, "clock_in_time": None if state["empty"] else "2026-09-22T08:12:00Z", "clock_out_time": None}
                else:
                    data = [] if state["empty"] else [{"id": "event", "type": "clock_in", "timestamp": "2026-09-22T08:12:00Z"}]
            elif path.startswith("attendance/today"):
                data = {"total_staff": 0, "clocked_in": 0, "clocked_out": 0, "not_clocked_in": 0, "late_arrivals": 0, "early_departures": 0, "attendance_rate": 0}
            elif path == "admin/settings":
                data = {"work_end_time": "17:00"}
            elif path == "notifications/unread-count":
                data = {"count": 11}
            route.fulfill(json={"data": data, "error": None})

        page.route("**/api/**", handle)
        page.goto("http://127.0.0.1:5181/")
        page.wait_for_load_state("networkidle")
        expect(page.get_by_role("heading", name="My attendance", exact=True)).to_be_visible()
        panel = page.locator('section[aria-labelledby="personal-attendance-title"]')
        expect(panel.get_by_text("08:12", exact=True)).to_have_count(2)
        if role == 'staff' and width == 390:
            before = calls.count('clock/my-status')
            page.clock.fast_forward(61_000)
            page.wait_for_timeout(1500)
            assert calls.count('clock/my-status') > before, 'Automatic refresh did not run'
        page.clock.resume()
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Horizontal overflow"
        for control in page.locator('header button:visible, header select:visible').all():
            box = control.bounding_box()
            assert box and box['x'] >= 0 and box['x'] + box['width'] <= width, (width, box)
            assert box['width'] >= 44 and box['height'] >= 44, (width, box)
        if width < 640:
            tiles = panel.locator('[aria-busy] > div')
            first, second = tiles.nth(1).bounding_box(), tiles.nth(2).bounding_box()
            assert abs(first['y'] - second['y']) < 2, 'Clock tiles must share a row'
            recent = panel.get_by_role('heading', name='Recent activity').bounding_box()
            assert recent['y'] < height - 64, 'History heading should be above navigation'
            page.get_by_label('Colour theme').select_option('dark')
            page.screenshot(path=str(output / f'dark-{width}.png'))
            page.get_by_label('Colour theme').select_option('light')
        page.get_by_role('button', name='Notifications', exact=True).click()
        expect(page.get_by_text('No notifications', exact=True)).to_be_visible()
        notification = page.get_by_role('heading', name='Notifications', exact=True).locator('..').locator('..').bounding_box()
        assert notification['x'] >= 0 and notification['x'] + notification['width'] <= width
        page.get_by_role('button', name='Notifications', exact=True).click()
        page.get_by_role('button', name='Settings', exact=True).click()
        settings = page.locator('header').get_by_role('button', name='Settings', exact=True).locator('..').locator('div').last.bounding_box()
        assert settings and settings['x'] >= 0 and settings['x'] + settings['width'] <= width, settings
        page.get_by_role('button', name='Settings', exact=True).click()
        page.get_by_role('button', name='Open assistant', exact=True).click()
        chat = page.get_by_placeholder('Ask a question...').locator('..').locator('..')
        box = chat.bounding_box()
        assert box and box['x'] >= 0 and box['x'] + box['width'] <= width and box['y'] >= 0, box
        page.get_by_role('button', name='Close assistant', exact=True).click()
        if width < 1024:
            page.get_by_role('button', name='More', exact=True).click()
            expect(page.get_by_role('button', name='Sign Out', exact=True)).to_be_visible()
            page.get_by_role('button', name='More', exact=True).click()
        if role == "staff":
            assert not any(c.startswith("visits") for c in calls), calls
        else:
            assert any(c.startswith("visits") for c in calls), calls
        page.screenshot(path=str(output / f"{role}-{width}.png"), full_page=True)
        before = calls.count("clock/my-status")
        panel.get_by_role("button", name="Refresh", exact=True).click()
        expect(panel.get_by_role("button", name="Refresh", exact=True)).to_be_enabled()
        assert calls.count("clock/my-status") > before
        if role == "staff" and width == 390:
            state["failed"] = True
            panel.get_by_role("button", name="Refresh", exact=True).click()
            expect(panel.get_by_role("alert")).to_contain_text("may be outdated", timeout=15000)
            state["failed"] = False
            state["empty"] = True
            panel.get_by_role("button", name="Refresh", exact=True).click()
            expect(panel.get_by_text("No clock-in recorded today", exact=True)).to_be_visible()
            expect(panel.get_by_text("No attendance events recorded", exact=False)).to_be_visible()
        assert not errors, errors
        context.close()
    browser.close()
    print(json.dumps({"result": "passed", "screenshots": str(output), "checks": ["staff privacy", "admin and director preserved", "mobile overflow", "refresh", "automatic refresh", "stale error", "empty records"]}))
