import { getCurrentUser } from '@/lib/auth';
import { json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return json({ user: null });
  return json({
    user: {
      id: user.id,
      handle: user.handle,
      role: user.role,
      avatarUrl: user.avatarUrl ?? user.image,
    },
  });
}
