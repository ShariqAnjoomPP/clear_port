-- Staff sign-in for the hosted demo, and file storage in the database (free hosting has no disk).
ALTER TABLE app_user
  ADD COLUMN username text UNIQUE,
  ADD COLUMN password_hash text;
-- The existing demo user signs in as "demouser"; its password is set by the seed (or below, for databases seeded earlier).
UPDATE app_user SET username = 'demouser' WHERE username IS NULL AND email = 'demo@clearport.local';

CREATE TABLE file_blob (
  storage_key text PRIMARY KEY,
  bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
