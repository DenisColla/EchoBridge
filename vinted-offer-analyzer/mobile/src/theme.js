import { useColorScheme } from 'react-native'

/** Colour tokens for both schemes. Semantic tones (good/warn/bad) stay separate from the accent. */
export const palette = {
  light: {
    bg: '#f8fafc', card: '#ffffff', cardMuted: '#f1f5f9', line: '#e2e8f0',
    ink: '#0f172a', ink2: '#475569', ink3: '#64748b',
    accent: '#0f766e', accentSoft: '#ccfbf1', accentInk: '#115e59', onAccent: '#ffffff',
    good: '#059669', goodSoft: '#d1fae5', warn: '#b45309', warnSoft: '#fef3c7', bad: '#be123c', badSoft: '#ffe4e6',
  },
  dark: {
    bg: '#020617', card: '#0f172a', cardMuted: '#1e293b', line: '#1e293b',
    ink: '#f1f5f9', ink2: '#cbd5e1', ink3: '#94a3b8',
    accent: '#14b8a6', accentSoft: '#042f2e', accentInk: '#5eead4', onAccent: '#020617',
    good: '#34d399', goodSoft: '#064e3b', warn: '#fbbf24', warnSoft: '#451a03', bad: '#fb7185', badSoft: '#4c0519',
  },
}

export const useTheme = () => {
  const scheme = useColorScheme()
  return palette[scheme === 'dark' ? 'dark' : 'light']
}

export const toneForProbability = (p) => (p >= 0.6 ? 'good' : p >= 0.4 ? 'warn' : 'bad')
export const toneForLevel = (level) => ({ low: 'good', medium: 'warn', high: 'bad' })[level] || 'neutral'

export const toneColors = (t, tone) => ({
  good: { fg: t.good, bg: t.goodSoft },
  warn: { fg: t.warn, bg: t.warnSoft },
  bad: { fg: t.bad, bg: t.badSoft },
  accent: { fg: t.accentInk, bg: t.accentSoft },
  neutral: { fg: t.ink2, bg: t.cardMuted },
})[tone] || { fg: t.ink2, bg: t.cardMuted }

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 }
export const radius = { md: 12, lg: 16, xl: 20, pill: 999 }
