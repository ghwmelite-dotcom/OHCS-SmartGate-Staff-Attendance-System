import QRCode from 'qrcode';

// Email clients (Outlook/Gmail) block SVG and external images by default, but
// reliably render HTML tables — so a QR destined for an email is a borderless
// <table> of black/white cells. Only the pure-JS module matrix from `qrcode`
// is used (the canvas/string renderers need a browser DOM), so this runs
// inside the Worker. A 2-module white quiet zone is added around the matrix,
// as scanners expect.
const QUIET_ZONE_MODULES = 2;

export function qrTableHtml(payload: string, modulePx = 3): string {
  const { modules } = QRCode.create(payload, { errorCorrectionLevel: 'M' });
  const size = modules.size;
  const total = size + QUIET_ZONE_MODULES * 2;

  const rows: string[] = [];
  for (let r = 0; r < total; r++) {
    const cells: string[] = [];
    for (let c = 0; c < total; c++) {
      const inMatrix =
        r >= QUIET_ZONE_MODULES && r < size + QUIET_ZONE_MODULES &&
        c >= QUIET_ZONE_MODULES && c < size + QUIET_ZONE_MODULES;
      const dark = inMatrix && modules.get(r - QUIET_ZONE_MODULES, c - QUIET_ZONE_MODULES) === 1;
      cells.push(
        `<td style="width:${modulePx}px;height:${modulePx}px;font-size:0;line-height:0;background:${dark ? '#111' : '#fff'};"></td>`,
      );
    }
    rows.push(`<tr>${cells.join('')}</tr>`);
  }

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:none;">${rows.join('')}</table>`;
}
