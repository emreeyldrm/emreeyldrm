import { useState } from 'react';
import { Redirect, router } from 'expo-router';
import { AuthShell } from '../components/AuthForm';
import { Btn, ErrorMsg, Field } from '../components/ui';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function Login() {
  const { user, loading, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Redirect href="/lists" />;

  async function submit() {
    setError(null);
    if (!email.trim() || !password) { setError('E-posta ve parola gerekli.'); return; }
    setBusy(true);
    try {
      const r = await api.login(email.trim(), password);
      await signIn(r.token, r.user);
      router.replace('/lists');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Giriş yap" subtitle="Listelerine ve planlarına devam et." testID="login-form">
      <Field label="E-posta" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" inputMode="email" testID="login-email" />
      <Field label="Parola" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" testID="login-password" onSubmitEditing={submit} />
      <ErrorMsg message={error} />
      <Btn title={busy ? 'Giriş yapılıyor…' : 'Giriş yap'} onPress={submit} disabled={busy} testID="login-submit" />
      <Btn title="Hesabın yok mu? Kayıt ol" variant="ghost" onPress={() => router.replace('/register')} testID="go-register" />
    </AuthShell>
  );
}
