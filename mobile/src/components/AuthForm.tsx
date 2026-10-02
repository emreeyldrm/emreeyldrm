import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { C } from '../theme';
import { Icon } from './Icon';
import { Screen, Txt } from './ui';

/** Shared shell for login/register: brand mark, big title, form card. */
export function AuthShell({ title, subtitle, children, testID }: { title: string; subtitle: string; children: ReactNode; testID: string }) {
  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 40, gap: 20, maxWidth: 480, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="pin" color={C.white} size={22} strokeWidth={2.2} />
            </View>
            <Txt weight="extrabold" size={22} color={C.greenDark}>Voyage</Txt>
          </View>
          <View>
            <Txt weight="extrabold" size={34} accessibilityRole="header" style={{ letterSpacing: -0.5 }}>{title}</Txt>
            <Txt size={14} color={C.secondary} style={{ marginTop: 6 }}>{subtitle}</Txt>
          </View>
          <View testID={testID} style={{ backgroundColor: C.greenCard, borderRadius: 20, padding: 18, gap: 14 }}>
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
