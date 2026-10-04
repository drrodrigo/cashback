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

-- ---------------------------------------------------------------------------
-- O QUE MUDOU AQUI, E POR QUE ISTO NÃO É AFROUXAR A REGRA (0009)
--
-- Até a 0008 este arquivo era vazio de vizinhos, e o comentário acima se
-- orgulhava disso. A 0009 (a fronteira) quebrou o plantio com
-- `relation "public.lojas" does not exist` -- que é EXATAMENTE o aviso que este
-- arquivo existe para dar, no lugar barato.
--
-- A leitura é legítima, e é no único lugar onde pode ser: dentro da fronteira.
-- O lojista não ganha login novo -- ele já tem o do Catálogo --, então a
-- fronteira resolve `auth.uid()` -> `public.lojas.owner_id` -> `cash.lojas` na
-- hora de cada chamada. Guardar o dono copiado na gaveta seria mais "separado" e
-- estaria ERRADO: loja que troca de dono no Catálogo deixaria o dono antigo
-- operando o balcão.
--
-- A regra 2 continua inteira: NENHUMA chave estrangeira sai da gaveta (o
-- `gaveta.sql` mede isso e fica vermelho se sair). O que atravessa é uma
-- CONSULTA, de dentro de `public`, que no dia de separar vira chamada de API --
-- é para isso que a camada curta existe.
--
-- As cascas abaixo são só o suficiente para o plantio: nome de coluna e tipo
-- iguais aos da produção. Se a produção mudar e isto não, o plantio passa e a
-- produção quebra -- por isso a conferência de verdade é ler a função VIVA
-- depois de aplicar, nunca só o verde daqui.
-- ---------------------------------------------------------------------------

create schema if not exists auth;

create table if not exists public.lojas (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,
  nome text not null,
  slug text unique
);

-- Na produção estas duas vêm do Supabase e do Catálogo. Aqui são dublês, e o
-- `auth.uid()` é regulável para o teste poder VESTIR um lojista e um cliente --
-- teste de permissão que roda como superusuário não mede permissão nenhuma.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

-- O dublê do `public.e_admin()` do Catálogo. Na produção ele confere o papel no
-- token E recusa quem está com `banned_until` no futuro (a 0259 fechou a janela
-- de uma hora em que o token de um funcionário bloqueado continuava valendo).
create or replace function public.e_admin() returns boolean
language sql stable as $$
  select coalesce(current_setting('teste.e_admin', true), 'off') = 'on'
$$;
