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

export function generateCSV(visits: VisitRow[]): string {
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

  const csvContent = [headers, ...rows]
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
