"""Mock-only UI smoke check. Run with webapp-testing's with_server helper on :5181."""
import json
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True)
    output = Path(tempfile.mkdtemp(prefix="ohcs-personal-attendance-"))
    for role, width in [("staff", 390), ("admin", 1440), ("director", 1440)]:
        context = browser.new_context(viewport={"width": width, "height": 960})
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
                data = {"user": {"id": "fixture", "name": "Demo Officer", "email": "demo@example.test", "role": role, "staff_id": "TEST001", "phone": None, "pin_acknowledged": True}}
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
            elif path.startswith("notifications"):
                data = {"notifications": [], "unread_count": 0}
            route.fulfill(json={"data": data, "error": None})

        page.route("**/api/**", handle)
        page.goto("http://127.0.0.1:5181/")
        page.wait_for_load_state("networkidle")
        expect(page.get_by_role("heading", name="My attendance", exact=True)).to_be_visible()
        panel = page.locator('section[aria-labelledby="personal-attendance-title"]')
        expect(panel.get_by_text("08:12", exact=True)).to_have_count(2)
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Horizontal overflow"
        if role == "staff":
            assert not any(c.startswith("visits") for c in calls), calls
        else:
            assert any(c.startswith("visits") for c in calls), calls
        page.screenshot(path=str(output / f"{role}-{width}.png"), full_page=True)
        before = calls.count("clock/my-status")
        panel.get_by_role("button", name="Refresh", exact=True).click()
        expect(panel.get_by_role("button", name="Refresh", exact=True)).to_be_enabled()
        assert calls.count("clock/my-status") > before
        if role == "staff":
            before = calls.count("clock/my-status")
            page.clock.fast_forward(61_000)
            page.wait_for_timeout(500)
            assert calls.count("clock/my-status") > before, "Automatic refresh did not run"
            page.clock.resume()
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
