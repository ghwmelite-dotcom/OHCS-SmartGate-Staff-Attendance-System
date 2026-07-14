import type { Directorate } from '@/lib/api';

export type DirectorateOption = Pick<Directorate, 'id' | 'name' | 'abbreviation'>;

export const ROUTING_KEYWORDS: Array<{ keywords: string[]; abbreviation: string; room: string }> = [
  { keywords: ['document', 'submit', 'filing', 'registry', 'confidential'], abbreviation: 'REGISTRY', room: 'Room 4, 2nd Floor' },
  { keywords: ['salary', 'e-spar', 'espar', 'spar', 'ict', 'it system', 'computer', 'software', 'technology', 'research', 'data', 'statistics', 'survey', 'database', 'e-governance'], abbreviation: 'RSIMD', room: 'Room 19 & 21, 1st Floor' },
  { keywords: ['recruit', 'job', 'application', 'hiring', 'training', 'workshop', 'study leave', 'scholarship', 'capacity', 'induction', 'gimpa', 'entrance exam'], abbreviation: 'RTDD', room: 'Deputy: Room 9, 2nd Floor' },
  { keywords: ['promotion', 'posting', 'transfer', 'career', 'succession', 'welfare', 'occupational health'], abbreviation: 'CMD', room: 'Deputy: Room 34, 1st Floor' },
  { keywords: ['budget', 'payment', 'finance', 'account', 'procurement', 'stores', 'transport', 'vehicle', 'estate', 'maintenance', 'asset', 'personnel'], abbreviation: 'F&A', room: 'Deputy: Room 35, 1st Floor' },
  { keywords: ['performance', 'appraisal', 'monitoring', 'evaluation', 'service delivery', 'client service', 'development plan'], abbreviation: 'PBMED', room: 'Deputy: Room 31, 1st Floor' },
  { keywords: ['complaint', 'petition', 'disciplinary', 'council', 'civil service council'], abbreviation: 'CSC', room: 'Rooms 24, 44' },
  { keywords: ['reform', 'anti-corruption', 'nacap', 'right to information', 'rti'], abbreviation: 'RCU', room: '' },
  { keywords: ['audit', 'fraud', 'internal audit', 'compliance', 'risk'], abbreviation: 'IAU', room: '' },
];

type GroupableDir = { id: string; name: string; abbreviation: string; type: string; org_type?: string | null };

const CATEGORY_LABELS: Record<string, string> = {
  directorate: 'Directorates',
  unit: 'Units',
};
const CATEGORY_ORDER = ['directorate', 'unit'];

export function groupDirectorates<T extends GroupableDir>(
  directorates: T[]
): Array<{ label: string; items: T[] }> {
  const buckets = new Map<string, T[]>();
  for (const d of directorates) {
    const key = d.org_type ?? d.type;
    const bucket = buckets.get(key) ?? [];
    bucket.push(d);
    buckets.set(key, bucket);
  }
  const result: Array<{ label: string; items: T[] }> = [];
  for (const key of CATEGORY_ORDER) {
    const items = buckets.get(key);
    if (items?.length) { result.push({ label: CATEGORY_LABELS[key] ?? key, items }); buckets.delete(key); }
  }
  const others = [...buckets.values()].flat();
  if (others.length) result.push({ label: 'Other Offices', items: others });
  return result;
}

export function suggestDirectorate(purpose: string, directorates: DirectorateOption[]): DirectorateOption | null {
  if (!purpose || purpose.length < 3) return null;
  const lower = purpose.toLowerCase();
  for (const route of ROUTING_KEYWORDS) {
    if (route.keywords.some((kw) => lower.includes(kw))) {
      return directorates.find((d) => d.abbreviation === route.abbreviation) ?? null;
    }
  }
  return null;
}
