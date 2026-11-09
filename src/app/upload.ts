export type UploadState = 'queued' | 'uploading' | 'done' | 'error';

export interface UploadRow {
  key: string;
  name: string;
  rel: string;
  size: number;
  state: UploadState;
  error?: string;
}

export interface Pick {
  token: string;
  name: string;
  rel: string;
  size: number;
}

export const toRows = (items: Pick[]): UploadRow[] => items.map((i) => ({ key: i.token, name: i.name, rel: i.rel, size: i.size, state: 'queued' }));

/** Uploads one file at a time so a failure never aborts the rest; reports each state change. */
export async function runUploads(
  items: Pick[],
  upload: (i: Pick) => Promise<{ ok: boolean; error?: string }>,
  onRow: (key: string, patch: Partial<UploadRow>) => void,
): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;
  for (const i of items) {
    onRow(i.token, { state: 'uploading' });
    try {
      const r = await upload(i);
      if (r.ok) {
        done++;
        onRow(i.token, { state: 'done' });
      } else {
        failed++;
        onRow(i.token, { state: 'error', error: r.error || 'Upload failed.' });
      }
    } catch (e) {
      failed++;
      onRow(i.token, { state: 'error', error: (e as Error).message });
    }
  }
  return { done, failed };
}

export interface Grouped<T> {
  project: string;
  docs: T[];
}

/** Groups documents by project (unassigned last), keeping folder order inside each project. */
export function groupByProject<T extends { project?: string; rel?: string; name: string }>(docs: T[]): Grouped<T>[] {
  const m = new Map<string, T[]>();
  for (const d of docs) {
    const k = d.project || '';
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(d);
  }
  return [...m.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([project, list]) => ({ project, docs: list.sort((a, b) => ((a.rel || '') + '/' + a.name).localeCompare((b.rel || '') + '/' + b.name)) }));
}

export function filterDocumentsByName<T extends { name: string }>(docs: T[], query: string): T[] {
  const search = query.trim().toLocaleLowerCase();
  return search ? docs.filter((doc) => doc.name.toLocaleLowerCase().includes(search)) : docs;
}

export function reviewStatusCounts<T extends { reviews?: { done: boolean }[] }>(docs: T[]): { pending: number; done: number } {
  return docs.reduce((counts, doc) => {
    if (doc.reviews?.length && doc.reviews.every((review) => review.done)) counts.done++;
    else counts.pending++;
    return counts;
  }, { pending: 0, done: 0 });
}

export function formatReviewStatusCounts(counts: { pending: number; done: number }): string {
  return `(${counts.pending} - Pending, ${counts.done} Done.)`;
}
