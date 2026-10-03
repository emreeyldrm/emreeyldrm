import { forwardRef, type ReactNode } from 'react';
import {
  ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type PressableProps, type StyleProp, type TextInputProps, type TextProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { C, F, HIT, type Weight } from '../theme';
import { categoryInfo } from '../lib/categories';
import { CatGlyph, Icon, type IconName } from './Icon';

/** Adds data-* attributes on web (react-native-web `dataSet`); no-op on native. */
export function webData(data: Record<string, string>): object {
  return Platform.OS === 'web' ? { dataSet: data } : {};
}

type TxtProps = TextProps & { weight?: Weight; size?: number; color?: string; style?: StyleProp<TextStyle> };
export function Txt({ weight = 'regular', size = 15, color = C.text, style, ...rest }: TxtProps) {
  return <Text {...rest} style={[{ fontFamily: F[weight], fontSize: size, color }, style]} />;
}

export function Screen({ children, edges = ['top'], style }: { children: ReactNode; edges?: Edge[]; style?: StyleProp<ViewStyle> }) {
  return (
    <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: C.white }, style]}>
      {children}
    </SafeAreaView>
  );
}

export function Scroll({ children, contentStyle, testID }: { children: ReactNode; contentStyle?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <ScrollView testID={testID} style={{ flex: 1 }} contentContainerStyle={[{ padding: 20, paddingBottom: 40, gap: 14 }, contentStyle]} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function LargeTitle({ children, testID }: { children: ReactNode; testID?: string }) {
  return <Txt testID={testID} accessibilityRole="header" weight="extrabold" size={34} style={{ letterSpacing: -0.5, lineHeight: 38 }}>{children}</Txt>;
}

export function H2({ children, testID }: { children: ReactNode; testID?: string }) {
  return <Txt testID={testID} accessibilityRole="header" weight="extrabold" size={18} color={C.greenDark}>{children}</Txt>;
}

type Variant = 'primary' | 'green' | 'outline' | 'soft' | 'orangeSoft' | 'danger' | 'ghost';
const VARIANTS: Record<Variant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: C.orange, fg: C.orangeOn },
  green: { bg: C.green, fg: C.white },
  outline: { bg: C.white, fg: C.greenDark, border: C.green },
  soft: { bg: C.greenCard, fg: C.greenDark },
  orangeSoft: { bg: C.orangeTint, fg: C.orangeText },
  danger: { bg: C.dangerTint, fg: C.danger },
  ghost: { bg: 'transparent', fg: C.greenDark },
};

type BtnProps = Omit<PressableProps, 'style' | 'children'> & {
  title: string;
  variant?: Variant;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  height?: number;
  small?: boolean;
};
export function Btn({ title, variant = 'primary', icon, style, height = 50, small, disabled, ...rest }: BtnProps) {
  const v = VARIANTS[variant];
  return (
    <Pressable
      accessibilityRole="button"
      aria-disabled={!!disabled}
      disabled={disabled}
      {...rest}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: v.bg, minHeight: Math.max(HIT, small ? 44 : height), borderRadius: small ? 12 : 14, paddingHorizontal: small ? 12 : 16 },
        v.border ? { borderWidth: 1.5, borderColor: v.border } : null,
        disabled ? { opacity: 0.5 } : null,
        pressed ? { opacity: 0.8 } : null,
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={small ? 16 : 20} color={v.fg} strokeWidth={2.2} /> : null}
      <Txt weight="bold" size={small ? 13 : 15} color={v.fg}>{title}</Txt>
    </Pressable>
  );
}

