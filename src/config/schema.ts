import { z } from 'zod';
import { parseDurationMs } from '../utils/duration';

export const UNLIMITED_PROMPT_MAX_LENGTH = -1;
export const DEFAULT_PROMPT_MAX_LENGTH = UNLIMITED_PROMPT_MAX_LENGTH;
export const MAX_PROMPT_MAX_LENGTH = 256 * 1024;
export const DEFAULT_HIBERNATE_AFTER = '5m';
export const DEFAULT_HARNESS_SELF_UPDATE = false;
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

export const SettingsSchema = z.object({
  promptMaxLength: PromptMaxLengthSchema.default(DEFAULT_PROMPT_MAX_LENGTH),
  hibernateAfter: HibernateAfterSchema.default(DEFAULT_HIBERNATE_AFTER),
  harnessSelfUpdate: z.boolean().default(DEFAULT_HARNESS_SELF_UPDATE),
});

export const ProfileSchema = z.object({
  executable: z.string().min(1),
  cwd: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  description: z.string().optional(),
  createDirs: z.array(z.string()).optional(),
});

export const ConfigSchema = z
  .object({
    version: z.literal(1),
    settings: SettingsSchema.default({
      promptMaxLength: DEFAULT_PROMPT_MAX_LENGTH,
      hibernateAfter: DEFAULT_HIBERNATE_AFTER,
      harnessSelfUpdate: DEFAULT_HARNESS_SELF_UPDATE,
    }),
    profiles: z.record(z.string(), ProfileSchema),
  })
  .refine((data) => Object.keys(data.profiles).length > 0, {
    message: 'At least one profile is required',
  });

export type Profile = z.infer<typeof ProfileSchema>;
export type PromptMaxLength = z.infer<typeof PromptMaxLengthSchema>;
export type Config = z.infer<typeof ConfigSchema>;
