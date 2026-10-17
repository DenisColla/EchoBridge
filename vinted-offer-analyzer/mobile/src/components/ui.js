import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { radius, space, toneColors, useTheme } from '../theme.js'

export function Card({ children, style, muted = false }) {
  const t = useTheme()
  return (
    <View style={[styles.card, { backgroundColor: muted ? t.cardMuted : t.card, borderColor: t.line }, style]}>
      {children}
    </View>
  )
}

export function SectionLabel({ children }) {
  const t = useTheme()
  return <Text style={[styles.sectionLabel, { color: t.ink3 }]}>{children}</Text>
}

export function Title({ children, style }) {
  const t = useTheme()
  return <Text style={[styles.title, { color: t.ink }, style]}>{children}</Text>
}

export function Body({ children, muted = false, style, small = false, ...rest }) {
  const t = useTheme()
  return <Text style={[small ? styles.small : styles.body, { color: muted ? t.ink3 : t.ink }, style]} {...rest}>{children}</Text>
}

export function Badge({ tone = 'neutral', children }) {
  const t = useTheme()
  const c = toneColors(t, tone)
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.badgeText, { color: c.fg }]}>{children}</Text>
    </View>
  )
}

export function Meter({ value, tone = 'accent' }) {
  const t = useTheme()
  const c = toneColors(t, tone)
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)))
  return (
    <View style={[styles.meterTrack, { backgroundColor: c.bg }]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
      <View style={[styles.meterFill, { backgroundColor: c.fg, width: `${pct}%` }]} />
    </View>
  )
}

/**
 * variant: primary (filled accent), secondary (outlined), ghost (text only, for low-priority actions),
 * danger (soft red). `small` lowers the height for action rows.
 */
export function Button({ label, onPress, variant = 'primary', disabled = false, style, small = false }) {
  const t = useTheme()
  const ghost = variant === 'ghost' || variant === 'ghostDanger'
  const bg = variant === 'primary' ? t.accent : variant === 'danger' ? t.badSoft : ghost ? 'transparent' : t.card
  const fg = variant === 'primary' ? t.onAccent : variant === 'danger' || variant === 'ghostDanger' ? t.bad : variant === 'ghost' ? t.accentInk : t.ink
  const border = variant === 'secondary' ? t.line : ghost ? 'transparent' : bg
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      hitSlop={small ? 6 : 0}
      style={({ pressed }) => [styles.button, small && styles.buttonSmall, { backgroundColor: bg, borderColor: border, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }, style]}
    >
      <Text style={[styles.buttonText, small && styles.buttonTextSmall, { color: fg }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  )
}

/** A row of equally wide buttons that never overlap: each child is wrapped in a flexible cell that wraps to a new row when narrow. */
export function ButtonRow({ children }) {
  const cells = Array.isArray(children) ? children : [children]
  return (
    <View style={styles.buttonRow}>
      {cells.filter(Boolean).map((child, index) => (
        <View key={index} style={styles.buttonCell}>{child}</View>
      ))}
    </View>
  )
}

/** compact = sized to its label (toggles, tones, percentages); default chips fill a two-column grid. */
export function Chip({ label, hint, active, onPress, compact = false }) {
  const t = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      style={({ pressed }) => [compact ? styles.chipCompact : styles.chip, { backgroundColor: active ? t.accent : t.card, borderColor: active ? t.accent : t.line, opacity: pressed ? 0.85 : 1 }]}
    >
      <Text style={[styles.chipLabel, { color: active ? t.onAccent : t.ink }]} numberOfLines={compact ? 1 : 2}>{label}</Text>
      {hint ? <Text style={[styles.chipHint, { color: active ? t.onAccent : t.ink3 }]} numberOfLines={2}>{hint}</Text> : null}
    </Pressable>
  )
}

export function ChipGroup({ label, hint, options, value, onChange, error }) {
  const t = useTheme()
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: t.ink }]}>
        {label}{hint ? <Text style={{ color: t.ink3, fontWeight: '400' }}> {hint}</Text> : null}
      </Text>
      <View style={styles.chipWrap} accessibilityRole="radiogroup">
        {options.map((opt) => (
          <Chip key={opt.id} label={opt.label} hint={opt.hint} active={opt.id === value} onPress={() => onChange(opt.id)} />
        ))}
      </View>
      {error ? <Text style={[styles.error, { color: t.bad }]}>{error}</Text> : null}
    </View>
  )
}

