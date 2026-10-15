-- ============================================================
-- 第三次优化：索引 + Realtime 授权兼容
-- 用法：Supabase 控制台 → SQL Editor → 全部粘贴执行一次
-- ============================================================

-- 1) 索引：好友列表和群成员查询不再全表扫描（免费计划性能最有性价比的优化）
create index if not exists friendships_friend_idx on public.friendships (friend_id);
create index if not exists group_members_user_idx on public.group_members (user_id);

-- 2) Realtime 授权兼容策略
--    新版 Supabase 项目默认开启 Realtime Authorization：私有频道需要这条策略
--    才能收到 postgres_changes 推送；旧版/未开启的项目里它是无害的空摆设。
--    消息内容的可见性仍由 messages 表的 RLS 控制，这条只决定「能不能订阅」。
do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'realtime' and tablename = 'messages') then
    execute 'drop policy if exists "authenticated can subscribe" on realtime.messages';
    execute 'create policy "authenticated can subscribe" on realtime.messages for select to authenticated using (true)';
  end if;
exception when others then
  -- 老版本 Realtime 没有该表或不支持语法，忽略即可
  null;
end $$;
