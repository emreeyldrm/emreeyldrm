import { Redirect, Stack } from 'expo-router';
import { Loading } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { C } from '../../theme';

/** Every route in (app) requires a session; otherwise go to the login screen (AC-MOB-2). */
export default function AppLayout() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Redirect href="/login" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.white } }} />;
}
