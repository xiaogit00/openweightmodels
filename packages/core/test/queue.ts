import { getRunQueue } from '../src/index';

/**
 * Remove queued and delayed BullMQ jobs for Runs a test created, so a fixture's
 * cleanup does not leave work behind for the next file.
 */
export async function removeQueuedRuns(responseIds: string[]) {
  const jobs = await getRunQueue().getJobs(['wait', 'delayed', 'prioritized']);
  await Promise.all(
    jobs
      .filter((job) => responseIds.includes(String(job.data?.responseId ?? '')))
      .map((job) => job.remove().catch(() => {})),
  );
}
