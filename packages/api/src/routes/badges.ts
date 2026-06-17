import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { success, notFound, error } from '../lib/response';
import { rateLimit } from '../lib/rate-limit';

export const badgeRoutes = new Hono<{ Bindings: Env }>();

// Public badge endpoints are unauthenticated; rate-limit per IP to prevent
// enumeration of the global badge-code space.
async function checkBadgeRateLimit(c: Context<{ Bindings: Env }>): Promise<{ allowed: boolean; retryAfter: number }> {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  return rateLimit(c.env, `badge-ip:${ip}`, 30, 60);
}

interface BadgeData {
  badge_code: string;
  status: string;
  visitor_name: string;
  organisation: string | null;
  photo_url: string | null;
  host_name: string | null;
  directorate: string | null;
  directorate_abbr: string | null;
  floor: string | null;
  wing: string | null;
  check_in_at: string;
  check_out_at: string | null;
}

const BADGE_QUERY = `SELECT v.badge_code, v.status, v.check_in_at, v.check_out_at,
       vis.first_name || ' ' || vis.last_name as visitor_name,
       vis.organisation, vis.photo_url,
       o.name as host_name,
       d.name as directorate, d.abbreviation as directorate_abbr,
       d.floor, d.wing
FROM visits v
JOIN visitors vis ON v.visitor_id = vis.id
LEFT JOIN officers o ON v.host_officer_id = o.id
LEFT JOIN directorates d ON v.directorate_id = d.id
WHERE v.badge_code = ?`;

// Public JSON API
badgeRoutes.get('/:code', async (c) => {
  const rl = await checkBadgeRateLimit(c);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return error(c, 'RATE_LIMITED', 'Too many requests. Try again shortly.', 429);
  }
  const code = c.req.param('code');
  const visit = await c.env.DB.prepare(BADGE_QUERY).bind(code).first<BadgeData>();
  if (!visit) return notFound(c, 'Badge');
  return success(c, visit);
});

// Public, badge-scoped photo — serves the visitor's face photo only when
// addressed via a valid badge code. Keeps the auth-gated /api/photos route
// untouched. Rate-limited to deter badge-code enumeration.
badgeRoutes.get('/:code/photo', async (c) => {
  const rl = await checkBadgeRateLimit(c);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return error(c, 'RATE_LIMITED', 'Too many requests. Try again shortly.', 429);
  }
  const code = c.req.param('code');
  const row = await c.env.DB.prepare(
    `SELECT vis.id as visitor_id
     FROM visits v JOIN visitors vis ON v.visitor_id = vis.id
     WHERE v.badge_code = ?`
  ).bind(code).first<{ visitor_id: string }>();
  if (!row) return notFound(c, 'Photo');

  const object = await c.env.STORAGE.get(`photos/visitors/${row.visitor_id}.jpg`);
  if (!object) return notFound(c, 'Photo');

  const headers = new Headers();
  headers.set('Content-Type', 'image/jpeg');
  headers.set('Cache-Control', 'public, max-age=3600');
  return new Response(object.body, { headers });
});

