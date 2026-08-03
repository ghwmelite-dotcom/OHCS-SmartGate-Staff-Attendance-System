interface VisitRow {
  check_in_at: string;
  check_out_at: string | null;
  duration_minutes: number | null;
  status: string;
  badge_code: string | null;
  purpose_raw: string | null;
  first_name: string;
  last_name: string;
  organisation: string | null;
  host_name: string | null;
  directorate_abbr: string | null;
}

// RFC4180 quoting + Excel formula-injection guard: cells whose first
// character is =, +, -, @, tab or CR execute as formulas when opened in a
// spreadsheet, so prefix them with a single quote; embedded double quotes
// are doubled. Used by every CSV export (visit report, feedback, etc.).
export function formatCsvCell(cell: string): string {
  const guarded = /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function generateCSV(visits: VisitRow[], note?: string): string {
  const headers = [
    'Date', 'Visitor Name', 'Organisation', 'Host Officer', 'Directorate',
    'Purpose', 'Check In', 'Check Out', 'Duration (min)', 'Status', 'Badge Code',
  ];

  const rows = visits.map(v => [
    new Date(v.check_in_at).toLocaleDateString('en-GB'),
    `${v.first_name} ${v.last_name}`,
    v.organisation ?? '',
    v.host_name ?? '',
    v.directorate_abbr ?? '',
    (v.purpose_raw ?? '').replace(/,/g, ';'),
    new Date(v.check_in_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
    v.check_out_at ? new Date(v.check_out_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '',
    v.duration_minutes?.toString() ?? '',
    v.status.replace('_', ' '),
    v.badge_code ?? '',
  ]);

  // Truncation marker rides as a leading single-cell line so a capped export
  // can't masquerade as a complete one.
  const lines: string[][] = note ? [[note], headers, ...rows] : [headers, ...rows];
  const csvContent = lines
    .map(row => row.map(formatCsvCell).join(','))
    .join('\n');

  return csvContent;
}

export function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/* ---------- Attendance range export (GET /attendance/export, 2026-08-03) ---------- */

// One row per user × day — mirrors the /attendance/export API contract.
export interface AttendanceExportRow {
  date: string;
  user_id: string;
  name: string;
  identifier: string | null;
  directorate_abbr: string | null;
  clock_in_time: string | null;
  clock_out_time: string | null;
  is_late: number;
  is_early_departure: number;
  presence_method: string | null;
  absence_reason: string | null;
  absence_note: string | null;
  has_photo: number;
}

// Single-date rows carry a photo path; range rows carry a 0|1 flag. Both
// collapse to the same Y/N export cell.
export function hasPhotoYN(value: string | number | null | undefined): 'Y' | 'N' {
  return value !== null && value !== undefined && value !== 0 && value !== '' ? 'Y' : 'N';
}

function csvTime(iso: string | null): string {
  if (!iso) return 'Absent';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function generateAttendanceRangeCSV(rows: AttendanceExportRow[], note?: string): string {
  const headers = [
    'Date', 'Name', 'Identifier', 'Directorate', 'Clock In', 'Clock Out',
    'Late', 'Left Early', 'Presence Method', 'Absence Reason', 'Absence Note', 'Has Photo',
  ];
  const data = rows.map(r => [
    r.date,
    r.name,
    r.identifier ?? '',
    r.directorate_abbr ?? '',
    csvTime(r.clock_in_time),
    r.clock_out_time ? csvTime(r.clock_out_time) : '',
    r.is_late ? 'Yes' : 'No',
    r.is_early_departure ? 'Yes' : 'No',
    r.presence_method ?? '',
    r.absence_reason ?? '',
    r.absence_note ?? '',
    hasPhotoYN(r.has_photo),
  ]);
  const lines: string[][] = note ? [[note], headers, ...data] : [headers, ...data];
  return lines.map(row => row.map(formatCsvCell).join(',')).join('\n');
}
