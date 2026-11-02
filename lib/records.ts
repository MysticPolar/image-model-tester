import { recordFiles } from '../public/records-core.js';

export const archivePrefix = (userId:string) => 'test-records/' + encodeURIComponent(userId) + '/';
export async function archiveRecords(bucket:R2Bucket,userId:string,revision:string,workspace:{runs:unknown[]}) {
  const prefix = archivePrefix(userId);
  // Revision-scoped metadata prevents concurrent saves from overwriting each other.
  // Image bytes are immutable for a run, so store them once under their named path.
  for (const file of recordFiles(workspace.runs)) {
    const image = file.type.startsWith('image/');
    const key = prefix + (image ? 'assets/' : `revisions/${revision}/`) + file.name;
    if (image && await bucket.head(key)) continue;
    await bucket.put(key, file.data, {httpMetadata:{contentType:file.type}});
  }
}
