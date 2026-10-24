/** Gives the demo user its sign-in (demouser / Demo@123, or SEED_DEMO_PASSWORD) on a database seeded before sign-in existed. */
import { eq } from 'drizzle-orm';
import { db, pool } from '../../src/lib/db';
import { hashPassword } from '../../src/lib/passwords';
import { appUser } from '../../src/lib/schema';

const rows = await db.update(appUser)
  .set({ username: 'demouser', passwordHash: await hashPassword(process.env.SEED_DEMO_PASSWORD || 'Demo@123') })
  .where(eq(appUser.email, 'demo@clearport.local'))
  .returning({ id: appUser.id });
await pool.end();
console.log(rows.length ? 'Demo sign-in set: demouser' : 'No demo user found (run the seed first)');
