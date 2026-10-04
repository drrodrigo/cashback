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

-- ---------------------------------------------------------------------------
-- AS CASCAS DO CLUBE PRIME (04/10)
--
-- Medido na produção neste dia: o Clube tem **3.903 perfis**, todos com login no
-- `auth.users`, **42 parceiros** e a carteirinha com token rotativo de 90
-- segundos. O dono disse que essa é a base do cashback: *"esse pessoal vai ser a
-- nossa base, o pessoal que já vai estar podendo habilitar o cashback"*.
--
-- Então o cliente do cash NÃO é um cadastro novo: é o membro do Clube. E o balcão
-- não digita telefone -- ele LÊ A CARTEIRINHA, que é o fluxo que já existe
-- (`clube.ler_carteirinha(parceiro, token)`, que devolve um `validacao_id`).
--
-- As cascas abaixo são o mínimo para plantar e medir. O que elas copiam da
-- produção, letra por letra, é o que o cash depende: o token hex de 32, a
-- validade de 90 segundos, o uso único, e a exigência de o parceiro ser dono
-- ATIVO. Dublê mais permissivo que o original não deixa o teste falhar -- deixa o
-- teste MENTIR (a lição da conversa que congelava na mensagem 200).
-- ---------------------------------------------------------------------------

create schema if not exists clube;

create table if not exists clube.perfis (
  id uuid primary key,
  nome text not null default '',
  telefone text,
  nivel text not null default 'clube',
  prime_ate date,
  papel text not null default 'membro',
  foto_caminho text
);

create table if not exists clube.parceiros (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  slug text,
  dono_id uuid,
  comissao_percentual numeric not null default 10,
  ativo boolean not null default false,
  cidade text,
  uf char(2)
);

create table if not exists clube.carteirinhas (
  id uuid primary key default gen_random_uuid(),
  membro_id uuid not null,
  codigo_publico text not null,
  ativa boolean not null default true,
  emitida_em timestamptz not null default now()
);

create table if not exists clube.carteirinha_tokens (
  token text primary key default encode(extensions.gen_random_bytes(16), 'hex'),
  membro_id uuid not null,
  expira_em timestamptz not null default (now() + interval '90 seconds'),
  usado_em timestamptz,
  criado_em timestamptz not null default now()
);

create table if not exists clube.validacoes (
  id uuid primary key default gen_random_uuid(),
  membro_id uuid not null,
  parceiro_id uuid not null,
  beneficio_id uuid,
  beneficio_titulo text,
  desconto_percentual numeric,
  valor_compra_centavos integer,
  economia_centavos integer,
  lida_em timestamptz not null default now(),
  validado_em timestamptz
);

-- O dublê da leitura da carteirinha, copiado da função viva (lida com
-- `pg_get_functiondef` em 04/10). As quatro recusas dela são o que protege o
-- membro, e por isso estão todas aqui: parceiro que não é dono ativo, QR que não
-- é carteirinha, token vencido ou já usado, e carteirinha inativa.
create or replace function clube.ler_carteirinha(p_parceiro_id uuid, p_token text)
returns table(validacao_id uuid, membro_nome text, codigo_publico text, nivel text,
              prime_ate date, prime_em_dia boolean, foto_caminho text)
language plpgsql security definer
set search_path to 'clube', 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare
  v_token text := lower(btrim(coalesce(p_token, '')));
  v_membro_id uuid;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'não autenticado' using hint = 'nao_autenticado';
  end if;

  if not exists (select 1 from clube.parceiros p
                  where p.id = p_parceiro_id and p.dono_id = auth.uid() and p.ativo) then
    raise exception 'só o dono de uma loja ativa pode validar' using hint = 'loja_nao_autorizada';
  end if;

  if v_token !~ '^[0-9a-f]{32}$' then
    raise exception 'não é o QR de uma carteirinha' using hint = 'qr_invalido';
  end if;

  update clube.carteirinha_tokens t
     set usado_em = now()
   where t.token = v_token and t.expira_em > now() and t.usado_em is null
  returning t.membro_id into v_membro_id;

  if v_membro_id is null then
    raise exception 'token vencido ou já usado' using hint = 'token_expirado';
  end if;

  if not exists (select 1 from clube.carteirinhas c
                  where c.membro_id = v_membro_id and c.ativa) then
    raise exception 'carteirinha inativa' using hint = 'carteirinha_inativa';
  end if;

  insert into clube.validacoes (membro_id, parceiro_id)
  values (v_membro_id, p_parceiro_id) returning id into v_id;

  return query
    select v_id, pf.nome, c.codigo_publico, pf.nivel, pf.prime_ate,
           coalesce(pf.nivel = 'prime' and pf.prime_ate >= current_date, false),
           pf.foto_caminho
      from clube.perfis pf
      join clube.carteirinhas c on c.membro_id = pf.id
     where pf.id = v_membro_id;
end $$;

create or replace function clube.emitir_token_carteirinha() returns text
language plpgsql security definer
set search_path to 'clube', 'public', 'pg_temp'
as $$
declare v_token text;
begin
  if auth.uid() is null then raise exception 'nao_autenticado'; end if;
  insert into clube.carteirinha_tokens (membro_id) values (auth.uid()) returning token into v_token;
  return v_token;
end $$;

-- 🔴 A GAVETA DO CLUBE ESTÁ ABERTA, e isto é cópia fiel da produção, não descuido
-- do dublê. Medido em 04/10:
--
--     has_schema_privilege('anon','clube','usage')          -> true
--     has_schema_privilege('authenticated','clube','usage') -> true
--     policies no schema clube                              -> 24
--
-- Ou seja: o Clube confia na RLS (24 policies) em vez de fechar a gaveta, que é o
-- contrário da regra 4 e o contrário de como o `cash` foi construído. Não é um
-- defeito ativo -- as policies filtram --, mas é a armadilha de 21/09: numa tabela
-- com policy de administrador as policies de SELECT se SOMAM, e aí a gaveta aberta
-- entrega tudo a quem tiver a policy a mais. Está anotado para decisão dele; o
-- cash não depende disso e continua fechado.
--
-- O dublê espelha a abertura porque dublê mais RESTRITIVO que o original reprova
-- um teste que a produção aprovaria -- é o mesmo erro do stub mais permissivo, só
-- virado do outro lado.
grant usage on schema clube to anon, authenticated;
grant select on all tables in schema clube to anon, authenticated;
grant execute on all functions in schema clube to anon, authenticated;
