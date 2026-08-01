import { describe, it, expect } from 'vitest';
import { generateCSV } from './csv';

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