type IconBtnProps = Omit<PressableProps, 'style' | 'children'> & {
  icon: IconName;
  label: string;
  color?: string;
  bg?: string;
  size?: number;
  iconSize?: number;
  round?: boolean;
  style?: StyleProp<ViewStyle>;
};
/** Icon-only button: always has an accessibilityLabel and a ≥44pt target. */
export function IconBtn({ icon, label, color = C.greenDark, bg = 'transparent', size = HIT, iconSize = 22, round = true, style, ...rest }: IconBtnProps) {
  const s = Math.max(HIT, size);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      {...rest}
      style={({ pressed }) => [
        { width: s, height: s, borderRadius: round ? s / 2 : 12, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' },
        pressed ? { opacity: 0.7 } : null,
        style,
      ]}
    >
      <Icon name={icon} size={iconSize} color={color} strokeWidth={2.2} />
    </Pressable>
  );
}

type FieldProps = TextInputProps & { label?: string; containerStyle?: StyleProp<ViewStyle> };
export const Field = forwardRef<TextInput, FieldProps>(function Field({ label, containerStyle, style, ...rest }, ref) {
  return (
    <View style={[{ gap: 6 }, containerStyle]}>
      {label ? <Txt weight="semibold" size={13} color={C.secondary}>{label}</Txt> : null}
      <TextInput
        ref={ref}
        accessibilityLabel={rest.accessibilityLabel ?? label}
        placeholderTextColor={C.secondary}
        {...rest}
        style={[styles.input, style]}
      />
    </View>
  );
});

export function ErrorMsg({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error} testID="error">
      <Txt weight="semibold" size={14} color={C.danger}>{message}</Txt>
    </View>
  );
}

export function InfoMsg({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View accessibilityLiveRegion="polite" style={styles.info} testID="info">
      <Txt weight="semibold" size={14} color={C.greenDark}>{message}</Txt>
    </View>
  );
}

export function Loading() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }} accessibilityLabel="Yükleniyor" testID="loading">
      <ActivityIndicator color={C.green} />
    </View>
  );
}

export function Empty({ text, testID }: { text: string; testID?: string }) {
  return <Txt testID={testID} size={14} color={C.secondary} style={{ paddingVertical: 12 }}>{text}</Txt>;
}

/** Tinted circle with the dark category glyph (place rows, plan rows). */
export function CategoryIcon({ category, size = 44, glyph }: { category: string; size?: number; glyph?: number }) {
  const c = categoryInfo(category);
  return (
    <View
      testID="category-icon"
      accessibilityRole="image"
      accessibilityLabel={c.title}
      {...webData({ category: c.key })}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.tint, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
    >
      <CatGlyph category={c.key} size={glyph ?? Math.round(size / 2)} color={c.color} />
    </View>
  );
}

export function Avatar({ name, size = 36, color }: { name: string; size?: number; color?: string }) {
  const AV = ['#2E7D5B', '#C2610C', '#2F5F9E', '#9E3359', '#5C54B3'];
  const bg = color ?? AV[[...name].reduce((n, ch) => n + ch.charCodeAt(0), 0) % AV.length];
  return (
    <View accessible={false} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Txt weight="extrabold" size={size * 0.42} color={C.white}>{(name[0] ?? '?').toUpperCase()}</Txt>
    </View>
  );
}

export function Pill({ text, bg = C.white, color = C.greenDark, icon, testID }: { text: string; bg?: string; color?: string; icon?: IconName; testID?: string }) {
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: bg, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, alignSelf: 'flex-start' }}>
      {icon ? <Icon name={icon} size={14} color={color} /> : null}
      <Txt weight="bold" size={12} color={color}>{text}</Txt>
    </View>
  );
}

