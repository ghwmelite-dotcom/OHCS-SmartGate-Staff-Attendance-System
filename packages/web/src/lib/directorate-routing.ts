import type { Directorate } from '@/lib/api';

export type DirectorateOption = Pick<Directorate, 'id' | 'name' | 'abbreviation'>;

// Routing rules for the purpose-of-visit suggestion card.
// Matching: case-insensitive substring. Score = keywords matched; highest wins.
// Multi-word phrases naturally score higher when both words appear — no special weighting needed.
// Order only matters for ties (put higher-traffic offices first).
export const ROUTING_KEYWORDS: Array<{ keywords: string[]; abbreviation: string; room: string }> = [
  // ── CMD — career, postings, leave, retirement ─────────────────────────────
  {
    abbreviation: 'CMD',
    room: 'Room 3, 2nd Fl · Deputy: Room 34, 1st Fl',
    keywords: [
      'promotion', 'posting', 'transfer', 'career', 'succession',
      'occupational health', 'confirmation', 'appointment letter',
      'annual leave', 'sick leave', 'leave application', 'leave form',
      'retirement', 'discipline', 'attestation', 'acting appointment',
      'secondment', 'clearance letter', 'release letter', 'posting letter',
      'increment', 'salary increment', 'seniority', 'welfare',
    ],
  },

  // ── RTDD — recruitment, training, exams ──────────────────────────────────
  {
    abbreviation: 'RTDD',
    room: 'Room 11, 2nd Fl · Deputy: Room 9, 2nd Fl',
    keywords: [
      'recruit', 'recruitment', 'job', 'vacancy', 'apply', 'application',
      'hiring', 'training', 'workshop', 'study leave', 'scholarship',
      'capacity building', 'induction', 'gimpa', 'entrance exam',
      'competitive exam', 'examination', 'interview', 'staff development',
      'seeking employment', 'employment opportunity', 'new staff',
    ],
  },

  // ── RSIMD — e-SPAR / salary system, ICT, data ────────────────────────────
  {
    abbreviation: 'RSIMD',
    room: 'Room 7, 2nd Fl · Deputy: Room 19, 1st Fl',
    keywords: [
      'salary', 'e-spar', 'espar', 'spar', 'payroll', 'ict',
      'it support', 'computer', 'software', 'technology', 'research',
      'data', 'statistics', 'survey', 'database', 'e-governance',
      'digital', 'information system', 'information technology',
      'network', 'system support', 'salary update', 'salary issue',
    ],
  },

  // ── PBMED — performance, planning, evaluation ─────────────────────────────
  {
    abbreviation: 'PBMED',
    room: 'Room 5, 2nd Fl · Deputy: Room 31, 1st Fl',
    keywords: [
      'performance', 'appraisal', 'monitoring', 'evaluation',
      'service delivery', 'client service', 'development plan',
      'annual plan', 'strategic plan', 'sector plan', 'kpi', 'target',
      'output', 'outcome', 'performance review', 'performance management',
      'performance contract',
    ],
  },

  // ── F&A — finance, transport, facilities (not procurement / stores) ───────
  {
    abbreviation: 'F&A',
    room: 'Room 10, 2nd Fl · Deputy: Room 35, 1st Fl',
    keywords: [
      'budget', 'finance', 'financial', 'payment', 'invoice', 'vehicle',
      'transport', 'logistics', 'asset', 'utility', 'catering',
      'maintenance', 'facility', 'fuel', 'official vehicle',
      'repair', 'estate management',
    ],
  },

  // ── CSC — complaints, petitions, disciplinary ────────────────────────────
  {
    abbreviation: 'CSC',
    room: 'Rooms 24 & 44',
    keywords: [
      'complaint', 'petition', 'disciplinary', 'civil service council',
      'appeal', 'misconduct', 'tribunal', 'grievance', 'unfair treatment',
      'lodge complaint', 'file complaint',
    ],
  },

  // ── IAU — audit, fraud, compliance ───────────────────────────────────────
  {
    abbreviation: 'IAU',
    room: '',
    keywords: [
      'audit', 'fraud', 'internal audit', 'compliance', 'risk',
      'investigation', 'irregularity', 'financial irregularity',
      'misappropriation', 'embezzlement',
    ],
  },

  // ── RCU — reform, anti-corruption, RTI ───────────────────────────────────
  {
    abbreviation: 'RCU',
    room: '',
    keywords: [
      'reform', 'anti-corruption', 'nacap', 'right to information', 'rti',
      'transparency', 'freedom of information', 'accountability',
      'corruption', 'whistleblower',
    ],
  },

  // ── REGISTRY — confidential document drop-off ────────────────────────────
  {
    abbreviation: 'REGISTRY',
    room: 'Room 4, 2nd Floor',
    keywords: [
      'submit', 'submission', 'drop off', 'dispatch', 'filing',
      'document', 'file', 'correspondence', 'memo', 'confidential',
      'registry', 'deliver document', 'drop document',
    ],
  },

  // ── P-REG — personal / personnel files ───────────────────────────────────
  {
    abbreviation: 'P-REG',
    room: 'Room 44, Ground Floor',
    keywords: [
      'p registry', 'personal file', 'personnel file', 'staff file',
      'employee file', 'employment history', 'service record',
      'file number', 'staff record', 'personnel record', 'my file',
    ],
  },

  // ── REC — archived / official records ────────────────────────────────────
  {
    abbreviation: 'REC',
    room: 'Room 49, Ground Floor',
    keywords: [
      'records unit', 'records office', 'archive', 'archival',
      'retrieve record', 'historical record', 'official record',
      'old file', 'old record', 'records retrieval',
    ],
  },

  // ── CD-SEC — Chief Director's office ─────────────────────────────────────
  {
    abbreviation: 'CD-SEC',
    room: '2nd Floor',
    keywords: [
      'chief director', 'director general', 'executive', 'management meeting',
      'top management', 'official visit', 'protocol', 'head of office',
      'cd office',
    ],
  },

  // ── ACCOUNTS — vouchers, arrears, allowances ─────────────────────────────
  {
    abbreviation: 'ACCOUNTS',
    room: '',
    keywords: [
      'voucher', 'cheque', 'check', 'arrears', 'deduction', 'allowance',
      'overtime', 'salary arrears', 'financial clearance', 'cash',
      'payment voucher', 'salary voucher', 'accounts',
    ],
  },

  // ── ESTATE — accommodation, quarters ─────────────────────────────────────
  {
    abbreviation: 'ESTATE',
    room: '',
    keywords: [
      'estate', 'accommodation', 'quarters', 'bungalow', 'housing',
      'property', 'land', 'official residence', 'government bungalow',
      'staff accommodation',
    ],
  },

  // ── COUNS — counseling / employee wellbeing ───────────────────────────────
  {
    abbreviation: 'COUNS',
    room: 'ANNEX 1st Floor',
    keywords: [
      'counseling', 'counselling', 'mental health', 'stress', 'emotional',
      'psychological', 'welfare support', 'personal problem', 'wellbeing',
      'well-being', 'employee assistance', 'eap',
    ],
  },

  // ── PROC — OHCS Procurement unit ─────────────────────────────────────────
  {
    abbreviation: 'PROC',
    room: 'ANNEX Rm 6, 1st Floor',
    keywords: [
      'procurement', 'tender', 'bid', 'bidding', 'contract', 'purchase',
      'supply', 'vendor', 'supplier', 'goods', 'rfq', 'rfp',
      'sole source', 'procure', 'acquire goods',
    ],
  },

  // ── PROC-HQ — Procurement Headquarters ───────────────────────────────────
  {
    abbreviation: 'PROC-HQ',
    room: 'ANNEX Block, 3rd Floor',
    keywords: [
      'procurement hq', 'procurement headquarters', 'ppa', 'ppadb',
      'public procurement authority', 'national procurement',
      'central procurement',
    ],
  },

  // ── STORES — office supplies & stationery ────────────────────────────────
  {
    abbreviation: 'STORES',
    room: 'ANNEX Ground Floor',
    keywords: [
      'stores', 'stationery', 'office supplies', 'office supply', 'stock',
      'inventory', 'consumables', 'equipment request', 'furniture',
      'office materials', 'store request', 'collect items', 'collect supplies',
    ],
  },

  // ── ILO — International Labour Organization ───────────────────────────────
  {
    abbreviation: 'ILO',
    room: 'ANNEX 1st Floor',
    keywords: [
      'ilo', 'international labour', 'international labor', 'decent work',
      'labour standards', 'labor standards', 'labour relations',
      'employment policy', 'worker rights', 'ilo project',
    ],
  },

  // ── JDS — Japan / JICA project office ────────────────────────────────────
  {
    abbreviation: 'JDS',
    room: 'ANNEX Block',
    keywords: [
      'jds', 'japan', 'japanese', 'jica', 'japanese scholarship',
      'japan international', 'japanese government',
    ],
  },
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

// Score-based matching: count how many keywords from each rule appear in the
// purpose text, return the directorate with the highest score (min 1).
// Multi-word phrases naturally outscore ambiguous single-word overlaps.
export function suggestDirectorate(purpose: string, directorates: DirectorateOption[]): DirectorateOption | null {
  if (!purpose || purpose.length < 3) return null;
  const lower = purpose.toLowerCase();

  let bestDir: DirectorateOption | null = null;
  let bestScore = 0;

  for (const rule of ROUTING_KEYWORDS) {
    const score = rule.keywords.filter((kw) => lower.includes(kw)).length;
    if (score > bestScore) {
      const dir = directorates.find((d) => d.abbreviation === rule.abbreviation);
      if (dir) {
        bestDir = dir;
        bestScore = score;
      }
    }
  }

  return bestDir;
}
