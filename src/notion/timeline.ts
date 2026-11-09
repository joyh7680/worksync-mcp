import type { Worklog } from '../schemas/worklog.js';
import type { Page } from './types.js';
import { dateOf } from './types.js';
import type { Settings } from '../config/settings.js';
import { WorkSyncError } from '../services/validation.js';
export function ensureDates(task: Worklog, existing: Page | undefined, s: Settings) {
  if (!task.startDate || !task.endDate || task.dateBasis === 'unknown')
    throw new WorkSyncError('날짜 근거가 불명확합니다. 사용자 확인이 필요합니다.');
  if (existing && !task.allowDateOverwrite) {
    const p = s.notion.properties;
    if (
      (dateOf(existing.properties[p.start]) &&
        dateOf(existing.properties[p.start]) !== task.startDate) ||
      (dateOf(existing.properties[p.end]) && dateOf(existing.properties[p.end]) !== task.endDate)
    )
      throw new WorkSyncError(
        '기존 일정 변경은 allowDateOverwrite를 포함한 새 미리보기 승인이 필요합니다.',
      );
  }
}
