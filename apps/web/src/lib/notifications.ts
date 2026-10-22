/** The JSON shape `GET /api/notifications` returns for one row. */
export type NotificationItem = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
  comparison: { id: string; title: string; status: string } | null;
};

export type NotificationLike = Pick<NotificationItem, 'kind' | 'payload' | 'comparison'>;

function comparisonId(item: NotificationLike) {
  const id = item.payload.comparisonId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * A published Comparison is readable by everyone, so the notification opens it.
 * While it is still a draft only the author can see it, and the Job page is the
 * place that offers Publish.
 */
export function notificationHref(item: NotificationLike): string | null {
  const id = comparisonId(item);
  if (!id) return null;
  return item.comparison?.status === 'published'
    ? `/comparisons/${id}`
    : `/comparisons/${id}/job`;
}

export function notificationLabel(item: NotificationLike): string {
  switch (item.kind) {
    case 'job.ready':
      return 'Your comparison is ready';
    default:
      return 'Notification';
  }
}
