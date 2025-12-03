alter table profiles
  add column if not exists title text,
  add column if not exists bio text,
  add column if not exists location text,
  add column if not exists cover_image text;
-- Update profile service to use real columns
-- No data migration needed; fields were previously empty