import { z } from 'zod';
import path from 'node:path';
import { parseDurationMs } from '../utils/duration';

export const UNLIMITED_PROMPT_MAX_LENGTH = -1;
export const DEFAULT_PROMPT_MAX_LENGTH = UNLIMITED_PROMPT_MAX_LENGTH;
export const MAX_PROMPT_MAX_LENGTH = 256 * 1024;
export const DEFAULT_HIBERNATE_AFTER = '30m';
export const DEFAULT_HARNESS_SELF_UPDATE = false;
export const DEFAULT_MOUSE_PASSTHROUGH = true;
export const HIBERNATE_AFTER_PATTERN = /^(off|\d+(ms|s|m|h|d))$/;

export const PromptMaxLengthSchema = z.union([
  z.literal(UNLIMITED_PROMPT_MAX_LENGTH),
  z.number().int().min(1).max(MAX_PROMPT_MAX_LENGTH),
]);

export const HibernateAfterSchema = z
  .string()
  .regex(HIBERNATE_AFTER_PATTERN, 'must be a duration such as 30s, 5m, or 2h, or off')
  .refine((value) => parseDurationMs(value) !== null, {
    message: 'duration must be greater than zero and no longer than 30d, or off',
  });

const AbsoluteDirectorySchema = z
  .string()
  .refine((value) => path.isAbsolute(value) && path.resolve(value) === value, {
    message: 'must be a normalized absolute directory',
  });

export const WorkspaceProjectsSchema = z
  .array(
    z
      .object({
        source: AbsoluteDirectorySchema,
        root: AbsoluteDirectorySchema,
        project: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/),
      })
      .strict()
  )
  .max(128)
  .refine((links) => new Set(links.map((link) => link.source)).size === links.length, {
    message: 'each source directory must have only one Workspace project association',
  });
export type WorkspaceProject = z.infer<typeof WorkspaceProjectsSchema>[number];

export const SettingsSchema = z.object({
  promptMaxLength: PromptMaxLengthSchema.default(DEFAULT_PROMPT_MAX_LENGTH),
  hibernateAfter: HibernateAfterSchema.default(DEFAULT_HIBERNATE_AFTER),
  harnessSelfUpdate: z.boolean().default(DEFAULT_HARNESS_SELF_UPDATE),
  mousePassthrough: z.boolean().default(DEFAULT_MOUSE_PASSTHROUGH),
  workspaceRoot: z
    .string()
    .min(1)
    .refine(
      (value) => path.isAbsolute(value) || /^~(?:\/|$)/.test(value),
      'must be an absolute path or start with ~/'
    )
    .optional(),
  workspaceProjects: WorkspaceProjectsSchema.optional(),
});

export const WorkspaceBindingSchema = z
  .object({
    project: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/),
    role: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/),
    instance: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/)
      .optional(),
  })
  .strict();

export const ProfileSchema = z.object({
  executable: z.string().min(1),
  cwd: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  description: z.string().optional(),
  createDirs: z.array(z.string()).optional(),
  // Old profile-bound workspaces must be migrated, never silently stripped.
  workspace: z.undefined().optional(),
});

export const ConfigSchema = z
  .object({
    version: z.literal(1),
    settings: SettingsSchema.default({
      promptMaxLength: DEFAULT_PROMPT_MAX_LENGTH,
      hibernateAfter: DEFAULT_HIBERNATE_AFTER,
      harnessSelfUpdate: DEFAULT_HARNESS_SELF_UPDATE,
      mousePassthrough: DEFAULT_MOUSE_PASSTHROUGH,
    }),
    profiles: z.record(z.string(), ProfileSchema),
  })
  .refine((data) => Object.keys(data.profiles).length > 0, {
    message: 'At least one profile is required',
  });

export type Profile = z.infer<typeof ProfileSchema>;
export type PromptMaxLength = z.infer<typeof PromptMaxLengthSchema>;
export type Config = z.infer<typeof ConfigSchema>;
