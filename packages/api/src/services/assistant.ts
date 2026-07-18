import type { Env } from '../types';

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast' as Parameters<Ai['run']>[0];
const MAX_LOOKUP_ROUNDS = 3;
const MAX_TOKENS_RECEPTIONIST = 400;
const MAX_TOKENS_ANALYTICS = 1000;

// ---------------------------------------------------------------------------
// Receptionist mode — routes visitors to the right office
// ---------------------------------------------------------------------------
const BASE_PROMPT = `You are OHCS VMS Assistant, the AI receptionist helper at the Office of the Head of the Civil Service (OHCS) in Accra, Ghana. OHCS VMS is the Visitor Management System.

YOUR PRIMARY ROLE: Help receptionists direct visitors to the RIGHT office based on their stated purpose of visit.

=== OHCS BUILDING LAYOUT ===
- 1st Floor: Deputy Directors' offices, some units
- 2nd Floor: All Directors' offices, Chief Director's office, Head of Service office, Confidential Registry

=== ROUTING KEYWORD MAP ===
Use these keywords to match a visitor's stated purpose to the correct directorate (by abbreviation). Then look up the current room in the LIVE DIRECTORY below.

- **F&A** (Finance & Administration): budget, expenditure, payments, accounting, pension, personnel management, promotions admin, retirement, recruitment admin, official records, stores, assets, procurement, transport, vehicle, estates, maintenance, staff welfare, asset register, office supplies
- **PBMED** (Planning, Budgeting, Monitoring & Evaluation): performance agreements, performance appraisals, medium-term development plans, annual budgets, progress reports, NDPC reporting, productivity policies, client service charters, monitoring and evaluation
- **CMD** (Career Management Directorate): career management, promotions policy, postings, transfers, succession planning, staff distribution, occupational health, welfare policy, Civil Service Council matters
- **RSIMD** (Research, Statistics & Information Management): ICT, technology, computers, IT systems, software, research, data, surveys, HR database, salary administration, salary issues, salary review, E-SPAR, ESPAR, information management, e-governance, statistics
- **RTDD** (Recruitment, Training & Development): recruitment, job applications, graduate entrance exam, interviews, hiring, training, capacity building, study leave, scholarship, GIMPA, staff development, induction, onboarding, JICA, training plans
- **CSC** (Civil Service Council Secretariat): Civil Service Council, council appointments, category A appointments, disciplinary matters, petitions to council, contract appointments, schemes of service
- **RCU** (Reforms Coordinating Unit): reforms, anti-corruption, NACAP, Right to Information, RTI, administrative reforms, productivity improvement
- **IAU** (Internal Audit Unit): audit, internal audit, fraud prevention, risk assessment, financial controls, compliance review, special investigations
- **Confidential Registry**: document submission, submitting documents, confidential documents, registry, filing documents
- **Chief Director / Head of Service**: only if the visitor specifically requests them

=== ROUTING RULES ===
1. ALWAYS recommend the Deputy Director's office first (1st Floor) unless the visitor specifically asks for the Director.
2. Match purpose to directorate abbreviation, then consult the LIVE DIRECTORY for the exact room number.
3. If the purpose doesn't match any keyword, ask the visitor which specific office or person they want to see.
4. For document submissions: direct to Confidential Registry (unless directorate-specific).
5. Keep responses SHORT: "Direct them to [Directorate] — Deputy Director's office, Room XX, 1st Floor."

=== LOOKUP COMMANDS ===
When you need live data, output lookup commands on their own lines. Multiple lookups per turn are supported:
- LOOKUP_OFFICER:<name> — search officers by name
- LOOKUP_DIRECTORATE:<query> — search directorates
- LOOKUP_VISITOR:<name> — search visitors by name
- LOOKUP_STATS:today — get today's visit statistics
- LOOKUP_ACTIVE — get currently active visits

=== RULES ===
- Only answer questions related to OHCS VMS (Visitor Management System) operations
- You are read-only — cannot create visitors, check anyone in, or modify data
- Keep responses concise (2-3 sentences)
- Ghana conventions: DD/MM/YYYY dates, 12hr time
- If unsure about routing, say so and suggest the visitor ask for the specific person
- Politely decline off-topic requests`;

