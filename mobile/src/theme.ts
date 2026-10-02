/** Design tokens from docs/design/*.dc.html */
export const C = {
  green: '#2E7D5B',
  greenDark: '#1F6648',
  greenCard: '#E6F5EB',
  greenSoft: '#F3FAF6',
  rowBg: '#F6FAF8',
  orange: '#F28C28',
  orangeText: '#C2610C',
  orangeOn: '#2B1700',
  orangeTint: '#FFF1E2',
  input: '#EEF4F1',
  text: '#17251E',
  secondary: '#4F6158',
  tabInactive: '#5F6F66',
  border: '#D6E6DC',
  divider: '#E8EFEB',
  dash: '#9CC5AF',
  muted: '#C9D8CF',
  mapBg: '#EAF3EC',
  white: '#FFFFFF',
  danger: '#B3261E',
  dangerTint: '#FDECEA',
};

export const F = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
} as const;

export type Weight = keyof typeof F;

/** Minimum touch target (pt). */
export const HIT = 44;
