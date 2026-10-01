-- O que o Supabase põe no banco antes da primeira migration do cash.
--
-- Existe para dar para plantar a gaveta num Postgres descartável aqui dentro, de graça,
-- antes de encostar no banco de verdade. Nada daqui vai para a produção: lá o Supabase
-- já criou estes papéis.
--
-- REPARE NO QUE NÃO ESTÁ AQUI: nenhuma casca de tabela do Catálogo. O prelúdio do
-- BipeChat precisa de `public.lojas` porque `msg.perfis.loja_id` aponta para lá -- um
-- rebite que atravessa a fronteira e que está catalogado como dívida. A gaveta do cash
-- nasce sem nenhum, e este arquivo vazio de vizinhos é a prova disso: se um dia a
-- migration do cash precisar de uma tabela de outro produto, ela falha aqui, que é o
-- lugar barato de descobrir.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;

-- `gen_random_uuid()` vem do pgcrypto nas versões antigas e do core nas novas. Aqui o
-- schema `extensions` entra no caminho de busca para a migration achar a função dos dois
-- jeitos -- igual acontece na produção.
alter database postgres set search_path to "$user", public, extensions;
