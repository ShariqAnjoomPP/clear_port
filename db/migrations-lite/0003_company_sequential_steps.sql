-- Steps one by one: a workflow step can start only after the step before it is complete
-- (Documents → Bayan → Customer → Inspection → DO → CCRO, and truck → inspection → release → delivery per container).
-- Teams that run the DO alongside customs can switch this off in Settings.
ALTER TABLE company_settings ADD COLUMN sequential_steps boolean NOT NULL DEFAULT true;
