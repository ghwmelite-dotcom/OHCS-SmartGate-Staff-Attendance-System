import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from '@/stores/toast';
import { cn } from '@/lib/utils';
import { Upload, Download, FileSpreadsheet, CheckCircle2, AlertCircle, Users, Building2, UserPlus } from 'lucide-react';

type ImportType = 'users' | 'directorates' | 'officers';

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
    example: ['Mr. Kwame Mensah', 'Director', 'RSIMD', 'k.mensah@ohcs.gov.gh', '0241234567', 'Room 19'],
    description: 'Import officers. directorate_code must match an existing directorate abbreviation',
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
  const fileRef = useRef<HTMLInputElement>(null);

  const tmpl = TEMPLATES[importType];
  const allHeaders = [...tmpl.headers, ...(tmpl.optionalHeaders ?? [])];

  const importMutation = useMutation({
    mutationFn: (rows: Record<string, string>[]) =>
      api.post<{ imported: number; skipped: number; errors: Array<{ row: number; message: string }> }>(
        `/admin/import/${importType}`, { rows }
      ),
    onSuccess: (res) => {
      const data = res.data;
      if (data) {
        toast.success(`Imported ${data.imported} ${importType}, ${data.skipped} skipped`);
        if (data.errors.length > 0) {
          data.errors.slice(0, 3).forEach(e => toast.error(`Row ${e.row}: ${e.message}`));
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

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      const rows = parseCSV(text);

      if (rows.length < 2) {
        toast.error('CSV file is empty or has only headers');
        return;
      }

      // Check if headers match
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
    // Reset input so same file can be re-selected
    e.target.value = '';
  }

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
                onClick={() => { setImportType(key); setPreviewData([]); setFileName(''); }}
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
        </div>
      </div>

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
                        {row[h] || <span className="text-muted-foreground italic">empty</span>}
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
