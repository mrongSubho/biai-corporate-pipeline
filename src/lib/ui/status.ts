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
    badgeClass: 'text-rose-600 dark:text-rose-400 font-semibold',
    icon: 'alert-triangle'
  },
  'at-risk': {
    urgency: 'at-risk',
    label: 'At risk',
    color: 'warning',
    railClass: 'rail-at-risk',
    badgeClass: 'text-amber-600 dark:text-amber-400 font-semibold',
    icon: 'clock-3'
  },
  healthy: {
    urgency: 'healthy',
    label: 'In SLA',
    color: 'neutral',
    railClass: 'rail-healthy',
    badgeClass: 'text-slate-400 dark:text-slate-500 font-normal',
    icon: 'check'
  },
  met: {
    urgency: 'met',
    label: 'Met',
    color: 'success',
    railClass: 'rail-met',
    badgeClass: 'text-emerald-600 dark:text-emerald-400 font-semibold',
    icon: 'check-check'
  }
};