// ---------------------------------------------------------------------------
// Analytics mode — full data access for admin / superadmin callers
// ---------------------------------------------------------------------------
function buildAnalyticsPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  const [y, m, d] = today.split('-');
  const ghanaDate = `${d}/${m}/${y}`;

  return `You are OHCS Analytics Assistant — the AI data analyst for the Office of the Head of the Civil Service (OHCS), Accra, Ghana. You have read-only access to both the Visitor Management System (VMS) and the Staff Attendance system.

YOUR ROLE: Answer data questions from administrators. Always look up real data before answering — never estimate or fabricate numbers.

Today is ${ghanaDate} (${today}). Use this when interpreting relative queries ("last week", "this month", etc.).
Ghana conventions: DD/MM/YYYY dates, 12-hour clock.

"This week" = last 7 days. "This month" = last 30 days.

=== DATA YOU CAN ACCESS ===

VMS (Visitor Management System):
- Visit records: check-in/out times, duration, status, purpose category
- Visitor profiles: name, organisation, frequency, last visit
- Directorate traffic: which offices receive the most visits
- Officer workload: visits hosted per officer

Staff Attendance:
- Clock records: daily clock-in/out per staff member
- Late arrivals: staff who exceeded the late threshold
- Attendance rates: present/absent counts, by directorate
- Trends: daily patterns over date ranges

=== LOOKUP COMMANDS ===
Output EACH command on its own line. Run multiple in one reply when needed.

VMS Lookups:
- LOOKUP_OFFICER:<name> — officer details, room, availability
- LOOKUP_DIRECTORATE:<query> — directorate info
- LOOKUP_VISITOR:<name> — visitor history
- LOOKUP_STATS:today — today's visit totals and active count
- LOOKUP_ACTIVE — visitors currently inside the building
- LOOKUP_VISITS_SUMMARY:<from>|<to> — totals, unique visitors, avg duration, top directorates and purposes for a date range (YYYY-MM-DD|YYYY-MM-DD)
- LOOKUP_VISITS_TRENDS:<days> — daily volumes, peak day-of-week, peak hours, purpose breakdown
- LOOKUP_TOP_VISITORS:<days> — most frequent visitors in last N days
- LOOKUP_HOST_LOAD:<officer_name> — visits this officer received in last 30 days

Attendance Lookups:
- LOOKUP_ATTENDANCE_TODAY — clocked-in %, late arrivals, absent count (staff only)
- LOOKUP_ATTENDANCE_DATE:<date> — attendance snapshot for a specific date (YYYY-MM-DD)
- LOOKUP_ATTENDANCE_DIRECTORATE:<date> — all directorates' attendance for a date (YYYY-MM-DD)
- LOOKUP_ATTENDANCE_TRENDS:<days> — daily attendance rates for last N days
- LOOKUP_STAFF_ABSENT:<date> — names of staff not clocked in on a date (up to 20)

=== RULES ===
- ALWAYS run a lookup before citing numbers — never guess
- For cross-system questions (e.g. "does RSIMD have staff to handle their visitors?"), run BOTH a VMS and an attendance lookup
- Present numbers clearly: totals first, then breakdown
- You are READ-ONLY — cannot create records, check anyone in, or modify any data
- Decline questions outside OHCS operations`;
}

// ---------------------------------------------------------------------------

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// Extended pattern covers both receptionist and analytics lookup types.
const LOOKUP_PATTERN = /LOOKUP_(OFFICER|DIRECTORATE|VISITOR|STATS|ACTIVE|VISITS_SUMMARY|VISITS_TRENDS|TOP_VISITORS|HOST_LOAD|ATTENDANCE_TODAY|ATTENDANCE_DATE|ATTENDANCE_DIRECTORATE|ATTENDANCE_TRENDS|STAFF_ABSENT):?([^\n]*)/g;

let directoryCache: { value: string; ts: number } | null = null;
const DIRECTORY_TTL_MS = 60_000;

