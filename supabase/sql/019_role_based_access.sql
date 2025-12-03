-- Add role-based access control to profiles table
-- This migration adds role column and creates indexes for efficient role-based queries

-- Add role column to profiles table
alter table profiles add column if not exists role text default 'user' check (role in ('user', 'moderator', 'admin', 'super_admin'));

-- Create index for role-based queries
create index if not exists profiles_role_idx on profiles(role);

-- Create index for user_id lookups (should already exist but let's ensure it)
create index if not exists profiles_user_id_idx on profiles(user_id);

-- Update existing admin users based on ADMIN_EMAILS environment variable
-- This will be run as a one-time migration to convert existing email-based admins
update profiles 
set role = 'admin' 
where user_id in (
  select id from auth.users 
  where email = any(string_to_array(current_setting('app.settings.admin_emails', true), ','))
) and role = 'user';

-- Add RLS policy for role updates (only admins can update roles)
create policy profiles_role_update on profiles for update to authenticated using (
  exists (
    select 1 from profiles p2 
    where p2.user_id = (select auth.uid()) 
    and p2.role in ('admin', 'super_admin')
  )
) with check (
  exists (
    select 1 from profiles p2 
    where p2.user_id = (select auth.uid()) 
    and p2.role in ('admin', 'super_admin')
  )
);

-- Grant permissions for role column
grant select (role) on profiles to authenticated;
grant update (role) on profiles to authenticated;