import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { idSchema } from '../schemas/worklog.js';
import { WorkSyncError } from '../services/validation.js';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const settingsSchema = z
  .object({
    user: z.object({ id: z.string().min(1), name: z.string().min(1), notionUserId: idSchema }),
    team: z.string().min(1),
    timezone: z.literal('Asia/Seoul').default('Asia/Seoul'),
    git: z.object({
      defaultRepository: z.string(),
      allowedRepositories: z.array(z.string()),
      defaultBranch: z.string().default('main'),
      author: z.string().min(1),
    }),
    notion: z.object({
      databaseId: idSchema,
      dataSourceId: idSchema,
      defaultParentId: idSchema,
      allowedParentIds: z.array(idSchema).min(1),
      stage: z.string().default('5. 세부 할 일'),
      properties: z.object({
        title: z.string(),
        description: z.string(),
        start: z.string(),
        end: z.string(),
        status: z.string(),
        team: z.string(),
        participants: z.string(),
        stage: z.string(),
        progress: z.string().optional(),
      }),
      subitems: z
        .object({
          parentPropertyId: z.string().min(1),
          childPropertyId: z.string().min(1),
          verificationViewId: idSchema,
          confirmedInNotionUi: z.boolean(),
        })
        .nullable()
        .default(null),
      targetViewId: idSchema.optional(),
    }),
    stateDirectory: z.string().default('.worksync'),
  })
  .strict();
export type Settings = z.infer<typeof settingsSchema>;
// Remote implementations must derive user identity from authenticated request context.
export interface IdentityProvider {
  getSettings(): Settings;
}
export class LocalIdentityProvider implements IdentityProvider {
  constructor(private settings: Settings) {}
  getSettings() {
    return structuredClone(this.settings);
  }
}
export function loadSettings(
  path = process.env.WORKSYNC_SETTINGS ?? resolve(projectRoot, 'settings.json'),
): Settings {
  const settingsPath = resolve(path);
  if (!existsSync(settingsPath))
    throw new WorkSyncError(
      '개인 설정 파일이 없습니다. npm run setup 실행 후 WORKSYNC_SETTINGS 경로를 확인하세요.',
      'SETTINGS_MISSING',
    );
  const raw = JSON.parse(readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, ''));
  const s = settingsSchema.parse(raw);
  const base = dirname(settingsPath);
  const absolute = (p: string) => (isAbsolute(p) ? resolve(p) : resolve(base, p));
  s.stateDirectory = absolute(s.stateDirectory);
  s.git.defaultRepository = absolute(s.git.defaultRepository);
  s.git.allowedRepositories = s.git.allowedRepositories.map(absolute);
  return s;
}
export function loadEnvironment() {
  const path = resolve(projectRoot, '.env');
  if (existsSync(path)) process.loadEnvFile(path);
}