// Public HTML badge page
export async function serveBadgePage(c: Context<{ Bindings: Env }>) {
  const rl = await checkBadgeRateLimit(c);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return c.html('<!DOCTYPE html><html><body style="font-family:system-ui;text-align:center;padding:60px"><h1>Too many requests</h1><p>Please wait a moment and reload.</p></body></html>', 429);
  }
  const code = c.req.param('code');
  const visit = await c.env.DB.prepare(BADGE_QUERY).bind(code).first<BadgeData>();

  if (!visit) {
    return c.html('<!DOCTYPE html><html><body style="font-family:system-ui;text-align:center;padding:60px"><h1>Badge not found</h1><p>This badge code is invalid or has been removed.</p></body></html>', 404);
  }

  const isActive = visit.status === 'checked_in';
  const checkInTime = new Date(visit.check_in_at).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
  const checkInDate = new Date(visit.check_in_at).toLocaleDateString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Visitor Badge \u2014 OHCS VMS</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      background: #F8F9FA;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 16px;
    }
    .badge {
      background: #fff;
      border-radius: 16px;
      max-width: 380px;
      width: 100%;
      overflow: hidden;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
      border: 1px solid #E5E7EB;
      margin-top: 24px;
    }
    .header {
      background: #1B3A5C;
      color: #fff;
      padding: 20px 24px;
      text-align: center;
    }
    .header h1 { font-size: 14px; font-weight: 600; letter-spacing: 0.5px; }
    .header .subtitle { font-size: 11px; opacity: 0.7; margin-top: 2px; }
    .status {
      padding: 12px 24px;
      text-align: center;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
    .status.active { background: #DCFCE7; color: #16A34A; }
    .status.expired { background: #F3F4F6; color: #6B7280; }
    .content { padding: 24px; }
    .visitor-name { font-size: 22px; font-weight: 700; color: #111827; }
    .organisation { font-size: 13px; color: #6B7280; margin-top: 2px; }
    .details { margin-top: 20px; display: flex; flex-direction: column; gap: 12px; }
    .detail { display: flex; align-items: flex-start; gap: 10px; }
    .detail-label { font-size: 11px; color: #9CA3AF; text-transform: uppercase; letter-spacing: 0.5px; min-width: 80px; }
    .detail-value { font-size: 14px; color: #111827; font-weight: 500; }
    .badge-code {
      margin-top: 20px;
      text-align: center;
      padding: 16px;
      background: #FEF3C7;
      border-radius: 12px;
    }
    .badge-code span { font-family: monospace; font-size: 20px; font-weight: 700; color: #92400E; letter-spacing: 2px; }
    .badge-code .label { font-size: 11px; color: #92400E; margin-bottom: 4px; }
    .qr-container { margin-top: 20px; text-align: center; }
    .qr-container svg { border-radius: 8px; }
    .footer {
      padding: 16px 24px;
      border-top: 1px solid #E5E7EB;
      text-align: center;
      font-size: 11px;
      color: #9CA3AF;
    }
    .gold-accent { display: block; height: 3px; background: #D4A017; }
  </style>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body>
  <div class="badge">
    <div class="header">
      <h1>OHCS VMS</h1>
      <div class="subtitle">Office of the Head of the Civil Service, Ghana</div>
    </div>
    <div class="gold-accent"></div>
    <div class="status ${isActive ? 'active' : 'expired'}">
      ${isActive ? '\u25CF Active Visitor' : '\u25CB Visit Ended'}
    </div>
    <div class="content">
      ${visit.photo_url ? `<div style="width:80px;height:80px;border-radius:12px;overflow:hidden;margin:0 auto 12px;border:2px solid #E8DFC9"><img src="/api/badges/${encodeURIComponent(visit.badge_code)}/photo" style="width:100%;height:100%;object-fit:cover" alt=""></div>` : ''}
      <div class="visitor-name">${escapeHtml(visit.visitor_name)}</div>
      ${visit.organisation ? `<div class="organisation">${escapeHtml(visit.organisation)}</div>` : ''}
      <div class="details">
        ${visit.host_name ? `<div class="detail"><div class="detail-label">Host</div><div class="detail-value">${escapeHtml(visit.host_name)}</div></div>` : ''}
        ${visit.directorate ? `<div class="detail"><div class="detail-label">Directorate</div><div class="detail-value">${escapeHtml(visit.directorate)} (${escapeHtml(visit.directorate_abbr ?? '')})</div></div>` : ''}
        ${visit.floor ? `<div class="detail"><div class="detail-label">Location</div><div class="detail-value">${escapeHtml(visit.floor)}${visit.wing ? `, ${escapeHtml(visit.wing)} Wing` : ''}</div></div>` : ''}
        <div class="detail"><div class="detail-label">Date</div><div class="detail-value">${checkInDate}</div></div>
        <div class="detail"><div class="detail-label">Check In</div><div class="detail-value">${checkInTime}</div></div>
      </div>
      <div class="badge-code">
        <div class="label">BADGE CODE</div>
        <span>${escapeHtml(visit.badge_code)}</span>
      </div>
      <div class="qr-container" id="qr"></div>
    </div>
    <div class="footer">Present this badge to security when requested</div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js"><\/script>
  <script>
    var qr = qrcode(0, 'M');
    qr.addData(window.location.href);
    qr.make();
    document.getElementById('qr').innerHTML = qr.createSvgTag(5, 0);
    ${isActive ? 'setTimeout(function(){ location.reload(); }, 60000);' : ''}
  <\/script>
</body>
</html>`;

  return c.html(html);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