async function buildLiveDirectory(env: Env): Promise<string> {
  const now = Date.now();
  if (directoryCache && now - directoryCache.ts < DIRECTORY_TTL_MS) return directoryCache.value;

  const [dirs, officers] = await Promise.all([
    env.DB.prepare(
      `SELECT abbreviation, name, type, rooms, floor, wing
       FROM directorates WHERE is_active = 1 ORDER BY abbreviation`
    ).all<{ abbreviation: string; name: string; type: string; rooms: string | null; floor: string | null; wing: string | null }>(),
    env.DB.prepare(
      `SELECT o.name, o.title, o.office_number, d.abbreviation as dir_abbr
       FROM officers o JOIN directorates d ON o.directorate_id = d.id
       WHERE d.is_active = 1
       ORDER BY d.abbreviation, o.name`
    ).all<{ name: string; title: string | null; office_number: string | null; dir_abbr: string }>(),
  ]);

  const dirLines = (dirs.results ?? []).map(d => {
    const rooms = d.rooms ? `Rooms ${d.rooms}` : 'Rooms TBD';
    const floor = d.floor ? `, ${d.floor}` : '';
    const wing = d.wing ? `, ${d.wing} Wing` : '';
    return `- ${d.abbreviation} (${d.name}, ${d.type}): ${rooms}${floor}${wing}`;
  }).join('\n');

  const officerLines = (officers.results ?? []).map(o =>
    `- ${o.name}${o.title ? ` (${o.title})` : ''} — ${o.dir_abbr}${o.office_number ? `, Office ${o.office_number}` : ''}`
  ).join('\n');

  const text = `=== LIVE DIRECTORY ===\n\nDirectorates:\n${dirLines || '(none)'}\n\nOfficers:\n${officerLines || '(none)'}`;
  directoryCache = { value: text, ts: now };
  return text;
}

async function getLateThreshold(env: Env): Promise<string> {
  const row = await env.DB.prepare(
    `SELECT late_threshold_time FROM app_settings WHERE id = 1`
  ).first<{ late_threshold_time: string }>();
  return row?.late_threshold_time ?? '09:00:00';
}

