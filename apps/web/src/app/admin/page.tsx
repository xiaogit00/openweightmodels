import { notFound } from 'next/navigation';
import { getAdminOverview } from '@owm/core';
import { getCurrentUser } from '@/lib/auth';
import { AdminClient } from '@/components/admin-client';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Admin — OpenWeightModels',
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const user = await getCurrentUser();
  // Missing and non-admin viewers see the same 404, so the surface never
  // reveals itself to ordinary users.
  if (!user || user.role !== 'admin') notFound();

  const overview = await getAdminOverview(user.id);

  return <AdminClient handle={user.handle ?? user.id.slice(0, 8)} overview={overview} />;
}
