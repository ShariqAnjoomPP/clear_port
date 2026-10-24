-- How customers reach the agency from the public tracking page (WhatsApp, call, email buttons).
ALTER TABLE company_settings
  ADD COLUMN phone text,
  ADD COLUMN whatsapp text,
  ADD COLUMN email text;
