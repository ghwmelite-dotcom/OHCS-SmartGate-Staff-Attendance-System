import { describe, it, expect } from 'vitest';
import { generateCSV, generateAttendanceRangeCSV, hasPhotoYN, type AttendanceExportRow } from './csv';

// Audit fix 2026-08-01: CSV cells must not break out of quoting (RFC4180
// doubled quotes) and must not execute as formulas when opened in Excel
// (leading =, +, -, @, tab, CR get a single-quote prefix).

const baseRow = {
  check_in_at: '2026-08-01T09:00:00Z',
  check_out_at: null,
  duration_minutes: null,
  status: 'checked_in',
  badge_code: null,
  purpose_raw: null,
  first_name: 'Ama',
  last_name: 'Serwaa',
  organisation: null,
  host_name: null,
  directorate_abbr: null,
};

function dataLine(csv: string): string {
  return csv.split('\n')[1]!;
}

describe('generateCSV — formula-injection guard', () => {
  it('prefixes cells starting with = with a single quote', () => {
    const csv = generateCSV([{ ...baseRow, first_name: '=1+1', last_name: 'x' }]);
    expect(dataLine(csv)).toContain(`"'=1+1 x"`);
  });

  it('guards leading @, +, -, and tab', () => {
    const csv = generateCSV([{
      ...baseRow,
      purpose_raw: '@everyone',
      organisation: '+233',
      badge_code: '-1',
      host_name: '\tEASY',
    }]);
    const line = dataLine(csv);
    expect(line).toContain(`"'@everyone"`);
    expect(line).toContain(`"'+233"`);
    expect(line).toContain(`"'-1"`);
    expect(line).toContain(`"'\tEASY"`);
  });

  it('guards a leading carriage return', () => {
    const csv = generateCSV([{ ...baseRow, purpose_raw: '\rHIDE' }]);
    expect(dataLine(csv)).toContain(`"'\rHIDE"`);
  });

  it('leaves normal cells untouched', () => {
    const csv = generateCSV([{ ...baseRow, organisation: 'Ministry of Health' }]);
    expect(dataLine(csv)).toContain('"Ministry of Health"');
    expect(dataLine(csv)).not.toContain(`"'Ministry`);
  });
});

describe('generateCSV — RFC4180 quote escaping', () => {
  it('doubles embedded double quotes', () => {
    const csv = generateCSV([{ ...baseRow, organisation: 'He said "hi"' }]);
    expect(dataLine(csv)).toContain('"He said ""hi"""');
  });

  it('keeps a lone-quote cell inside its field', () => {
    const csv = generateCSV([{ ...baseRow, first_name: 'O"Brien', last_name: 'x' }]);
    expect(dataLine(csv)).toContain('"O""Brien x"');
  });
});

/* ---------- Attendance range export CSV (2026-08-03) ---------- */

const exportRow: AttendanceExportRow = {
  date: '2026-08-03',
  user_id: 'u1',
  name: 'Ama Serwaa',
  identifier: 'STF-001',
  directorate_abbr: 'RSIMD',
  clock_in_time: '2026-08-03T07:55:00Z',
  clock_out_time: '2026-08-03T17:05:00Z',
  is_late: 0,
  is_early_departure: 0,
  presence_method: 'qr',
  absence_reason: null,
  absence_note: null,
  has_photo: 1,
};

describe('hasPhotoYN', () => {
  it('maps 1 / a photo path to Y', () => {
    expect(hasPhotoYN(1)).toBe('Y');
    expect(hasPhotoYN('clock-photos/u1/2026-08-03.jpg')).toBe('Y');
  });

  it('maps 0 / null / empty to N', () => {
    expect(hasPhotoYN(0)).toBe('N');
    expect(hasPhotoYN(null)).toBe('N');
    expect(hasPhotoYN('')).toBe('N');
  });
});

describe('generateAttendanceRangeCSV', () => {
  it('emits all contract columns in order', () => {
    const csv = generateAttendanceRangeCSV([exportRow]);
    const header = csv.split('\n')[0]!;
    expect(header).toBe(
      '"Date","Name","Identifier","Directorate","Clock In","Clock Out","Late","Left Early","Presence Method","Absence Reason","Absence Note","Has Photo"',
    );
  });

  it('maps has_photo 1/0 to Y/N in the Has Photo column', () => {
    const withPhoto = generateAttendanceRangeCSV([exportRow]).split('\n')[1]!;
    expect(withPhoto.endsWith(',"Y"')).toBe(true);
    const without = generateAttendanceRangeCSV([{ ...exportRow, has_photo: 0 }]).split('\n')[1]!;
    expect(without.endsWith(',"N"')).toBe(true);
  });

  it('renders absent rows with Absent in/out, empty absence fields when null', () => {
    const csv = generateAttendanceRangeCSV([{
      ...exportRow,
      clock_in_time: null,
      clock_out_time: null,
      absence_reason: 'leave',
      absence_note: 'Approved',
    }]);
    const line = csv.split('\n')[1]!;
    expect(line).toContain('"Absent"');
    expect(line).toContain('"leave"');
    expect(line).toContain('"Approved"');
  });

  it('applies the formula-injection guard to export cells', () => {
    const csv = generateAttendanceRangeCSV([{ ...exportRow, absence_note: '=cmd' }]);
    expect(csv.split('\n')[1]!).toContain(`"'=cmd"`);
  });
});
