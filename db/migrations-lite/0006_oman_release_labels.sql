-- Oman wording: the release step is the port release (gate pass), not Dubai's CCRO.
-- Labels only; stage and status keys stay the same, so running jobs and reports are unaffected.
UPDATE workflow_definition SET definition = replace(replace(replace(replace(replace(replace(replace(replace(
  definition::text,
  '"CCRO (release order)"', '"Port release (gate pass)"'),
  '"أمر الإفراج"', '"الإفراج من الميناء"'),
  '"CCRO no."', '"Release no."'),
  '"رقم الأمر"', '"رقم الإفراج"'),
  '"Apply for CCRO"', '"Apply for port release"'),
  '"CCRO issued"', '"Port release issued"'),
  '"صدر أمر الإفراج"', '"صدر الإفراج"'),
  '"CCRO gate"', '"Port release"')::jsonb;