async function executeLookup(type: string, query: string, env: Env): Promise<string> {
  const q = query.trim();

  switch (type) {
    // -----------------------------------------------------------------------
    // Existing receptionist lookups
    // -----------------------------------------------------------------------
    case 'OFFICER': {
      const results = await env.DB.prepare(
        `SELECT o.name, o.title, o.office_number, o.is_available, o.phone, o.email,
                d.abbreviation as directorate_abbr, d.rooms
         FROM officers o JOIN directorates d ON o.directorate_id = d.id
         WHERE o.name LIKE ? LIMIT 5`
      ).bind(`%${q}%`).all();
      if (!results.results?.length) return `No officers found matching "${q}".`;
      return results.results.map((o: Record<string, unknown>) =>
        `${o.name} — ${o.title || 'Officer'} (${o.directorate_abbr}), Office: ${o.office_number || 'N/A'}, ${o.is_available ? 'Available' : 'Unavailable'}`
      ).join('\n');
    }

    case 'DIRECTORATE': {
      const results = await env.DB.prepare(
        `SELECT name, abbreviation, type, rooms FROM directorates
         WHERE is_active = 1 AND (name LIKE ? OR abbreviation LIKE ?) LIMIT 5`
      ).bind(`%${q}%`, `%${q}%`).all();
      if (!results.results?.length) return `No directorates found matching "${q}".`;
      return results.results.map((d: Record<string, unknown>) =>
        `${d.abbreviation} — ${d.name} (${d.type}), Rooms: ${d.rooms || 'N/A'}`
      ).join('\n');
    }

    case 'VISITOR': {
      const results = await env.DB.prepare(
        `SELECT first_name, last_name, organisation, total_visits, last_visit_at FROM visitors
         WHERE first_name LIKE ? OR last_name LIKE ? ORDER BY last_visit_at DESC LIMIT 5`
      ).bind(`%${q}%`, `%${q}%`).all();
      if (!results.results?.length) return `No visitors found matching "${q}".`;
      return results.results.map((v: Record<string, unknown>) => {
        const lastVisit = v.last_visit_at
          ? new Date(v.last_visit_at as string).toLocaleDateString('en-GB')
          : 'Never';
        return `${v.first_name} ${v.last_name}${v.organisation ? ` (${v.organisation})` : ''} — ${v.total_visits} visits, last: ${lastVisit}`;
      }).join('\n');
    }

    case 'STATS': {
      const today = new Date().toISOString().slice(0, 10);
      const results = await env.DB.prepare(
        `SELECT status, COUNT(*) as count FROM visits WHERE DATE(check_in_at) = ? GROUP BY status`
      ).bind(today).all();
      if (!results.results?.length) return 'No visits recorded today.';
      const stats = results.results as Array<{ status: string; count: number }>;
      const total = stats.reduce((sum, s) => sum + s.count, 0);
      const checkedIn = stats.find(s => s.status === 'checked_in')?.count ?? 0;
      const checkedOut = stats.find(s => s.status === 'checked_out')?.count ?? 0;
      return `Today: ${total} total visits, ${checkedIn} currently in building, ${checkedOut} checked out.`;
    }

    case 'ACTIVE': {
      const results = await env.DB.prepare(
        `SELECT vis.first_name, vis.last_name, COALESCE(o.name, v.host_name_manual) as host_name, d.abbreviation as dir, v.check_in_at
         FROM visits v
         JOIN visitors vis ON v.visitor_id = vis.id
         LEFT JOIN officers o ON v.host_officer_id = o.id
         LEFT JOIN directorates d ON v.directorate_id = d.id
         WHERE v.status = 'checked_in' ORDER BY v.check_in_at DESC LIMIT 10`
      ).all();
      if (!results.results?.length) return 'No active visits right now.';
      return results.results.map((v: Record<string, unknown>) => {
        const time = new Date(v.check_in_at as string).toLocaleTimeString('en-US', {
          hour: 'numeric', minute: '2-digit', hour12: true,
        });
        return `${v.first_name} ${v.last_name} → ${v.host_name || 'No host'} (${v.dir || 'N/A'}) since ${time}`;
      }).join('\n');
    }

    // -----------------------------------------------------------------------
    // Analytics — VMS lookups
    // -----------------------------------------------------------------------
    case 'VISITS_SUMMARY': {
      const parts = q.split('|').map(s => s.trim());
      const from = parts[0];
      const to = parts[1];
      if (!from || !to) return 'Usage: LOOKUP_VISITS_SUMMARY:YYYY-MM-DD|YYYY-MM-DD';

      const [summary, byDir, byPurpose] = await Promise.all([
        env.DB.prepare(
          `SELECT COUNT(*) as total, COUNT(DISTINCT visitor_id) as unique_visitors,
                  ROUND(AVG(duration_minutes)) as avg_duration
           FROM visits WHERE DATE(check_in_at) >= ? AND DATE(check_in_at) <= ?`
        ).bind(from, to).first<{ total: number; unique_visitors: number; avg_duration: number | null }>(),

        env.DB.prepare(
          `SELECT d.abbreviation, COUNT(*) as count
           FROM visits v JOIN directorates d ON v.directorate_id = d.id
           WHERE DATE(v.check_in_at) >= ? AND DATE(v.check_in_at) <= ?
           GROUP BY d.id ORDER BY count DESC LIMIT 5`
        ).bind(from, to).all(),

        env.DB.prepare(
          `SELECT COALESCE(purpose_category, 'other') as cat, COUNT(*) as count
           FROM visits WHERE DATE(check_in_at) >= ? AND DATE(check_in_at) <= ?
           GROUP BY cat ORDER BY count DESC LIMIT 5`
        ).bind(from, to).all(),
      ]);

      if (!summary?.total) return `No visits found between ${from} and ${to}.`;

      const dirLines = (byDir.results ?? []).map((d: Record<string, unknown>) =>
        `  ${d.abbreviation}: ${d.count}`
      ).join('\n');
      const purposeLines = (byPurpose.results ?? []).map((p: Record<string, unknown>) =>
        `  ${p.cat}: ${p.count}`
      ).join('\n');

      return `Visits ${from} to ${to}:
Total visits: ${summary.total}
Unique visitors: ${summary.unique_visitors}
Avg duration: ${summary.avg_duration ?? 'N/A'} mins
Top directorates:\n${dirLines || '  (none)'}
Top purposes:\n${purposeLines || '  (none)'}`;
    }

    case 'VISITS_TRENDS': {
      const days = Math.min(Math.max(parseInt(q) || 30, 1), 365);
      const fromDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

      const [dailyVols, byDow, byHour, byCat] = await Promise.all([
        env.DB.prepare(
          `SELECT DATE(check_in_at) as date, COUNT(*) as count
           FROM visits WHERE DATE(check_in_at) >= ?
           GROUP BY date ORDER BY date ASC`
        ).bind(fromDate).all<{ date: string; count: number }>(),

        env.DB.prepare(
          `SELECT CAST(strftime('%w', check_in_at) AS INTEGER) as day, COUNT(*) as total
           FROM visits WHERE DATE(check_in_at) >= ?
           GROUP BY day ORDER BY total DESC LIMIT 3`
        ).bind(fromDate).all<{ day: number; total: number }>(),

        env.DB.prepare(
          `SELECT CAST(strftime('%H', check_in_at) AS INTEGER) as hour, COUNT(*) as total
           FROM visits WHERE DATE(check_in_at) >= ?
           GROUP BY hour ORDER BY total DESC LIMIT 3`
        ).bind(fromDate).all<{ hour: number; total: number }>(),

        env.DB.prepare(
          `SELECT COALESCE(purpose_category, 'other') as cat, COUNT(*) as count
           FROM visits WHERE DATE(check_in_at) >= ?
           GROUP BY cat ORDER BY count DESC LIMIT 5`
        ).bind(fromDate).all<{ cat: string; count: number }>(),
      ]);

      const rows = dailyVols.results ?? [];
      const totalVisits = rows.reduce((s, r) => s + r.count, 0);
      const avgPerDay = rows.length ? Math.round(totalVisits / rows.length) : 0;
      const peakDows = (byDow.results ?? []).map(r => dayLabels[r.day] ?? '?').join(', ');
      const peakHours = (byHour.results ?? []).map(r => `${r.hour}:00`).join(', ');
      const catLines = (byCat.results ?? []).map(p => `  ${p.cat}: ${p.count}`).join('\n');

      return `Visit trends — last ${days} days (from ${fromDate}):
Total visits: ${totalVisits}
Days with data: ${rows.length}
Avg per active day: ${avgPerDay}
Busiest days of week: ${peakDows || 'N/A'}
Peak hours: ${peakHours || 'N/A'}
Purpose breakdown:\n${catLines || '  (none)'}`;
    }

    case 'TOP_VISITORS': {
      const days = Math.min(Math.max(parseInt(q) || 30, 1), 365);
      const fromDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

      const results = await env.DB.prepare(
        `SELECT vis.first_name, vis.last_name, vis.organisation, COUNT(*) as visit_count,
                MAX(v.check_in_at) as last_visit
         FROM visits v JOIN visitors vis ON v.visitor_id = vis.id
         WHERE DATE(v.check_in_at) >= ?
         GROUP BY vis.id ORDER BY visit_count DESC LIMIT 10`
      ).bind(fromDate).all<{ first_name: string; last_name: string; organisation: string | null; visit_count: number; last_visit: string | null }>();

      if (!results.results?.length) return `No visits recorded in the last ${days} days.`;

      return `Top visitors — last ${days} days:\n` +
        (results.results ?? []).map((v, i) => {
          const last = v.last_visit ? new Date(v.last_visit).toLocaleDateString('en-GB') : 'N/A';
          return `${i + 1}. ${v.first_name} ${v.last_name}${v.organisation ? ` (${v.organisation})` : ''} — ${v.visit_count} visits, last: ${last}`;
        }).join('\n');
    }

    case 'HOST_LOAD': {
      const fromDate = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

      const [officer, stats] = await Promise.all([
        env.DB.prepare(
          `SELECT o.name, o.title, d.abbreviation as dir
           FROM officers o JOIN directorates d ON o.directorate_id = d.id
           WHERE o.name LIKE ? LIMIT 1`
        ).bind(`%${q}%`).first<{ name: string; title: string | null; dir: string }>(),

        env.DB.prepare(
          `SELECT COUNT(*) as visit_count, COUNT(DISTINCT v.visitor_id) as unique_visitors,
                  ROUND(AVG(v.duration_minutes)) as avg_duration
           FROM visits v JOIN officers o ON v.host_officer_id = o.id
           WHERE o.name LIKE ? AND DATE(v.check_in_at) >= ?`
        ).bind(`%${q}%`, fromDate).first<{ visit_count: number; unique_visitors: number; avg_duration: number | null }>(),
      ]);

      if (!officer) return `No officer found matching "${q}".`;

      return `${officer.name} (${officer.title || 'Officer'}, ${officer.dir}) — last 30 days:
Visits received: ${stats?.visit_count ?? 0}
Unique visitors: ${stats?.unique_visitors ?? 0}
Avg visit duration: ${stats?.avg_duration ?? 'N/A'} mins`;
    }

    // -----------------------------------------------------------------------
    // Analytics — Staff Attendance lookups
    // -----------------------------------------------------------------------
    case 'ATTENDANCE_TODAY': {
      const today = new Date().toISOString().slice(0, 10);
      const lateAfter = await getLateThreshold(env);

      const [total, present, late, absent] = await Promise.all([
        env.DB.prepare(
          `SELECT COUNT(*) as count FROM users WHERE is_active = 1 AND user_type = 'staff'`
        ).first<{ count: number }>(),

        env.DB.prepare(
          `SELECT COUNT(DISTINCT cr.user_id) as count FROM clock_records cr
           JOIN users u ON u.id = cr.user_id
           WHERE cr.type = 'clock_in' AND DATE(cr.timestamp) = ? AND u.user_type = 'staff'`
        ).bind(today).first<{ count: number }>(),

        env.DB.prepare(
          `SELECT COUNT(DISTINCT cr.user_id) as count FROM clock_records cr
           JOIN users u ON u.id = cr.user_id
           WHERE cr.type = 'clock_in' AND DATE(cr.timestamp) = ?
             AND TIME(cr.timestamp) > ? AND u.user_type = 'staff'`
        ).bind(today, lateAfter).first<{ count: number }>(),

        env.DB.prepare(
          `SELECT COUNT(*) as count FROM users u
           WHERE u.is_active = 1 AND u.user_type = 'staff'
             AND NOT EXISTS (
               SELECT 1 FROM clock_records cr
               WHERE cr.user_id = u.id AND cr.type = 'clock_in' AND DATE(cr.timestamp) = ?
             )`
        ).bind(today).first<{ count: number }>(),
      ]);

      const t = total?.count ?? 0;
      const p = present?.count ?? 0;
      const rate = t > 0 ? Math.round((p / t) * 100) : 0;

      return `Staff attendance today (${today}):
Total active staff: ${t}
Clocked in: ${p} (${rate}%)
Not yet clocked in: ${absent?.count ?? t - p}
Late arrivals (after ${lateAfter.slice(0, 5)}): ${late?.count ?? 0}`;
    }

    case 'ATTENDANCE_DATE': {
      const date = q || new Date().toISOString().slice(0, 10);
      const lateAfter = await getLateThreshold(env);

      const [total, present, late] = await Promise.all([
        env.DB.prepare(
          `SELECT COUNT(*) as count FROM users WHERE is_active = 1 AND user_type = 'staff'`
        ).first<{ count: number }>(),

        env.DB.prepare(
          `SELECT COUNT(DISTINCT cr.user_id) as count FROM clock_records cr
           JOIN users u ON u.id = cr.user_id
           WHERE cr.type = 'clock_in' AND DATE(cr.timestamp) = ? AND u.user_type = 'staff'`
        ).bind(date).first<{ count: number }>(),

        env.DB.prepare(
          `SELECT COUNT(DISTINCT cr.user_id) as count FROM clock_records cr
           JOIN users u ON u.id = cr.user_id
           WHERE cr.type = 'clock_in' AND DATE(cr.timestamp) = ?
             AND TIME(cr.timestamp) > ? AND u.user_type = 'staff'`
        ).bind(date, lateAfter).first<{ count: number }>(),
      ]);

      const t = total?.count ?? 0;
      const p = present?.count ?? 0;
      const rate = t > 0 ? Math.round((p / t) * 100) : 0;

      return `Staff attendance on ${date}:
Total active staff: ${t}
Present: ${p} (${rate}%)
Absent: ${t - p}
Late arrivals: ${late?.count ?? 0}`;
    }

    case 'ATTENDANCE_DIRECTORATE': {
      const date = q || new Date().toISOString().slice(0, 10);
      const lateAfter = await getLateThreshold(env);

      const results = await env.DB.prepare(
        `SELECT d.abbreviation, d.name,
                COUNT(DISTINCT u.id) as total_staff,
                COUNT(DISTINCT ci.user_id) as present,
                COUNT(DISTINCT CASE WHEN TIME(ci.timestamp) > ? THEN ci.user_id END) as late
         FROM directorates d
         LEFT JOIN users u ON u.directorate_id = d.id AND u.is_active = 1 AND u.user_type = 'staff'
         LEFT JOIN clock_records ci ON ci.user_id = u.id AND ci.type = 'clock_in' AND DATE(ci.timestamp) = ?
         WHERE d.is_active = 1
         GROUP BY d.id
         ORDER BY d.abbreviation`
      ).bind(lateAfter, date).all<{ abbreviation: string; name: string; total_staff: number; present: number; late: number }>();

      if (!results.results?.length) return `No data for ${date}.`;

      return `Directorate attendance on ${date}:\n` +
        (results.results ?? []).map(r => {
          const rate = r.total_staff > 0 ? Math.round((r.present / r.total_staff) * 100) : 0;
          const lateStr = r.late > 0 ? `, ${r.late} late` : '';
          return `  ${r.abbreviation}: ${r.present}/${r.total_staff} present (${rate}%)${lateStr}`;
        }).join('\n');
    }

    case 'ATTENDANCE_TRENDS': {
      const days = Math.min(Math.max(parseInt(q) || 30, 1), 365);
      const fromDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

      const [totalRow, dailyPresent] = await Promise.all([
        env.DB.prepare(
          `SELECT COUNT(*) as count FROM users WHERE is_active = 1 AND user_type = 'staff'`
        ).first<{ count: number }>(),

        env.DB.prepare(
          `SELECT DATE(cr.timestamp) as date, COUNT(DISTINCT cr.user_id) as present
           FROM clock_records cr JOIN users u ON u.id = cr.user_id
           WHERE cr.type = 'clock_in' AND DATE(cr.timestamp) >= ? AND u.user_type = 'staff'
           GROUP BY date ORDER BY date ASC`
        ).bind(fromDate).all<{ date: string; present: number }>(),
      ]);

      const total = totalRow?.count ?? 0;
      const rows = dailyPresent.results ?? [];

      if (!rows.length) return `No clock records found in the last ${days} days.`;

      const avgPresent = Math.round(rows.reduce((s, r) => s + r.present, 0) / rows.length);
      const avgRate = total > 0 ? Math.round((avgPresent / total) * 100) : 0;
      const best = rows.reduce((a, b) => b.present > a.present ? b : a, rows[0]!);
      const worst = rows.reduce((a, b) => b.present < a.present ? b : a, rows[0]!);

      const recentLines = rows.slice(-7).map(r => {
        const rate = total > 0 ? Math.round((r.present / total) * 100) : 0;
        return `  ${r.date}: ${r.present}/${total} (${rate}%)`;
      }).join('\n');

      return `Attendance trends — last ${days} days (from ${fromDate}):
Total active staff: ${total}
Avg daily attendance: ${avgPresent} (${avgRate}%)
Best day: ${best.date} — ${best.present} present
Worst day: ${worst.date} — ${worst.present} present
Most recent 7 days:\n${recentLines}`;
    }

    case 'STAFF_ABSENT': {
      const date = q || new Date().toISOString().slice(0, 10);

      const results = await env.DB.prepare(
        `SELECT u.name, u.staff_id, d.abbreviation as dir
         FROM users u
         LEFT JOIN directorates d ON u.directorate_id = d.id
         WHERE u.is_active = 1 AND u.user_type = 'staff'
           AND NOT EXISTS (
             SELECT 1 FROM clock_records cr
             WHERE cr.user_id = u.id AND cr.type = 'clock_in' AND DATE(cr.timestamp) = ?
           )
         ORDER BY d.abbreviation, u.name LIMIT 20`
      ).bind(date).all<{ name: string; staff_id: string | null; dir: string | null }>();

      if (!results.results?.length) return `All active staff clocked in on ${date} (or no records for that date).`;

      const lines = (results.results ?? []).map(u =>
        `  ${u.name}${u.staff_id ? ` [${u.staff_id}]` : ''} — ${u.dir || 'No directorate'}`
      ).join('\n');
      const count = results.results?.length ?? 0;
      const suffix = count >= 20 ? '\n  (showing first 20 — there may be more)' : '';

      return `Staff absent on ${date}:\n${lines}${suffix}`;
    }

    default:
      return 'Unknown lookup type.';
  }
}

