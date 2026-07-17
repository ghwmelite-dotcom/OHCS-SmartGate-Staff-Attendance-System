import type { Directorate } from '@/lib/api';

export type DirectorateOption = Pick<Directorate, 'id' | 'name' | 'abbreviation'>;

// Routing rules for the purpose-of-visit suggestion card.
// Matching: word-boundary for short keywords (≤5 chars), substring for longer ones.
// Score = keywords matched; highest wins. Multi-word phrases naturally score higher.
// Order only matters for ties (put higher-traffic offices first).
export const ROUTING_KEYWORDS: Array<{ keywords: string[]; abbreviation: string; room: string }> = [
  // ── CMD — career, postings, leave, retirement ─────────────────────────────
  {
    abbreviation: 'CMD',
    room: 'Room 3, 2nd Fl · Deputy: Room 34, 1st Fl',
    keywords: [
      // postings & transfers
      'promotion', 'promoted', 'posting', 'posted', 'transfer', 'transferred',
      'career', 'succession', 'rank', 'grade', 'notch', 'step increment',
      'job rotation', 'secondment',
      // appointments & letters
      'confirmation', 'appointment letter', 'posting letter', 'release letter',
      'clearance letter', 'first appointment', 'acting appointment',
      'resume duty', 'return to duty', 'reporting letter',
      // leave
      'annual leave', 'sick leave', 'leave application', 'leave form',
      'leave balance', 'casual leave', 'maternity leave', 'paternity leave',
      'compassionate leave', 'emergency leave', 'study leave extension',
      'unpaid leave', 'leave without pay', 'lwop', 'earned leave',
      // retirement & exit
      'retirement', 'retire', 'pension', 'gratuity', 'provident fund',
      'voluntary retirement', 'early retirement', 'exit benefits',
      // discipline
      'discipline', 'disciplinary', 'misconduct', 'awol', 'interdiction',
      'dismissal', 'warning letter', 'caution letter', 'query letter',
      'show cause', 'suspension',
      // pay & personal data
      'salary increment', 'increment', 'seniority', 'attestation',
      'change of name', 'bank change', 'personal data change', 'update records',
      'salary advance', 'advance', 'payslip', 'pay slip',
      // welfare
      'welfare', 'staff welfare', 'officer welfare',
      'human resources', 'human resource', 'hr', 'hr officer', 'hr office',
      'personnel', 'staff matters', 'staff affairs', 'personal matters',
    ],
  },

  // ── RTDD — recruitment, training, exams ──────────────────────────────────
  {
    abbreviation: 'RTDD',
    room: 'Room 11, 2nd Fl · Deputy: Room 9, 2nd Fl',
    keywords: [
      // recruitment
      'recruit', 'recruitment', 'job', 'vacancy', 'vacancies', 'apply',
      'application', 'hiring', 'hire', 'employed', 'employment opportunity',
      'new staff', 'seeking employment', 'job seeker', 'job opening',
      'fresh graduate', 'graduate', 'new hire', 'filling vacancy',
      'interview', 'screening',
      // training
      'training', 'workshop', 'seminar', 'seminar registration', 'course',
      'courses', 'programme', 'program', 'enrollment', 'enroll', 'register',
      'short course', 'online course', 'e-learning', 'capacity building',
      'staff development', 'skills', 'upskill', 'professional development',
      'induction', 'orientation', 'study leave', 'scholarship', 'sponsor',
      'study abroad', 'certification', 'certificate', 'diploma', 'masters',
      'degree', 'gimpa', 'galop', 'conference', 'learning', 'develop',
      // exams
      'entrance exam', 'competitive exam', 'examination', 'aptitude test',
      'written test', 'practical test', 'exam result', 'entrance test',
      // attachment / national service
      'national service', 'nss placement', 'attachment', 'industrial attachment',
      'internship', 'placement', 'siwes', 'work experience', 'industrial',
    ],
  },

  // ── RSIMD — e-SPAR / salary system, ICT, data ────────────────────────────
  {
    abbreviation: 'RSIMD',
    room: 'Room 7, 2nd Fl · Deputy: Room 19, 1st Fl',
    keywords: [
      // salary system
      'salary', 'e-spar', 'espar', 'spar', 'payroll', 'salary not paid',
      'salary not updated', 'salary error', 'name on salary', 'update salary',
      'salary issue', 'salary problem', 'e-spar registration', 'spar registration',
      'salary database', 'ghost name', 'payroll system', 'e-pay',
      // ICT support
      'ict', 'it support', 'computer', 'software', 'technology', 'laptop',
      'printer', 'internet', 'wifi', 'wi-fi', 'network', 'connectivity',
      'system support', 'technical', 'technical support', 'technical issue',
      'helpdesk', 'help desk', 'password', 'login issue', 'account access',
      'system access', 'server', 'email', 'system problem', 'it help',
      'information technology', 'information system',
      // data & digital
      'research', 'data', 'statistics', 'survey', 'database', 'e-governance',
      'digital', 'e-government', 'digital transformation', 'digital services',
      'portal access', 'government portal', 'portal',
      // identity
      'biometric', 'smart card', 'staff id', 'id card', 'access card',
    ],
  },

  // ── PBMED — performance, planning, evaluation ─────────────────────────────
  {
    abbreviation: 'PBMED',
    room: 'Room 5, 2nd Fl · Deputy: Room 31, 1st Fl',
    keywords: [
      'performance', 'appraisal', 'appraisal form', 'performance form',
      'performance review', 'performance management', 'performance contract',
      'monitoring', 'evaluation', 'assess', 'assessment', 'rating',
      'service delivery', 'client service', 'citizen', 'citizen satisfaction',
      'service charter', 'service standard', 'quality assurance',
      'development plan', 'work plan', 'annual plan', 'strategic plan',
      'sector plan', 'annual report', 'sector review', 'management review',
      'kpi', 'target', 'output', 'outcome', 'indicator', 'milestone',
      'deliverable', 'objectives', 'acar', 'quarterly review',
      'performance feedback', 'feedback',
    ],
  },

  // ── F&A — finance, transport, facilities (not procurement / stores) ───────
  {
    abbreviation: 'F&A',
    room: 'Room 10, 2nd Fl · Deputy: Room 35, 1st Fl',
    keywords: [
      // finance
      'budget', 'finance', 'financial', 'payment', 'invoice', 'cash',
      'expenditure', 'claim', 'reimbursement', 'per diem', 'subsistence',
      'dsa', 'allowance', 'duty allowance', 'travel allowance', 'mileage',
      'mileage claim', 'trip claim', 'official trip', 'in-country travel',
      // vehicles
      'vehicle', 'transport', 'logistics', 'official vehicle', 'pool car',
      'car request', 'government vehicle', 'fuel', 'fuel coupon', 'petrol',
      // facilities
      'asset', 'utility', 'catering', 'maintenance', 'facility', 'repair',
      'estate management', 'office maintenance', 'insurance',
    ],
  },

  // ── CSC — complaints, petitions, disciplinary ────────────────────────────
  {
    abbreviation: 'CSC',
    room: 'Rooms 24 & 44',
    keywords: [
      'complaint', 'complain', 'petition', 'civil service council',
      'appeal', 'misconduct', 'tribunal', 'grievance', 'unfair treatment',
      'treated unfairly', 'lodge complaint', 'file complaint',
      'case', 'hearing', 'mediation', 'arbitration', 'dispute',
      'employment dispute', 'injustice', 'labor case', 'violation',
      'right', 'rights', 'wrongful', 'unfair', 'unjust',
    ],
  },

  // ── IAU — audit, fraud, compliance ───────────────────────────────────────
  {
    abbreviation: 'IAU',
    room: '',
    keywords: [
      'audit', 'fraud', 'internal audit', 'compliance', 'risk',
      'investigation', 'irregularity', 'financial irregularity',
      'misappropriation', 'embezzlement', 'leakage', 'financial loss',
      'public funds', 'misuse of funds', 'risk assessment', 'internal control',
    ],
  },

  // ── RCU — reform, anti-corruption, RTI ───────────────────────────────────
  {
    abbreviation: 'RCU',
    room: '',
    keywords: [
      'reform', 'anti-corruption', 'nacap', 'right to information', 'rti',
      'transparency', 'freedom of information', 'accountability',
      'corruption', 'whistleblower', 'bribery', 'extortion',
      'public accountability', 'civil service reform', 'public sector reform',
    ],
  },

  // ── REGISTRY — confidential document drop-off ────────────────────────────
  {
    abbreviation: 'REGISTRY',
    room: 'Room 4, 2nd Floor',
    keywords: [
      'submit', 'submission', 'drop off', 'drop document', 'hand in',
      'deliver', 'deliver document', 'deliver letter', 'dispatch',
      'filing', 'file', 'document', 'correspondence', 'memo',
      'confidential', 'registry', 'send document', 'send letter',
      'official document', 'postal', 'courier', 'incoming mail',
      'outgoing mail', 'mail room', 'bring documents', 'return documents',
      'signed form', 'signed document', 'submit form', 'submit documents',
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
      'my records', 'my history', 'check my file', 'see my file',
      'career history', 'service history', 'employment records',
      'experience letter', 'years of service', 'length of service',
      'history of service', 'past postings', 'career record',
    ],
  },

  // ── REC — archived / official records ────────────────────────────────────
  {
    abbreviation: 'REC',
    room: 'Room 49, Ground Floor',
    keywords: [
      'records unit', 'records office', 'archive', 'archival',
      'retrieve record', 'historical record', 'official record',
      'old file', 'old record', 'records retrieval', 'old documents',
      'retrieve documents', 'retrieve file', 'official archives',
    ],
  },

  // ── HOS-SEC — Head of Service Secretariat ────────────────────────────────
  {
    abbreviation: 'HOS-SEC',
    room: '2nd Floor',
    keywords: [
      'head of service', 'head of civil service', 'hos', 'hcs',
      'head of service secretariat', 'hos secretariat',
      'head of the civil service', 'see the head', 'meet the head',
      'head\'s office', 'the head',
    ],
  },

  // ── CD-SEC — Chief Director's office ─────────────────────────────────────
  {
    abbreviation: 'CD-SEC',
    room: '2nd Floor',
    keywords: [
      'chief director', 'director general', 'executive', 'management meeting',
      'top management', 'official visit', 'protocol', 'head of office',
      'cd office', 'director\'s office', 'chief director\'s office',
      'see the director', 'meet the director', 'see management',
      'administration', 'administrative head', 'management',
    ],
  },

  // ── ACCOUNTS — vouchers, arrears, allowances ─────────────────────────────
  {
    abbreviation: 'ACCOUNTS',
    room: '',
    keywords: [
      'voucher', 'cheque', 'check', 'arrears', 'deduction', 'salary arrears',
      'allowance', 'overtime', 'financial clearance', 'payment voucher',
      'salary voucher', 'accounts', 'ssnit', 'third tier', 'net pay',
      'gross pay', 'income tax', 'paye', 'tax', 'withholding tax',
      'bank details', 'bank account', 'salary bank', 'emolument',
      'consolidated pay', 'salary structure', 'payment slip', 'pay advice',
      'ippd', 'cagd', 'controller', 'accountant general', 'treasury',
      'tax relief', 'tax clearance', 'pension deduction', 'financial statement',
    ],
  },

  // ── ESTATE — accommodation, quarters ─────────────────────────────────────
  {
    abbreviation: 'ESTATE',
    room: '',
    keywords: [
      'estate', 'accommodation', 'quarters', 'bungalow', 'housing',
      'property', 'land', 'official residence', 'government bungalow',
      'staff accommodation', 'government house', 'official house',
      'rent', 'keys', 'room allocation', 'quarter allocation',
    ],
  },

  // ── COUNS — counseling / employee wellbeing ───────────────────────────────
  {
    abbreviation: 'COUNS',
    room: 'ANNEX 1st Floor',
    keywords: [
      'counseling', 'counselling', 'mental health', 'stress', 'emotional',
      'psychological', 'welfare support', 'personal problem', 'wellbeing',
      'well-being', 'employee assistance', 'eap', 'anxiety', 'depression',
      'burnout', 'family issues', 'marital issues', 'personal counseling',
      'emotional support', 'mental wellness', 'work stress',
    ],
  },

  // ── PROC — OHCS Procurement unit ─────────────────────────────────────────
  {
    abbreviation: 'PROC',
    room: 'ANNEX Rm 6, 1st Floor',
    keywords: [
      'procurement', 'tender', 'bid', 'bidding', 'contract', 'purchase',
      'supply', 'vendor', 'supplier', 'goods', 'rfq', 'rfp',
      'sole source', 'procure', 'acquire goods', 'quotation', 'quote',
      'supplier registration', 'vendor registration', 'supply goods',
      'purchase order', 'lpo', 'local purchase order', 'procurement notice',
      'contract award', 'provide goods', 'service contract', 'outsource',
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
      'collect stationery', 'pick up supplies', 'request equipment',
      'requisition', 'office items', 'printing paper', 'pen', 'toner',
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

// Use word-boundary matching for short keywords (≤5 chars) to avoid false
// substring hits (e.g. "hr" inside "another", "pay" inside "display").
// Longer phrases use simple includes — they're specific enough already.
function keywordMatches(kw: string, text: string): boolean {
  if (kw.length <= 5) {
    try {
      return new RegExp(`\\b${kw}\\b`).test(text);
    } catch {
      return text.includes(kw);
    }
  }
  return text.includes(kw);
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
    const score = rule.keywords.filter((kw) => keywordMatches(kw, lower)).length;
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
