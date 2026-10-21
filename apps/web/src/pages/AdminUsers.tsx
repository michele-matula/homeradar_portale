import type { Me } from '@homeradar/shared/api/types';
import { Layout } from '../components/Layout';

export function AdminUsers({ me, onSignOut }: { me: Me; onSignOut(): void }) {
  return (
    <Layout me={me} onSignOut={onSignOut}>
      <h1>Utenti</h1>
    </Layout>
  );
}
