-- ============================================================
-- 安全与健壮性修复（第二次）
-- 用法：Supabase 控制台 → SQL Editor → 全部粘贴执行一次
-- 内容：1) 发消息校验目标（防止骚扰/乱发群消息）
--       2) 好友关系双方都能删除
--       3) 注册触发器 username 冲突兜底
-- ============================================================

-- 1) messages 插入策略：私信要求对方已加我为好友，群消息要求我是群成员
drop policy if exists "messages insert" on public.messages;
create policy "messages insert" on public.messages
  for insert to authenticated
  with check (
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

-- 2) friendships：双方都可以删除这段关系（原来只能加的那方删）
drop policy if exists "friendships delete own" on public.friendships;
create policy "friendships delete own" on public.friendships
  for delete to authenticated
  using (auth.uid() = user_id or auth.uid() = friend_id);

-- 3) 注册触发器：username 撞车时自动加随机后缀，不再导致注册失败
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
