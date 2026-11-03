/**
 * Shared Semantic Urgency & Status Contract
 * Aligned with BIAI Operations UI Design System Plan
 */

export type Urgency = 'critical' | 'at-risk' | 'healthy' | 'met';

export interface UrgencyMeta {
  urgency: Urgency;
  label: string;
  color: 'danger' | 'warning' | 'neutral' | 'success';
  railClass: string;
  badgeClass: string;
  icon: 'alert-triangle' | 'clock-3' | 'check' | 'check-check';
}

export const urgencyPresentation: Record<Urgency, UrgencyMeta> = {
  critical: {
    urgency: 'critical',
    label: 'Critical / P0',
    color: 'danger',
    railClass: 'rail-critical',
    badgeClass: 'bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800',
    icon: 'alert-triangle'
  },
  'at-risk': {
    urgency: 'at-risk',
    label: 'At risk',
    color: 'warning',
    railClass: 'rail-at-risk',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800',
    icon: 'clock-3'
  },
  healthy: {
    urgency: 'healthy',
    label: 'In SLA',
    color: 'neutral',
    railClass: 'rail-healthy',
    badgeClass: 'bg-warm-100 text-slate-700 border-warm-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    icon: 'check'
  },
  met: {
    urgency: 'met',
    label: 'Met',
    color: 'success',
    railClass: 'rail-met',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800',
    icon: 'check-check'
  }
};
