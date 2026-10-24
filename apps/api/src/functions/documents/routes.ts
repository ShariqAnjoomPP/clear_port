import { z } from 'zod';
import { DocumentMetaInput } from '@clearport/contracts';
import { db } from '../../lib/db';
import { badRequest } from '../../lib/errors';
import { createFunction, parseBody } from '../../lib/http';
import { readDocument, setCustomerVisible, uploadDocument } from './service';

const app = createFunction();

/** multipart/form-data: `file` plus the DocumentMetaInput fields. */
app.post('/', async (c) => {
  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) throw badRequest('Attach the file in a "file" field');
  const meta = DocumentMetaInput.parse(Object.fromEntries(Object.entries(form).filter(([k]) => k !== 'file')));
  const bytes = new Uint8Array(await file.arrayBuffer());
  return c.json(await uploadDocument(db, meta, { name: file.name, type: file.type, bytes }, c.get('user').name), 201);
});

app.get('/:id/file', async (c) => {
  const { doc, bytes } = await readDocument(db, c.req.param('id'));
  return c.body(new Uint8Array(bytes), 200, {
    'content-type': doc.contentType,
    'content-disposition': `inline; filename="${encodeURIComponent(doc.fileName)}"`,
    'cache-control': 'private, max-age=60',
  });
});

app.patch('/:id', async (c) => {
  const { customerVisible } = await parseBody(c, z.object({ customerVisible: z.boolean() }));
  return c.json(await setCustomerVisible(db, c.req.param('id'), customerVisible));
});

export default app;
