import { z } from 'zod';

export const dateSchema = z.iso.date();
export const idSchema = z.uuid();
export const evidenceSchema = z
  .object({
    kind: z.enum(['git', 'document', 'conversation', 'manual']),
    sourceId: z.string().min(1).max(500),
    id: z.string().min(1).max(500),
    url: z
      .url()
      .refine((v) => /^https?:\/\//.test(v), 'HTTP(S) URL만 허용')
      .optional(),
    note: z.string().min(1).max(1000),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.kind === 'git' && !/^[a-f0-9]{40}([a-f0-9]{24})?$/.test(v.id))
      ctx.addIssue({ code: 'custom', message: 'Git 근거는 전체 커밋 해시가 필요합니다.' });
  });
export const worklogSchema = z
  .object({
    title: z.string().trim().min(1).max(150),
    description: z.string().trim().min(1).max(3000),
    startDate: dateSchema.nullable(),
    endDate: dateSchema.nullable(),
    dateBasis: z.enum(['git_observed', 'user_confirmed', 'document_confirmed', 'unknown']),
    status: z.string().min(1).max(100),
    statusConfirmed: z.boolean(),
    statusEvidence: z.string().min(1).max(500),
    evidence: z.array(evidenceSchema).min(1).max(30),
    parentId: idSchema,
    updatePageId: idSchema.optional(),
    allowDateOverwrite: z.boolean().default(false),
    progress: z.number().min(0).max(100).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.startDate && v.endDate && v.startDate > v.endDate)
      ctx.addIssue({
        code: 'custom',
        message: '시작일은 종료일보다 늦을 수 없습니다.',
        path: ['endDate'],
      });
  });
export const previewSchema = z.object({ tasks: z.array(worklogSchema).min(1).max(20) }).strict();
export type Worklog = z.infer<typeof worklogSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export const evidenceKey = (e: Evidence) => JSON.stringify([e.kind, e.sourceId, e.id]);
