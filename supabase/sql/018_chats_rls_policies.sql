-- Add missing RLS policies for chats table
-- This fixes a critical security vulnerability where anyone could read all chat rooms

-- Policy: Users can only see chats they participate in
create policy chats_select on chats for select using (
  exists (
    select 1 from chat_participants cp 
    where cp.chat_id = chats.id 
    and cp.user_id = (select auth.uid())
  )
);

-- Policy: Only authenticated users can create chats
create policy chats_insert on chats for insert to authenticated with check (true);

-- Policy: Only chat participants can update chat information
create policy chats_update on chats for update to authenticated using (
  exists (
    select 1 from chat_participants cp 
    where cp.chat_id = chats.id 
    and cp.user_id = (select auth.uid())
  )
) with check (
  exists (
    select 1 from chat_participants cp 
    where cp.chat_id = chats.id 
    and cp.user_id = (select auth.uid())
  )
);

-- Policy: Only chat participants can delete chats
create policy chats_delete on chats for delete to authenticated using (
  exists (
    select 1 from chat_participants cp 
    where cp.chat_id = chats.id 
    and cp.user_id = (select auth.uid())
  )
);

-- Add indexes for performance
create index if not exists chat_participants_user_id_idx on chat_participants(user_id);
create index if not exists chat_participants_chat_id_idx on chat_participants(chat_id);
create index if not exists messages_chat_id_idx on messages(chat_id);
create index if not exists messages_sender_id_idx on messages(sender_id);

-- Grant appropriate permissions
grant select on chats to authenticated;
grant insert on chats to authenticated;
grant update on chats to authenticated;
grant delete on chats to authenticated;