export function Field({ label, hint, error, value, onChangeText, placeholder, keyboardType = 'default', suffix, multiline = false, autoCapitalize = 'sentences' }) {
  const t = useTheme()
  return (
    <View style={styles.field}>
      {label ? (
        <Text style={[styles.fieldLabel, { color: t.ink }]}>
          {label}{hint ? <Text style={{ color: t.ink3, fontWeight: '400' }}> {hint}</Text> : null}
        </Text>
      ) : null}
      <View style={[styles.inputWrap, { backgroundColor: t.card, borderColor: error ? t.bad : t.line }]}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={t.ink3}
          keyboardType={keyboardType}
          multiline={multiline}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          style={[styles.input, { color: t.ink, minHeight: multiline ? 72 : 48 }]}
        />
        {suffix ? <Text style={[styles.suffix, { color: t.ink3 }]}>{suffix}</Text> : null}
      </View>
      {error ? <Text style={[styles.error, { color: t.bad }]}>{error}</Text> : null}
    </View>
  )
}

/**
 * Secondary detail that stays folded until asked for: a tappable header with a chevron and an optional summary
 * shown while closed. Keeps the result page short on a phone without hiding anything.
 */
export function Collapsible({ title, summary, children, initiallyOpen = false }) {
  const t = useTheme()
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <View style={[styles.collapsible, { borderColor: t.line }]}>
      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={({ pressed }) => [styles.collapsibleHeader, { opacity: pressed ? 0.7 : 1 }]}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={[styles.collapsibleTitle, { color: t.ink }]} numberOfLines={1}>{title}</Text>
          {!open && summary ? <Text style={[styles.small, { color: t.ink3 }]} numberOfLines={2}>{summary}</Text> : null}
        </View>
        <Text style={[styles.chevron, { color: t.ink3 }]}>{open ? '▴' : '▾'}</Text>
      </Pressable>
      {open ? <View style={styles.collapsibleBody}>{children}</View> : null}
    </View>
  )
}

/** A full-width on/off row (checkbox look) for optional details with long labels. */
export function Toggle({ label, value, onChange }) {
  const t = useTheme()
  return (
    <Pressable onPress={() => onChange(!value)} accessibilityRole="checkbox" accessibilityState={{ checked: value }} style={({ pressed }) => [styles.toggle, { borderColor: value ? t.accent : t.line, backgroundColor: value ? t.accentSoft : t.card, opacity: pressed ? 0.85 : 1 }]}>
      <View style={[styles.toggleBox, { borderColor: value ? t.accent : t.ink3, backgroundColor: value ? t.accent : 'transparent' }]}>
        {value ? <Text style={{ color: t.onAccent, fontSize: 13, fontWeight: '800', lineHeight: 16 }}>✓</Text> : null}
      </View>
      <Text style={[styles.body, { color: t.ink, flex: 1, minWidth: 0 }]}>{label}</Text>
    </Pressable>
  )
}

export function Row({ children, style }) {
  return <View style={[styles.row, style]}>{children}</View>
}

export function Note({ tone = 'neutral', children }) {
  const t = useTheme()
  const c = toneColors(t, tone)
  return (
    <View style={[styles.note, { backgroundColor: c.bg }]}>
      <Text style={[styles.body, { color: tone === 'neutral' ? t.ink : c.fg }]}>{children}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.xl, borderWidth: 1, padding: space.lg, gap: space.md },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  title: { fontSize: 17, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 22 },
  small: { fontSize: 13, lineHeight: 18 },
  badge: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  meterTrack: { height: 10, borderRadius: radius.pill, overflow: 'hidden' },
  meterFill: { height: '100%', borderRadius: radius.pill },
  button: { minHeight: 50, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.md, paddingVertical: space.md },
  buttonSmall: { minHeight: 42, paddingVertical: 8, paddingHorizontal: space.sm },
  buttonText: { fontSize: 15, fontWeight: '700' },
  buttonTextSmall: { fontSize: 14 },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  buttonCell: { flexGrow: 1, flexBasis: 150, minWidth: 0 },
  chip: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, minHeight: 48, flexGrow: 1, flexBasis: '46%', justifyContent: 'center' },
  chipCompact: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 9, minHeight: 40, justifyContent: 'center', flexGrow: 0, flexShrink: 0 },
  chipLabel: { fontSize: 14, fontWeight: '600' },
  chipHint: { fontSize: 11, marginTop: 2 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  field: { gap: 6 },
  fieldLabel: { fontSize: 14, fontWeight: '600' },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, overflow: 'hidden' },
  input: { flex: 1, flexShrink: 1, minWidth: 0, fontSize: 16, paddingVertical: 10 },
  suffix: { fontSize: 14, marginLeft: 6, flexShrink: 0 },
  error: { fontSize: 12, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  note: { borderRadius: radius.md, padding: space.md },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 10, minHeight: 48 },
  toggleBox: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  collapsible: { borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  collapsibleHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: 10, minHeight: 48 },
  collapsibleTitle: { fontSize: 14, fontWeight: '700' },
  collapsibleBody: { paddingHorizontal: space.md, paddingBottom: space.md, gap: space.sm },
  chevron: { fontSize: 16, flexShrink: 0 },
})
