import {
  getNotifications,
  getUnreadNotificationCount,
  markNotificationsRead,
} from '@owm/core';
import { apiError, json, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { notificationPatchSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const user = await requireUser();
    const [items, unread] = await Promise.all([
      getNotifications(user.id),
      getUnreadNotificationCount(user.id),
    ]);
    return json({ items, unread });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const body = notificationPatchSchema.parse(await readJson(request));
    await markNotificationsRead(user.id, body.id);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
