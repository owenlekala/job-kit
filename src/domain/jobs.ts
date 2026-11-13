import type { Job } from './models.js';

/** Remove tracking parameters while preserving identifiers used by shared ATS portals. */
export function canonicalJobUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_|ref$|source$|trk$|tracking)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
}
export function duplicateJob(existing: Job[], incoming: Job) {
  return existing.find(
    (job) =>
      job.id !== incoming.id &&
      (canonicalJobUrl(job.url) === canonicalJobUrl(incoming.url) ||
        (job.companyId === incoming.companyId &&
          job.title.toLowerCase().trim() === incoming.title.toLowerCase().trim() &&
          (job.location ?? '').toLowerCase() === (incoming.location ?? '').toLowerCase())),
  );
}

export const localDate = (date: Date) =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    date,
  );
