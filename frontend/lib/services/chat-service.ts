import { supabase } from '@/lib/supabase/client'

export async function listChats() {
  const u = await supabase.auth.getUser()
  const uid = u.data.user?.id
  if (!uid) throw new Error('Not authenticated')
  const prof = await supabase.from('profiles').select('id').eq('user_id', uid).limit(1).single()
  const pid = prof.data?.id
  const { data, error } = await supabase
    .from('chat_participants')
    .select('chat_id, last_read_at, chats:chat_id(id,title,type,created_at)')
    .eq('user_id', pid)
  if (error) throw error
  return data || []
}

export async function listMessages(chatId: string) {
  const { data, error } = await supabase
    .from('messages')
    .select('id, sender_id, content, attachments, reply_to, created_at')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function sendMessage(chatId: string, content: string) {
  const u = await supabase.auth.getUser()
  const uid = u.data.user?.id
  if (!uid) throw new Error('Not authenticated')
  const prof = await supabase.from('profiles').select('id').eq('user_id', uid).limit(1).single()
  const pid = prof.data?.id
  const { error } = await supabase.from('messages').insert({ chat_id: chatId, sender_id: pid, content })
  if (error) throw error
}

export async function createDirectChat(otherProfileId: string) {
  const u = await supabase.auth.getUser()
  const uid = u.data.user?.id
  if (!uid) throw new Error('Not authenticated')
  const prof = await supabase.from('profiles').select('id').eq('user_id', uid).limit(1).single()
  const pid = prof.data?.id
  const { data: chat } = await supabase.from('chats').insert({ type: 'direct' }).select('id').single()
  if (!chat?.id) throw new Error('Failed to create chat')
  await supabase.from('chat_participants').insert([{ chat_id: chat.id, user_id: pid }, { chat_id: chat.id, user_id: otherProfileId }])
  return chat.id as string
}