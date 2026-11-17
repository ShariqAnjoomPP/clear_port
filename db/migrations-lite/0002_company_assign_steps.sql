-- Per-step assignment is optional: a one-person agency does every step itself; larger teams switch it on in Settings.
-- When off, steps that normally need an assignee (File Bayan, Apply for DO, Apply for CCRO) don't wait for one.
ALTER TABLE company_settings ADD COLUMN assign_steps boolean NOT NULL DEFAULT false;
