import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from '@/stores/toast';
import { cn } from '@/lib/utils';
import { Upload, Download, FileSpreadsheet, CheckCircle2, AlertCircle, Users, Building2, UserPlus, Sparkles, GraduationCap, Briefcase, KeyRound } from 'lucide-react';

type ImportType = 'users' | 'directorates' | 'officers' | 'nss' | 'interns';

type PinRecord = { row: number; name: string; email: string; identifier: string; initial_pin: string };

type ImportResponse = {
  imported: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
  pins?: PinRecord[];
};

const TEMPLATES: Record<ImportType, { label: string; icon: typeof Users; headers: string[]; optionalHeaders?: string[]; example: string[]; description: string }> = {
  users: {
    label: 'Users',
    icon: Users,
    headers: ['name', 'email', 'staff_id', 'pin', 'role', 'grade', 'directorate_code'],
    example: ['Kwame Mensah', 'k.mensah@ohcs.gov.gh', '12345', '1234', 'staff', 'Snr IT/IM Technician', 'RSIMD'],
    description: 'Import users. Roles: superadmin, admin, receptionist, it, director, staff. Grade = job designation. Directorate code must match existing abbreviation.',
  },
  directorates: {
    label: 'Directorates & Units',
    icon: Building2,
    headers: ['name', 'abbreviation', 'type', 'rooms'],
    optionalHeaders: ['floor', 'wing'],
    example: ['Career Management Directorate', 'CMD', 'directorate', '33, 34', '3rd Floor', 'East'],
    description: 'Import org entities. Types: directorate, secretariat, unit. floor & wing are optional and print as the "Location" line on visitor badges.',
  },
  officers: {
    label: 'Officers',
    icon: UserPlus,
    headers: ['name', 'title', 'directorate_code', 'email', 'phone', 'office_number'],
    optionalHeaders: ['staff_id'],
    example: ['Mr. Kwame Mensah', 'Director', 'RSIMD', 'k.mensah@ohcs.gov.gh', '0241234567', 'Room 19', '1334685'],
    description: 'Import officers. directorate_code must match an existing directorate abbreviation. staff_id (optional) auto-creates a Staff Attendance login — initial PIN is the last 4 digits of the staff ID.',
  },
  nss: {
    label: 'NSS Personnel',
    icon: GraduationCap,
    headers: ['name', 'email', 'nss_number', 'nss_start_date', 'nss_end_date', 'directorate_code'],
    optionalHeaders: ['grade'],
    example: ['Kwame Asante', 'k.asante@ohcs.gov.gh', 'NSSGUE8364724', '2025-09-01', '2026-08-31', 'RSIMD', 'National Service Personnel'],
    description: 'Import NSS service personnel. nss_number format: NSS + 3 letters + 7 digits (e.g. NSSGUE8364724). Dates in YYYY-MM-DD. A 6-digit initial PIN is auto-generated — download the credentials after import.',
  },
  interns: {
    label: 'Interns',
    icon: Briefcase,
    headers: ['name', 'email', 'nss_start_date', 'nss_end_date', 'directorate_code'],
    optionalHeaders: ['institution', 'programme', 'grade'],
    example: ['Ama Boateng', 'a.boateng@gmail.com', '2025-09-01', '2026-02-28', 'HRM', 'University of Ghana', 'BSc Administration', 'Intern'],
    description: 'Import interns. Intern codes are auto-generated (OHCS-INT-YYYY-NNN). Dates in YYYY-MM-DD. A 6-digit initial PIN is auto-generated — download the credentials after import.',
  },
};