function stripLookups(text: string): string {
  return text.replace(LOOKUP_PATTERN, '').replace(/\n{3,}/g, '\n\n').trim();
}

function isAnalyticsRole(role?: string): boolean {
  return role === 'superadmin' || role === 'admin';
}

async function buildSystemPrompt(env: Env, role?: string): Promise<string> {
  const directory = await buildLiveDirectory(env);
  const prompt = isAnalyticsRole(role) ? buildAnalyticsPrompt() : BASE_PROMPT;
  return `${prompt}\n\n${directory}`;
}

/**
 * Run the multi-lookup loop and return the final text (non-streaming).
 * Used by /chat (backward compat) and the eval harness.
 */
export async function chat(userMessages: ChatMessage[], env: Env, role?: string): Promise<string> {
  const systemPrompt = await buildSystemPrompt(env, role);
  const maxTokens = isAnalyticsRole(role) ? MAX_TOKENS_ANALYTICS : MAX_TOKENS_RECEPTIONIST;
  let messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...userMessages.slice(-10),
  ];

  for (let round = 0; round < MAX_LOOKUP_ROUNDS; round++) {
    const response = await env.AI.run(MODEL, { messages, max_tokens: maxTokens });
    const reply = ((response as { response?: string }).response ?? '').trim();

    const matches = [...reply.matchAll(LOOKUP_PATTERN)];
    if (matches.length === 0) return reply;

    const results = await Promise.all(
      matches.map(m => executeLookup(m[1]!, (m[2] ?? '').trim(), env)),
    );
    const lookupText = matches.map((m, i) => `${m[0]}\n${results[i]}`).join('\n\n');

    messages = [
      ...messages,
      { role: 'assistant', content: reply },
      { role: 'system', content: `Lookup results:\n${lookupText}\n\nNow respond to the user using this data. Be concise. Do NOT emit more LOOKUP commands unless absolutely necessary.` },
    ];
  }

  // Hit round cap — return last response minus lookup commands
  const last = messages[messages.length - 2];
  if (last && last.role === 'assistant') return stripLookups(last.content);
  return 'Sorry, I could not complete that request.';
}

