"""Local-only browser check; every API request is intercepted with synthetic data."""
import json
import argparse
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--output-dir', required=True, help='Existing directory for screenshots')
OUTPUT = Path(parser.parse_args().output_dir)
with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True)
    context = browser.new_context(viewport={'width': 390, 'height': 844}, reduced_motion='reduce', service_workers='block')
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    state = {'clocked_in': True, 'clocked_out': False, 'clock_in_time': '2026-10-02T08:00:00Z', 'clock_out_time': None, 'attendance_date': '2026-10-02', 'streak': 1, 'longest_streak': 1}
    submitted = []

    def api(route):
        url = route.request.url
        data = {}
        if '/auth/me' in url:
            data = {'user': {'id': 'qa-user', 'name': 'Pilot Officer', 'role': 'staff', 'email': 'qa@example.test', 'staff_id': 'QA001', 'pin_acknowledged': True}}
        elif '/clock/my-status' in url:
            data = state
        elif '/clock/prompt' in url:
            data = {'prompt_id': '11111111-1111-4111-8111-111111111111', 'challenge_action': 'blink', 'expires_at': 9999999999999}
        elif '/clock/self-report-out' in url:
            body = route.request.post_data_json
            submitted.append(body)
            assert body['departure_at'] == '2026-10-02T14:15:00.000Z'
            assert 'latitude' not in body and 'webauthn_assertion' not in body
            state.update(clocked_out=True, clock_out_time=body['departure_at'], clock_out_self_reported=True)
            data = {'self_reported': True}
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'data': data, 'error': None}))

    page.route('**/api/**', api)
    page.goto('http://127.0.0.1:5174/clock', wait_until='networkidle')
    print('Buttons:', page.get_by_role('button').all_text_contents())
    expect(page.get_by_role('button', name='Already left the office?')).to_be_visible()
    page.screenshot(path=str(OUTPUT / 'soft-clockout-mobile-idle.png'), full_page=True)
    page.get_by_role('button', name='Already left the office?').click()
    page.get_by_label('Left earlier today').check()
    page.get_by_label('Departure time (Ghana time)').fill('14:15')
    page.get_by_label('Your attendance login PIN').fill('1234')
    page.screenshot(path=str(OUTPUT / 'soft-clockout-mobile-form.png'), full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal overflow'
    page.get_by_role('button', name='Confirm departure', exact=True).click()
    expect(page.get_by_text('Self-reported', exact=True)).to_be_visible()
    expect(page.get_by_role('button', name='Already left the office?')).to_have_count(0)
    expect(page.get_by_text('Clock-out recorded', exact=True)).to_be_visible()
    expect(page.get_by_text('Enjoy your time off.', exact=True)).to_be_visible()
    expect(page.get_by_text('See you tomorrow', exact=False)).to_have_count(0)
    page.reload(wait_until='networkidle')
    expect(page.get_by_text('Clock-out recorded', exact=True)).to_be_visible()
    expect(page.get_by_text('was recorded as self-reported.', exact=False)).to_be_visible()
    page.screenshot(path=str(OUTPUT / 'soft-clockout-mobile-confirmed.png'), full_page=True)
    assert len(submitted) == 1
    assert not errors, errors
    print('PASS: mobile flow, no GPS/camera payload, correct departure, status refresh, no overflow or page errors.')
    browser.close()
