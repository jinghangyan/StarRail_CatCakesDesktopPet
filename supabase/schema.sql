-- ============================================================
-- 桌宠猫猫 Supabase 数据库结构
-- 用法：在 Supabase 控制台 → SQL Editor → New query，把本文件全部粘贴进去执行一次
-- ============================================================

-- 用户资料（注册时自动创建，username 用于加好友）
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  created_at timestamptz not null default now()
);

-- 好友关系（互相添加即成为好友，MVP 简化：单向添加即可看到对方，双方互加后允许发消息）
create table if not exists public.friendships (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  friend_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, friend_id)
);

-- 群组
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 群成员
create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- 消息（私信和群聊共用）
-- target_type: 'dm' -> target_id 是接收者 user id；'group' -> target_id 是 group id
-- kind: 'blink'（闪烁提醒）/ 'text'（文字消息）
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('dm', 'group')),
  target_id uuid not null,
  kind text not null check (kind in ('blink', 'text')),
  content text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists messages_dm_idx on public.messages (target_type, target_id, created_at);

-- 注册新用户时自动创建 profile（username 默认取邮箱前缀，撞车自动加随机后缀）
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  base_name text;
begin
  base_name := coalesce(
    new.raw_user_meta_data->>'username',
    split_part(new.email, '@', 1) || '_' || substr(new.id::text, 1, 4));
  begin
    insert into public.profiles (id, username) values (new.id, base_name);
  exception when unique_violation then
    insert into public.profiles (id, username)
    values (new.id, base_name || '_' || substr(gen_random_uuid()::text, 1, 4))
    on conflict (id) do nothing;
  end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- 行级安全策略（RLS）
-- ============================================================

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.messages enable row level security;

-- 成员判断函数（security definer 绕过 RLS，避免策略里查询 group_members 自身导致无限递归）
create or replace function public.is_group_member(gid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = auth.uid()
  );
$$;

-- profiles：所有登录用户可读（用于搜索用户名加好友），只能改自己的
create policy "profiles readable by authenticated" on public.profiles
  for select to authenticated using (true);
create policy "profiles update own" on public.profiles
  for update to authenticated using (auth.uid() = id);
create policy "profiles insert own" on public.profiles
  for insert to authenticated with check (auth.uid() = id);

-- friendships：双方都能看/删除这段关系，只能添加自己的好友记录
create policy "friendships select own" on public.friendships
  for select to authenticated using (auth.uid() = user_id or auth.uid() = friend_id);
create policy "friendships insert own" on public.friendships
  for insert to authenticated with check (auth.uid() = user_id);
create policy "friendships delete own" on public.friendships
  for delete to authenticated using (auth.uid() = user_id or auth.uid() = friend_id);

-- groups：成员可读；登录用户可创建（创建者即 owner）
create policy "groups select member" on public.groups
  for select to authenticated using (
    owner_id = auth.uid() or public.is_group_member(id)
  );
create policy "groups insert authenticated" on public.groups
  for insert to authenticated with check (owner_id = auth.uid());

-- group_members：成员可看本群成员；群主可添加成员；本人可退出
create policy "group_members select" on public.group_members
  for select to authenticated using (
    user_id = auth.uid() or public.is_group_member(group_id)
  );
create policy "group_members insert" on public.group_members
  for insert to authenticated with check (
    user_id = auth.uid() or
    exists (select 1 from public.groups g where g.id = group_id and g.owner_id = auth.uid())
  );
create policy "group_members delete" on public.group_members
  for delete to authenticated using (
    user_id = auth.uid() or
    exists (select 1 from public.groups g where g.id = group_id and g.owner_id = auth.uid())
  );

-- messages：发件人、私信接收者、群成员可读；
-- 发送需校验目标：私信要求存在好友关系（任一方向），群消息要求是群成员
create policy "messages select" on public.messages
  for select to authenticated using (
    sender_id = auth.uid() or
    (target_type = 'dm' and target_id = auth.uid()) or
    (target_type = 'group' and public.is_group_member(target_id))
  );
create policy "messages insert" on public.messages
  for insert to authenticated with check (
    auth.uid() = sender_id and
    sender_id <> target_id and
    (
      (target_type = 'dm' and exists (
        select 1 from public.friendships
        where (user_id = target_id and friend_id = auth.uid())
           or (user_id = auth.uid() and friend_id = target_id)))
      or
      (target_type = 'group' and public.is_group_member(target_id))
    )
  );

-- ============================================================
-- 开启 Realtime（桌宠和手机端靠它实时收消息）
-- ============================================================
alter publication supabase_realtime add table public.messages;

-- ============================================================
-- 可选：云端只保留最近 7 天的消息（更早的由各用户设备本地保存）
-- 步骤：Supabase 控制台 → Database → Extensions 启用 pg_cron，
-- 然后取消下面两行的注释执行一次即可（每天凌晨 4 点自动清理）
-- ============================================================
-- select cron.schedule('clean-old-messages', '0 4 * * *',
--   $$delete from public.messages where created_at < now() - interval '7 days'$$);