/** Segmented control (Liste / Harita / Plan) — #EEF4F1 track, green selected segment. */
export function Segmented<T extends string>({ options, value, onChange, label }: {
  options: { key: T; label: string; testID?: string }[]; value: T; onChange: (k: T) => void; label: string;
}) {
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={styles.segTrack}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            testID={o.testID}
            accessibilityRole="tab"
            aria-selected={on}
            onPress={() => onChange(o.key)}
            style={[styles.seg, on ? { backgroundColor: C.green } : null]}
          >
            <Txt weight={on ? 'bold' : 'semibold'} size={14} color={on ? C.white : C.secondary}>{o.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Confirmation dialog (works on web too, unlike Alert.alert). */
export function ConfirmDialog({ visible, title, message, confirmLabel, onConfirm, onCancel, testID, confirmTestID, cancelTestID }: {
  visible: boolean; title: string; message: string; confirmLabel: string;
  onConfirm: () => void; onCancel: () => void; testID?: string; confirmTestID?: string; cancelTestID?: string;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View testID={testID} accessibilityRole="alert" accessibilityViewIsModal style={styles.dialog}>
          <Txt weight="extrabold" size={20} color={C.text}>{title}</Txt>
          <Txt size={15} color={C.secondary} style={{ lineHeight: 21 }}>{message}</Txt>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
            <Btn title="Vazgeç" variant="outline" onPress={onCancel} testID={cancelTestID} style={{ flex: 1 }} />
            <Btn title={confirmLabel} variant="danger" onPress={onConfirm} testID={confirmTestID} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Toggle switch styled like ListShare.dc.html (50×30, green when on). */
export function SwitchRow({ on, label, sub, onChange, testID, last }: { on: boolean; label: string; sub: string; onChange: () => void; testID: string; last?: boolean }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={label}
      aria-checked={on}
      onPress={onChange}
      style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, minHeight: HIT, gap: 12 }, last ? null : { borderBottomWidth: 1, borderBottomColor: C.divider }]}
    >
      <View style={{ flex: 1 }}>
        <Txt weight="semibold" size={15}>{label}</Txt>
        <Txt size={12} color={C.secondary}>{sub}</Txt>
      </View>
      <View style={{ width: 50, height: 30, borderRadius: 15, backgroundColor: on ? C.green : C.muted, justifyContent: 'center' }}>
        <View style={{ position: 'absolute', top: 3, left: on ? 23 : 3, width: 24, height: 24, borderRadius: 12, backgroundColor: C.white }} />
      </View>
    </Pressable>
  );
}

export const fmtAvg = (n: number | null): string => (n === null ? '–' : Number(n).toFixed(1).replace('.', ','));

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'şimdi';
  if (s < 3600) return `${Math.floor(s / 60)} dk önce`;
  if (s < 86400) return `${Math.floor(s / 3600)} sa önce`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} gün önce`;
  return `${Math.floor(s / (7 * 86400))} hafta önce`;
}

export const styles = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  input: {
    minHeight: 48, borderRadius: 14, backgroundColor: C.input, paddingHorizontal: 14, paddingVertical: 12,
    fontFamily: F.regular, fontSize: 15, color: C.text,
  },
  error: { backgroundColor: C.dangerTint, borderRadius: 12, padding: 12 },
  info: { backgroundColor: C.greenCard, borderRadius: 12, padding: 12 },
  segTrack: { backgroundColor: C.input, borderRadius: 12, padding: 3, flexDirection: 'row', gap: 2 },
  seg: { flex: 1, minHeight: HIT, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(23,37,30,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: C.white, borderRadius: 22, padding: 20, gap: 10, width: '100%', maxWidth: 420 },
  row: { flexDirection: 'row', alignItems: 'center' },
});

/** Çevrimdışı yapılmış, sunucuya henüz gitmemiş değişiklik işareti (AC-OFF-2). */
export const PENDING_TEXT = 'Eşitlenmeyi bekliyor';
export function PendingBadge({ testID = 'pending-badge', style }: { testID?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      testID={testID}
      accessibilityLabel={PENDING_TEXT}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: C.orangeTint, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }, style]}
    >
      <Icon name="refresh" size={11} color={C.orangeText} strokeWidth={2.4} />
      <Txt weight="bold" size={11} color={C.orangeText}>{PENDING_TEXT}</Txt>
    </View>
  );
}