/**
 * Stream the final response as SSE. First run the lookup loop non-streaming,
 * then stream the final AI call to the client.
 * Returns a ReadableStream suitable for a text/event-stream Response.
 */
export async function chatStream(userMessages: ChatMessage[], env: Env, role?: string): Promise<ReadableStream<Uint8Array>> {
  const systemPrompt = await buildSystemPrompt(env, role);
  const maxTokens = isAnalyticsRole(role) ? MAX_TOKENS_ANALYTICS : MAX_TOKENS_RECEPTIONIST;
  let messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...userMessages.slice(-10),
  ];

  // Run lookup loop non-streaming until we have a final-answer message to stream
  let finalMessages: ChatMessage[] | null = null;
  let cachedReply: string | null = null;

  for (let round = 0; round < MAX_LOOKUP_ROUNDS; round++) {
    const response = await env.AI.run(MODEL, { messages, max_tokens: maxTokens });
    const reply = ((response as { response?: string }).response ?? '').trim();

    const matches = [...reply.matchAll(LOOKUP_PATTERN)];
    if (matches.length === 0) {
      cachedReply = reply;
      break;
    }

    const results = await Promise.all(
      matches.map(m => executeLookup(m[1]!, (m[2] ?? '').trim(), env)),
    );
    const lookupText = matches.map((m, i) => `${m[0]}\n${results[i]}`).join('\n\n');

    messages = [
      ...messages,
      { role: 'assistant', content: reply },
      { role: 'system', content: `Lookup results:\n${lookupText}\n\nNow respond to the user using this data. Be concise. Do NOT emit more LOOKUP commands.` },
    ];
    finalMessages = messages;
  }

  const encoder = new TextEncoder();

  // Case 1: cached final text — emit as a single event
  if (cachedReply !== null) {
    const replyText = cachedReply;
    return new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: replyText })}\n\n`));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
  }

  // Case 2: lookups were done — stream the final AI call
  if (!finalMessages) {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: 'Sorry, I could not complete that request.' })}\n\n`));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
  }

  const aiResponse = await env.AI.run(MODEL, {
    messages: finalMessages,
    max_tokens: maxTokens,
    stream: true,
  }) as unknown as ReadableStream<Uint8Array>;

  // Transform Workers-AI SSE (`data: {"response":"..."}`) into our `data: {"text":"..."}` format.
  return new ReadableStream({
    async start(controller) {
      const reader = aiResponse.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const json = JSON.parse(data) as { response?: string };
              if (json.response) {
                const safe = json.response.replace(LOOKUP_PATTERN, '');
                if (safe) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: safe })}\n\n`));
                }
              }
            } catch { /* skip malformed chunk */ }
          }
        }
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });
}
