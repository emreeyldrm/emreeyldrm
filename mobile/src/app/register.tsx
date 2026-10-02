import { useState } from 'react';
import { Redirect, router } from 'expo-router';
import { AuthShell } from '../components/AuthForm';
import { Btn, ErrorMsg, Field, Txt } from '../components/ui';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { C } from '../theme';

export default function Register() {
  const { user, loading, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Redirect href="/lists" />;

  async function submit() {
    setError(null);
    if (!/^[a-z0-9_]{3,20}$/.test(handle)) { setError('Kullanıcı adı 3-20 karakter olmalı: küçük harf, rakam veya _.'); return; }
    if (password.length < 8) { setError('Parola en az 8 karakter olmalı.'); return; }
    setBusy(true);
    try {
      const r = await api.register(email.trim(), password, handle);
      await signIn(r.token, r.user);
      router.replace('/lists');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Kayıt ol" subtitle="Şehir listelerini kaydet, planla ve paylaş." testID="register-form">
      <Field label="E-posta" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" inputMode="email" testID="register-email" />
      <Field label="Kullanıcı adı" value={handle} onChangeText={(t) => setHandle(t.trim())} autoCapitalize="none" autoCorrect={false} testID="register-handle" />
      <Txt size={12} color={C.secondary}>3-20 karakter: küçük harf, rakam veya _</Txt>
      <Field label="Parola" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" testID="register-password" onSubmitEditing={submit} />
      <ErrorMsg message={error} />
      <Btn title={busy ? 'Kaydediliyor…' : 'Kayıt ol'} onPress={submit} disabled={busy} testID="register-submit" />
      <Btn title="Zaten hesabın var mı? Giriş yap" variant="ghost" onPress={() => router.replace('/login')} testID="go-login" />
    </AuthShell>
  );
}
