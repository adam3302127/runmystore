-- Deletes every demo row (clients.is_demo = true) and everything hanging off them.
-- Run this once when Adam says "go live". Real clients (is_demo = false) are untouched.
begin;
delete from public.event_notes  where client_id in (select id from public.clients where is_demo);
delete from public.decisions    where client_id in (select id from public.clients where is_demo);
delete from public.events       where client_id in (select id from public.clients where is_demo);
delete from public.bot_keys     where bot_id in (select id from public.bots where client_id in (select id from public.clients where is_demo));
delete from public.bots         where client_id in (select id from public.clients where is_demo);
delete from public.client_access where client_id in (select id from public.clients where is_demo);
delete from public.clients      where is_demo;
commit;