function downloadTemplate(type: ImportType) {
  const tmpl = TEMPLATES[type];
  const allHeaders = [...tmpl.headers, ...(tmpl.optionalHeaders ?? [])];
  const csv = [allHeaders.join(','), tmpl.example.join(',')].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `smartgate-${type}-template.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadCredentials(pins: PinRecord[], type: 'nss' | 'interns') {
  const identifierLabel = type === 'nss' ? 'nss_number' : 'intern_code';
  const header = ['name', 'email', identifierLabel, 'initial_pin'].join(',');
  const rows = pins.map(p => [
    `"${p.name.replace(/"/g, '""')}"`,
    p.email,
    p.identifier,
    p.initial_pin,
  ].join(','));
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `smartgate-${type}-credentials-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function parseCSV(text: string): string[][] {
  return text.trim().split('\n').map(line => {
    const row: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === ',' && !inQuotes) { row.push(current.trim()); current = ''; }
      else { current += ch; }
    }
    row.push(current.trim());
    return row;
  });
}

function csvToObjects(rows: string[][], headers: string[]): Record<string, string>[] {
  return rows.slice(1).filter(r => r.some(c => c.length > 0)).map(row => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
    return obj;
  });
}

export function BulkImportTab() {
  const queryClient = useQueryClient();
  const [importType, setImportType] = useState<ImportType>('users');
  const [previewData, setPreviewData] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState('');
  const [credentials, setCredentials] = useState<{ type: 'nss' | 'interns'; pins: PinRecord[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const tmpl = TEMPLATES[importType];
  const allHeaders = [...tmpl.headers, ...(tmpl.optionalHeaders ?? [])];

  const provisionMutation = useMutation({
    mutationFn: () =>
      api.post<{ provisioned: number; skipped: number; skipped_details: string[] }>(
        '/users/provision-from-officers', {}
      ),
    onSuccess: (res) => {
      const data = res.data;
      if (data) {
        if (data.provisioned > 0) {
          toast.success(`${data.provisioned} Staff Attendance account${data.provisioned !== 1 ? 's' : ''} created`);
        } else {
          toast.success('All officers with staff IDs already have accounts');
        }
        if (data.skipped > 0) {
          toast.error(`${data.skipped} skipped (email conflicts) — check details`);
        }
      }
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const importMutation = useMutation({
    mutationFn: (rows: Record<string, string>[]) =>
      api.post<ImportResponse>(`/admin/import/${importType}`, { rows }),
    onSuccess: (res) => {
      const data = res.data;
      if (data) {
        toast.success(`Imported ${data.imported} ${importType}, ${data.skipped} skipped`);
        if (data.errors.length > 0) {
          data.errors.slice(0, 3).forEach(e => toast.error(`Row ${e.row}: ${e.message}`));
        }
        if (data.pins && data.pins.length > 0 && (importType === 'nss' || importType === 'interns')) {
          setCredentials({ type: importType, pins: data.pins });
        }
      }
      setPreviewData([]);
      setFileName('');
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['directorates-admin'] });
      queryClient.invalidateQueries({ queryKey: ['officers-admin'] });
    },
  });

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setCredentials(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      const rows = parseCSV(text);

      if (rows.length < 2) {
        toast.error('CSV file is empty or has only headers');
        return;
      }

      const fileHeaders = rows[0]!.map(h => h.toLowerCase().replace(/\s+/g, '_'));
      const expectedHeaders = tmpl.headers;
      const headersMatch = expectedHeaders.every(h => fileHeaders.includes(h));

      if (!headersMatch) {
        toast.error(`CSV headers don't match. Expected: ${expectedHeaders.join(', ')}`);
        return;
      }

      const objects = csvToObjects(rows, fileHeaders);
      setPreviewData(objects);
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function switchType(type: ImportType) {
    setImportType(type);
    setPreviewData([]);
    setFileName('');
    setCredentials(null);
  }

  const identifierLabel = importType === 'nss' ? 'NSS Number' : 'Intern Code';

  return (
    <div className="space-y-6">
      {/* Import type selector */}
      <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E 50%, #D4A017)' }} />
        <div className="p-6 space-y-5">
          <div className="flex items-center gap-2.5">
            <Upload className="h-5 w-5 text-primary" />
            <h3 className="text-base font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
              Bulk Import
            </h3>
          </div>

          {/* Type tabs */}
          <div className="flex gap-2 flex-wrap">
            {(Object.entries(TEMPLATES) as [ImportType, typeof TEMPLATES[ImportType]][]).map(([key, val]) => (
              <button
                key={key}
                onClick={() => switchType(key)}
                className={cn(
                  'inline-flex items-center gap-2 h-10 px-4 rounded-xl text-[14px] font-medium border transition-all',
                  importType === key
                    ? 'bg-primary text-white border-primary shadow-sm'
                    : 'bg-surface text-foreground border-border hover:border-primary/30'
                )}
              >
                <val.icon className="h-4 w-4" />
                {val.label}
              </button>
            ))}
          </div>

          <p className="text-[14px] text-muted">{tmpl.description}</p>

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => downloadTemplate(importType)}
              className="inline-flex items-center gap-2 h-10 px-5 bg-surface text-foreground text-[14px] font-medium rounded-xl border border-border hover:border-accent/40 transition-all"
            >
              <Download className="h-4 w-4 text-accent-warm" />
              Download Template
            </button>

            <button
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-2 h-10 px-5 bg-primary text-white text-[14px] font-semibold rounded-xl hover:bg-primary-light transition-all shadow-sm"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Upload CSV
            </button>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />

            {fileName && (
              <span className="self-center text-[13px] text-muted">{fileName}</span>
            )}
          </div>

          {/* Provision button — only shown on the Officers tab */}
          {importType === 'officers' && (
            <div className="mt-2 p-4 rounded-xl bg-background border border-border">
              <div className="flex items-start gap-3">
                <Sparkles className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-foreground">Provision Staff Attendance Accounts</p>
                  <p className="text-[13px] text-muted mt-0.5">
                    Creates login accounts for all officers who have a Staff ID but no Staff Attendance account yet.
                    Initial PIN = last 4 digits of staff ID. Staff set their own PIN on first login.
                  </p>
                  {provisionMutation.data?.data && (
                    <div className="mt-2 flex items-center gap-2 text-[13px]">
                      <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                      <span className="text-success font-medium">
                        {provisionMutation.data.data.provisioned} created · {provisionMutation.data.data.skipped} skipped
                      </span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => provisionMutation.mutate()}
                  disabled={provisionMutation.isPending}
                  className="inline-flex items-center gap-2 h-9 px-4 bg-primary text-white text-[13px] font-semibold rounded-xl hover:bg-primary-light disabled:opacity-50 shadow-sm transition-all shrink-0"
                >
                  <Sparkles className="h-4 w-4" />
                  {provisionMutation.isPending ? 'Provisioning…' : 'Provision All'}
                </button>
              </div>
            </div>
          )}

          {/* PIN notice for NSS/intern imports */}
          {(importType === 'nss' || importType === 'interns') && (
            <div className="mt-2 p-4 rounded-xl bg-background border border-border">
              <div className="flex items-start gap-3">
                <KeyRound className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-[14px] font-semibold text-foreground">Auto-generated PINs</p>
                  <p className="text-[13px] text-muted mt-0.5">
                    Each {importType === 'nss' ? 'NSS personnel' : 'intern'} receives a unique 6-digit initial PIN.
                    After import, a credential summary appears — download it before leaving this page.
                    PINs are one-time visible and cannot be retrieved again.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Credential summary — shown after successful NSS/intern import */}
      {credentials && (
        <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden animate-fade-in-up">
          <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #22c55e, #4ade80 50%, #22c55e)' }} />
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <KeyRound className="h-5 w-5 text-success" />
              <div>
                <h3 className="text-[15px] font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
                  Credential Summary — {credentials.pins.length} {credentials.type === 'nss' ? 'NSS personnel' : 'intern'}{credentials.pins.length !== 1 ? 's' : ''}
                </h3>
                <p className="text-[13px] text-danger font-medium">Download now — initial PINs cannot be retrieved again</p>
              </div>
            </div>
            <button
              onClick={() => downloadCredentials(credentials.pins, credentials.type)}
              className="inline-flex items-center gap-2 h-9 px-4 bg-success text-white text-[13px] font-semibold rounded-xl hover:opacity-90 shadow-sm transition-all"
            >
              <Download className="h-4 w-4" />
              Download CSV
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-background/50">
                  <th className="text-left px-5 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-wide">#</th>
                  <th className="text-left px-5 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-wide">Name</th>
                  <th className="text-left px-5 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-wide">Email</th>
                  <th className="text-left px-5 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-wide">{identifierLabel}</th>
                  <th className="text-left px-5 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-wide">Initial PIN</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {credentials.pins.map((p) => (
                  <tr key={p.row} className="hover:bg-background-warm/50 transition-colors">
                    <td className="px-5 py-2.5 text-[13px] text-muted font-mono">{p.row}</td>
                    <td className="px-5 py-2.5 text-[14px] text-foreground font-medium">{p.name}</td>
                    <td className="px-5 py-2.5 text-[13px] text-muted">{p.email}</td>
                    <td className="px-5 py-2.5 text-[13px] font-mono text-foreground">{p.identifier}</td>
                    <td className="px-5 py-2.5">
                      <span className="font-mono text-[15px] font-bold text-primary tracking-widest">{p.initial_pin}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Preview table */}
      {previewData.length > 0 && (
        <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden animate-fade-in-up">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div>
              <h3 className="text-[15px] font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
                Preview — {previewData.length} row{previewData.length !== 1 ? 's' : ''}
              </h3>
              <p className="text-[13px] text-muted">Review the data before importing</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setPreviewData([]); setFileName(''); }}
                className="h-9 px-4 text-[13px] font-medium text-muted border border-border rounded-xl hover:text-foreground transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => importMutation.mutate(previewData)}
                disabled={importMutation.isPending}
                className="inline-flex items-center gap-2 h-9 px-5 bg-primary text-white text-[13px] font-semibold rounded-xl hover:bg-primary-light disabled:opacity-50 shadow-sm transition-all"
              >
                {importMutation.isPending ? 'Importing...' : `Import ${previewData.length} Rows`}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-background/50">
                  <th className="text-left px-5 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-wide">#</th>
                  {allHeaders.map(h => (
                    <th key={h} className="text-left px-5 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-wide">
                      {h.replace(/_/g, ' ')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {previewData.slice(0, 50).map((row, i) => (
                  <tr key={i} className="hover:bg-background-warm/50 transition-colors">
                    <td className="px-5 py-2.5 text-[13px] text-muted font-mono">{i + 1}</td>
                    {allHeaders.map(h => (
                      <td key={h} className="px-5 py-2.5 text-[14px] text-foreground">
                        {h === 'pin'
                          ? (row[h] ? <span className="font-mono tracking-widest">••••</span> : <span className="text-muted-foreground italic">empty</span>)
                          : (row[h] || <span className="text-muted-foreground italic">empty</span>)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {previewData.length > 50 && (
              <div className="px-5 py-3 text-center text-[13px] text-muted border-t border-border">
                Showing first 50 of {previewData.length} rows
              </div>
            )}
          </div>

          {/* Import result */}
          {importMutation.isSuccess && importMutation.data?.data && (
            <div className="px-6 py-4 border-t border-border bg-success-light/30">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-success" />
                <span className="text-[14px] font-medium text-success">
                  {importMutation.data.data.imported} imported, {importMutation.data.data.skipped} skipped
                </span>
              </div>
              {importMutation.data.data.errors.length > 0 && (
                <div className="mt-2 space-y-1">
                  {importMutation.data.data.errors.map((e, i) => (
                    <div key={i} className="flex items-center gap-2 text-[13px] text-danger">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      Row {e.row}: {e.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
