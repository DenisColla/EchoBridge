/**
 * Visual tokens expressed as Tailwind class strings, keyed by semantic tone.
 * Keeping them here (instead of scattered through the components) makes the
 * React Native port a one-file job (map the same keys to NativeWind classes)
 * and keeps the single-file artifact free of custom Tailwind config.
 */

export const TONE = {
  good: {
    badge: 'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:ring-emerald-800',
    bar: 'bg-emerald-500',
    track: 'bg-emerald-100 dark:bg-emerald-950',
    text: 'text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  warn: {
    badge: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:ring-amber-800',
    bar: 'bg-amber-500',
    track: 'bg-amber-100 dark:bg-amber-950',
    text: 'text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  bad: {
    badge: 'bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-950/60 dark:text-rose-200 dark:ring-rose-800',
    bar: 'bg-rose-500',
    track: 'bg-rose-100 dark:bg-rose-950',
    text: 'text-rose-700 dark:text-rose-300',
    dot: 'bg-rose-500',
  },
  neutral: {
    badge: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700',
    bar: 'bg-slate-400',
    track: 'bg-slate-100 dark:bg-slate-800',
    text: 'text-slate-600 dark:text-slate-300',
    dot: 'bg-slate-400',
  },
  accent: {
    badge: 'bg-teal-50 text-teal-800 ring-teal-200 dark:bg-teal-950/60 dark:text-teal-200 dark:ring-teal-800',
    bar: 'bg-teal-600',
    track: 'bg-teal-100 dark:bg-teal-950',
    text: 'text-teal-700 dark:text-teal-300',
    dot: 'bg-teal-600',
  },
}

export const toneForProbability = (p) => (p >= 0.6 ? 'good' : p >= 0.4 ? 'warn' : 'bad')

export const toneForLevel = (level) => ({ low: 'good', medium: 'warn', high: 'bad' })[level] || 'neutral'

export const SURFACE = {
  page: 'bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100',
  card: 'bg-white ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800',
  cardMuted: 'bg-slate-50 ring-1 ring-slate-200 dark:bg-slate-900/60 dark:ring-slate-800',
  input: 'bg-white text-slate-900 ring-1 ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-teal-600 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700',
  chip: 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800',
  chipActive: 'bg-teal-700 text-white ring-1 ring-teal-700 shadow-sm dark:bg-teal-500 dark:text-slate-950 dark:ring-teal-500',
  primaryButton: 'bg-teal-700 text-white hover:bg-teal-800 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400',
  secondaryButton: 'bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700 dark:hover:bg-slate-800',
  muted: 'text-slate-500 dark:text-slate-400',
  divider: 'border-slate-200 dark:border-slate-800',
}

export const cx = (...parts) => parts.filter(Boolean).join(' ')
