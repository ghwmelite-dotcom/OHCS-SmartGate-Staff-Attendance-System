import type { LucideIcon } from 'lucide-react';
import {
  Sparkles,
  LayoutDashboard,
  UserPlus,
  CalendarDays,
  ShieldAlert,
  BarChart3,
  BellRing,
  CheckCircle2,
} from 'lucide-react';

/**
 * VMS welcome wizard — pure data + helpers (spec:
 * docs/superpowers/specs/2026-07-19-vms-welcome-wizard-design.md). Kept DOM-free
 * so the node-env vitest suite can exercise filtering and seen-state logic; the
 * dialog chrome lives in components/WelcomeWizard.tsx.
 */

export interface WelcomeStep {
  id: string;
  title: string;
  body: string;
  bullets?: string[];
  icon: LucideIcon;
  /** Roles the step applies to; omitted means every role sees it. */
  roles?: readonly string[];
}

export const WELCOME_STEPS: readonly WelcomeStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to SmartGate',
    body: 'SmartGate runs the OHCS front desk in one place — visitor check-in, the lobby kiosk, appointments, watchlists and reports.',
    icon: Sparkles,
  },
  {
    id: 'dashboard',
    title: 'Your dashboard',
    body: 'The dashboard is your live picture of the building: arrivals as they happen, who is still waiting, and for how long.',
    bullets: [
      'Wait-time colors: amber at 15 min, red at 30 min',
      'End-of-day sweep banner flags unchecked-out visits',
      'Evacuation Roll — one tap for a muster list',
    ],
    icon: LayoutDashboard,
  },
  {
    id: 'check-in',
    title: 'Check-in & kiosk',
    body: 'Stepped check-in walks each visitor through registration, with delegation mode for groups sharing one host. The lobby kiosk self-serves arrivals — including a fast lane for returning visitors.',
    icon: UserPlus,
    roles: ['receptionist', 'admin', 'superadmin'],
  },
  {
    id: 'appointments',
    title: 'Appointments',
    body: 'Visitors book on the public booking page and you approve from the appointments view. Confirmed guests arrive with an email QR the kiosk scans straight to check-in, and the day view keeps the schedule clear.',
    icon: CalendarDays,
  },
  {
    id: 'watchlist',
    title: 'Visitors & watchlist',
    body: 'Every visit builds a searchable visitor record. Superadmins manage the watchlist: VIP flags alert leadership on arrival, banned flags quietly warn reception.',
    icon: ShieldAlert,
    roles: ['receptionist', 'admin', 'superadmin'],
  },
  {
    id: 'reports',
    title: 'Reports, analytics & audit',
    body: 'Export visit data for your directorate, track traffic and wait-time trends in analytics, and trace every sensitive change in the hash-chained audit log.',
    icon: BarChart3,
    roles: ['admin', 'superadmin', 'director'],
  },
  {
    id: 'telegram',
    title: 'Stay in the loop',
    body: 'Link Telegram with /link to get arrival alerts on your phone, answer them with the action buttons, and set your availability (/meeting) so reception knows before sending visitors up.',
    icon: BellRing,
  },
  {
    id: 'done',
    title: "You're set",
    body: "That's the tour. Reopen it anytime from the ? button in the header — it's on every page.",
    icon: CheckCircle2,
  },
];

/** localStorage key prefix — seen state is per device per user, no server state. */
export const WIZARD_SEEN_KEY_PREFIX = 'ohcs.vms.wizard.v1.seen:';

/** Below this many visible steps the tour isn't worth auto-opening. */
export const MIN_AUTO_OPEN_STEPS = 2;

export function wizardSeenKey(userId: string): string {
  return `${WIZARD_SEEN_KEY_PREFIX}${userId}`;
}

/** Steps visible to a role, in declared order. Unknown/null roles get the all-role steps. */
export function stepsForRole(role: string | null | undefined): WelcomeStep[] {
  return WELCOME_STEPS.filter((s) => !s.roles || (role != null && s.roles.includes(role)));
}

/** Minimal storage shape so tests can inject a fake and browsers can pass localStorage. */
export interface WizardStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): WizardStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function hasSeenWizard(userId: string, storage: WizardStorage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(wizardSeenKey(userId)) === '1';
  } catch {
    return false;
  }
}

export function markWizardSeen(userId: string, storage: WizardStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(wizardSeenKey(userId), '1');
  } catch {
    // Storage blocked/full — the tour simply offers itself again next time.
  }
}

/** Auto-open only when unseen and role filtering still leaves a real tour. */
export function shouldAutoOpenWizard(visibleSteps: readonly unknown[], seen: boolean): boolean {
  return !seen && visibleSteps.length >= MIN_AUTO_OPEN_STEPS;
}
