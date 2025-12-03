create extension if not exists postgis;

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  reputation numeric default 0,
  rating_count int default 0,
  created_at timestamptz default now()
);

create table if not exists listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  description text not null,
  price numeric(12,2) not null check (price >= 0),
  main_category text not null check (main_category in ('Items','Services')),
  sub_category text not null check (sub_category in ('Buy','Sell','Free','I want','I will','I can')),
  status text not null default 'active' check (status in ('active','sold','suspended')),
  location geography(Point,4326) not null,
  address jsonb,
  created_at timestamptz default now()
);

create table if not exists listing_images (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  url text not null,
  main boolean default false
);

create table if not exists listing_tags (
  listing_id uuid not null references listings(id) on delete cascade,
  tag text not null
);

create table if not exists chats (
  id uuid primary key default gen_random_uuid(),
  title text,
  type text not null check (type in ('direct','group')),
  created_at timestamptz default now()
);

create table if not exists chat_participants (
  chat_id uuid not null references chats(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  last_read_at timestamptz,
  primary key (chat_id, user_id)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats(id) on delete cascade,
  sender_id uuid not null references profiles(id) on delete cascade,
  content text,
  attachments jsonb,
  reply_to uuid,
  created_at timestamptz default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  buyer_id uuid not null references profiles(id) on delete cascade,
  seller_id uuid not null references profiles(id) on delete cascade,
  amount numeric(12,2) not null,
  platform_fee numeric(12,2) not null,
  stripe_payment_intent text,
  status text not null check (status in ('requires_capture','completed','refunded','failed')),
  created_at timestamptz default now()
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id) on delete cascade,
  type text not null check (type in ('charge','transfer','refund')),
  amount numeric(12,2) not null,
  status text not null,
  created_at timestamptz default now()
);

create table if not exists disputes (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id) on delete cascade,
  reason text,
  status text not null check (status in ('open','resolved','refunded','rejected')),
  created_at timestamptz default now()
);

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  seller_id uuid not null references profiles(id) on delete cascade,
  reviewer_id uuid not null references profiles(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  comment text,
  votes jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null,
  payload jsonb,
  read boolean default false,
  created_at timestamptz default now()
);