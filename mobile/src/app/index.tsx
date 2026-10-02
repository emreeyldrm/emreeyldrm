import { Redirect } from 'expo-router';
import { Loading } from '../components/ui';
import { useAuth } from '../lib/auth';

export default function Index() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  return <Redirect href={user ? '/lists' : '/login'} />;
}
