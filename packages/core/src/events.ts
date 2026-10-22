import { and, desc, eq, gt } from 'drizzle-orm';
import { getDb } from './db/client';
import { activityEvents, jobEvents } from './db/schema';
import { BOARD_CHANNEL, jobChannel, publish } from './redis';

export type ActivityInput = {
  kind: string;
  actorId?: string | null;
  comparisonId?: string | null;
  modelId?: string | null;
  summary?: string;
  payload?: Record<string, unknown>;
};

export async function logActivity(input: ActivityInput) {
  const [event] = await getDb()
    .insert(activityEvents)
    .values({
      kind: input.kind,
      actorId: input.actorId ?? null,
      comparisonId: input.comparisonId ?? null,
      modelId: input.modelId ?? null,
      summary: input.summary ?? '',
      payload: input.payload ?? {},
    })
    .returning();

  if (!event) return null;

  await publish(BOARD_CHANNEL, {
    id: event.id,
    type: event.kind,
    data: event,
  });

  return event;
}

export async function recentActivity(limit = 30) {
  return getDb()
    .select()
    .from(activityEvents)
    .orderBy(desc(activityEvents.id))
    .limit(limit);
}

export async function activityAfter(id: number, limit = 200) {
  return getDb()
    .select()
    .from(activityEvents)
    .where(gt(activityEvents.id, id))
    .orderBy(activityEvents.id)
    .limit(limit);
}

export type JobEventInput = {
  jobId: string;
  responseId?: string | null;
  kind: string;
  payload?: Record<string, unknown>;
};

export async function logJobEvent(input: JobEventInput) {
  const [event] = await getDb()
    .insert(jobEvents)
    .values({
      jobId: input.jobId,
      responseId: input.responseId ?? null,
      kind: input.kind,
      payload: input.payload ?? {},
    })
    .returning();

  if (!event) return null;

  await publish(jobChannel(input.jobId), {
    id: event.id,
    type: event.kind,
    data: event,
  });

  return event;
}

export async function jobEventsAfter(jobId: string, id: number, limit = 500) {
  return getDb()
    .select()
    .from(jobEvents)
    .where(and(eq(jobEvents.jobId, jobId), gt(jobEvents.id, id)))
    .orderBy(jobEvents.id)
    .limit(limit);
}
