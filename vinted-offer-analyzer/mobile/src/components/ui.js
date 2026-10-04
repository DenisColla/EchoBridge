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

export function Button({ label, onPress, variant = 'primary', disabled = false, style }) {
  const t = useTheme()
  const bg = variant === 'primary' ? t.accent : variant === 'danger' ? t.badSoft : t.card
  const fg = variant === 'primary' ? t.onAccent : variant === 'danger' ? t.bad : t.ink
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [styles.button, { backgroundColor: bg, borderColor: variant === 'secondary' ? t.line : bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }, style]}
    >
      <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>
    </Pressable>
  )
}

export function Chip({ label, hint, active, onPress }) {
  const t = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      style={({ pressed }) => [styles.chip, { backgroundColor: active ? t.accent : t.card, borderColor: active ? t.accent : t.line, opacity: pressed ? 0.85 : 1 }]}
    >
      <Text style={[styles.chipLabel, { color: active ? t.onAccent : t.ink }]}>{label}</Text>
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
      <Text style={[styles.fieldLabel, { color: t.ink }]}>
        {label}{hint ? <Text style={{ color: t.ink3, fontWeight: '400' }}> {hint}</Text> : null}
      </Text>
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
  button: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg, paddingVertical: space.md },
  buttonText: { fontSize: 15, fontWeight: '700' },
  chip: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, flexGrow: 1, flexBasis: '45%', justifyContent: 'center' },
  chipLabel: { fontSize: 14, fontWeight: '600' },
  chipHint: { fontSize: 11, marginTop: 2 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  field: { gap: 6 },
  fieldLabel: { fontSize: 14, fontWeight: '600' },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12 },
  input: { flex: 1, fontSize: 16, paddingVertical: 10 },
  suffix: { fontSize: 14, marginLeft: 6 },
  error: { fontSize: 12, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  note: { borderRadius: radius.md, padding: space.md },
})
