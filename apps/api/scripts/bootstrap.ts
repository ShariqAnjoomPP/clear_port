/** Creates the database roles (run once per environment, as the owner/admin role). */
import pg from 'pg';

const url = process.env.DATABASE_OWNER_URL;
const appPassword = process.env.APP_DB_PASSWORD;
if (!url || !appPassword) throw new Error('DATABASE_OWNER_URL and APP_DB_PASSWORD are required');

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query(`
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clearport_app') THEN
      CREATE ROLE clearport_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clearport_definer') THEN
      CREATE ROLE clearport_definer NOLOGIN NOSUPERUSER NOBYPASSRLS;
    END IF;
  END $$;`);
await client.query(`ALTER ROLE clearport_app PASSWORD ${client.escapeLiteral(appPassword)}`);
await client.query('GRANT clearport_definer TO CURRENT_USER');
await client.end();
console.log('Roles ready: clearport_app (API), clearport_definer (token lookups)');
