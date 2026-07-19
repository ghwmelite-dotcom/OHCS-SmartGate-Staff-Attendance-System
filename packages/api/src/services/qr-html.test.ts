import { describe, it, expect } from 'vitest';
import QRCode from 'qrcode';
import { qrTableHtml } from './qr-html';

// Deterministic payload: 6 alphanumeric chars at EC level M always encodes as a
// version-1 symbol, so the matrix size is stable across runs.
const PAYLOAD = 'KM7P2X';
const QUIET_ZONE_MODULES = 2;

describe('qrTableHtml', () => {
  it('renders size + 2*quiet rows and columns for the payload', () => {
    const { modules } = QRCode.create(PAYLOAD, { errorCorrectionLevel: 'M' });
    const expected = modules.size + QUIET_ZONE_MODULES * 2;
    const html = qrTableHtml(PAYLOAD);

    const rows = html.match(/<tr>/g) ?? [];
    expect(rows).toHaveLength(expected);

    const firstRow = html.slice(html.indexOf('<tr>'), html.indexOf('</tr>'));
    const cells = firstRow.match(/<td /g) ?? [];
    expect(cells).toHaveLength(expected);
  });

  it('contains both dark and light cells', () => {
    const html = qrTableHtml(PAYLOAD);
    expect(html).toContain('background:#111');
    expect(html).toContain('background:#fff');
  });

  it('embeds no URLs or image tags — it must render with remote content blocked', () => {
    const html = qrTableHtml(PAYLOAD).toLowerCase();
    expect(html).not.toContain('http');
    expect(html).not.toContain('<img');
  });

  it('honours the modulePx argument (default 3)', () => {
    expect(qrTableHtml(PAYLOAD)).toContain('width:3px;height:3px');
    expect(qrTableHtml(PAYLOAD, 5)).toContain('width:5px;height:5px');
  });
});
