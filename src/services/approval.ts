import type { Store } from './store.js';
import { hash, WorkSyncError } from './validation.js';
export function requirePreview(store: Store, id: string, digest: string, approved = false) {
  const p = store.preview(id);
  if (!p || p.digest !== digest || hash(JSON.parse(p.data)) !== digest)
    throw new WorkSyncError('미리보기 내용/버전이 일치하지 않습니다.', 'PREVIEW_MISMATCH');
  if (p.expires <= Date.now())
    throw new WorkSyncError(
      '미리보기가 만료되었습니다. 새 미리보기를 만드세요.',
      'PREVIEW_EXPIRED',
    );
  if (approved && !p.approved)
    throw new WorkSyncError(
      '별도 터미널의 사용자 승인이 필요합니다. approved 값으로 우회할 수 없습니다.',
      'APPROVAL_REQUIRED',
    );
  return p;
}
export function approveInteractively(
  store: Store,
  id: string,
  digest: string,
  answer: string,
  isTTY: boolean,
) {
  if (!isTTY) throw new WorkSyncError('사용자의 대화형 터미널에서만 승인할 수 있습니다.');
  const p = requirePreview(store, id, digest);
  const data = JSON.parse(p.data) as { items: { action: string }[] };
  if (data.items.some((i) => i.action === 'needs_confirmation'))
    throw new WorkSyncError('확인 필요 항목을 해결한 후 새 미리보기를 승인하세요.');
  if (answer !== `승인 ${digest.slice(0, 12)}`)
    throw new WorkSyncError('승인 문구가 일치하지 않습니다.');
  store.approve(id, digest);
}
