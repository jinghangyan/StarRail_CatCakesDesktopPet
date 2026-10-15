-- ============================================================
-- 修复：RLS 策略无限递归（infinite recursion detected in policy）
-- 原因：group_members 的策略里查询了它自己
-- 用法：Supabase 控制台 → SQL Editor → 全部粘贴执行一次
-- ============================================================

-- 成员判断函数（security definer 绕过 RLS，不再递归）
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

-- 重建三个受影响的策略
drop policy if exists "groups select member" on public.groups;
create policy "groups select member" on public.groups
  for select to authenticated
  using (owner_id = auth.uid() or public.is_group_member(id));

drop policy if exists "group_members select" on public.group_members;
create policy "group_members select" on public.group_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_group_member(group_id));

drop policy if exists "messages select" on public.messages;
create policy "messages select" on public.messages
  for select to authenticated
  using (
    sender_id = auth.uid() or
    (target_type = 'dm' and target_id = auth.uid()) or
    (target_type = 'group' and public.is_group_member(target_id))
  );
