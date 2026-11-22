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

-- 19/11: as colunas do Catálogo que a tela do administrador lê (busca, cidade, UF, o desconto do Clube) e o que
-- tira loja apagada e loja de teste da busca. Tipos iguais aos da produção, conferidos em 19/11.
alter table public.lojas add column if not exists endereco_cidade text;
alter table public.lojas add column if not exists endereco_uf text;
alter table public.lojas add column if not exists excluida_em timestamptz;
alter table public.lojas add column if not exists loja_teste boolean not null default false;
alter table public.lojas add column if not exists clube_desconto_percentual numeric;

-- 19/11: o `auth.users` de verdade é do Supabase. O dublê tem só o que o balcão do QR Único confere: o e-mail e se
-- ele foi CONFIRMADO (é essa confirmação que impede alguém de criar conta com o e-mail do lojista).
create table if not exists auth.users (
  id uuid primary key,
  email varchar,
  email_confirmed_at timestamptz
);

-- 19/11: o QR Único, de onde vem o lojista que não tem Catálogo. Nomes e tipos da produção (conferidos em 19/11):
-- 1.297 usuários-empresa ativos, login PRÓPRIO (nenhum id igual ao `auth.users`).
create schema if not exists qrunico;
create table if not exists qrunico.users (
  id uuid primary key default gen_random_uuid(),
  name varchar not null,
  nickname varchar not null default '',
  email varchar not null,
  is_company boolean not null default false,
  active boolean not null default true,
  is_removed boolean not null default false
);
create table if not exists qrunico.qr_card (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  is_active boolean not null default true,
  city varchar,
  uf varchar,
  created_at timestamp not null default now()
);

-- O agendador: na produção o `pg_cron` existe (49 rotinas em 19/11). Aqui é a extensão de mentira que o
-- `banco-de-mentira.sh` escreve no disco antes de plantar.
create extension if not exists pg_cron;

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

-- As duas funções FECHADAS do Clube que o QR Bio usa e que a `0025` passou a usar (a carteirinha no app do Troco
-- Prime). Copiadas da função viva (`pg_get_functiondef`, 19/11), letra por letra no que o cash depende: a recusa da
-- carteirinha inativa, o token de 90 s e o `null` para quem não é do Clube.
alter table clube.perfis add column if not exists criado_em timestamptz not null default now();
alter table clube.perfis add column if not exists cadastrado_por_id uuid;

create or replace function clube.carteirinha_de(p_membro uuid) returns jsonb
language sql stable security definer
set search_path to 'clube', 'public', 'pg_temp'
as $$
  select jsonb_build_object(
           'nome', pf.nome,
           'nivel', pf.nivel,
           'prime_ate', pf.prime_ate,
           'prime_em_dia', coalesce(pf.nivel = 'prime' and pf.prime_ate >= current_date, false),
           'membro_desde', pf.criado_em,
           'codigo_publico', c.codigo_publico,
           'ativa', c.ativa,
           'loja', (select jsonb_build_object('nome', p.nome, 'slug', p.slug)
                      from clube.parceiros p where p.id = pf.cadastrado_por_id))
    from clube.perfis pf
    join clube.carteirinhas c on c.membro_id = pf.id
   where pf.id = p_membro;
$$;

create or replace function clube.emitir_token_de(p_membro uuid)
returns table(token text, expira_em timestamptz)
language plpgsql security definer
set search_path to 'clube', 'public', 'pg_temp'
as $$
declare
  v_ativa boolean;
begin
  select c.ativa into v_ativa from clube.carteirinhas c where c.membro_id = p_membro;
  if v_ativa is null then
    raise exception 'carteirinha não encontrada' using hint = 'sem_carteirinha';
  elsif not v_ativa then
    raise exception 'carteirinha inativa' using hint = 'carteirinha_inativa';
  end if;

  delete from clube.carteirinha_tokens t
   where t.membro_id = p_membro and t.expira_em < now() - interval '5 minutes';

  return query
    insert into clube.carteirinha_tokens (membro_id)
    values (p_membro)
    returning carteirinha_tokens.token, carteirinha_tokens.expira_em;
end $$;
revoke all on function clube.carteirinha_de(uuid) from public, anon, authenticated;
revoke all on function clube.emitir_token_de(uuid) from public, anon, authenticated;

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

-- ---------------------------------------------------------------------------
-- O CADASTRO DA LOJA (0028, 22/11): na aprovação, a loja do Troco Prime vira PARCEIRA DO CLUBE (é o que deixa o balcão
-- ler a carteirinha), e quem cria o parceiro é o PRÓPRIO CLUBE: `clube.criar_loja_pelo_admin`, `clube.ligar_dono` e
-- `clube.aprovar_parceiro`. Cópias da produção (`pg_get_functiondef`, 22/11), letra por letra no que o cash depende: só o
-- administrador DO CLUBE (`clube.perfis.papel = 'admin'`) cadastra, o nome repetido é recusado (`ja_existe`), o apelido
-- sai do nome, e o dono é o membro (p_dono) OU o e-mail (p_email), nunca os dois.
-- ---------------------------------------------------------------------------
create schema if not exists comum;

create or replace function comum.chave_do_nome(p_nome text) returns text
language sql immutable set search_path to 'pg_temp'
as $$
  select nullif(regexp_replace(
    lower(translate(coalesce(p_nome, ''),
      'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),
    '[^a-z0-9]', '', 'g'), '')
$$;

create or replace function comum.miolo_do_telefone(p_telefone text) returns text
language sql immutable
as $$
  with d as (select regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g') as n)
  select case
    when length(n) < 10 then null
    else
      right(
        case
          when right(left(n, length(n) - 8), 1) = '9' and length(left(n, length(n) - 8)) >= 3
            then left(left(n, length(n) - 8), length(left(n, length(n) - 8)) - 1)
          else left(n, length(n) - 8)
        end, 2)
      || right(n, 8)
  end
  from d;
$$;

alter table auth.users add column if not exists deleted_at timestamptz;
alter table clube.parceiros add column if not exists link_ativo boolean not null default false;
alter table clube.parceiros add column if not exists whatsapp text;
alter table clube.parceiros add column if not exists dono_email_reservado text;
alter table clube.parceiros add column if not exists logo_url text;
alter table clube.parceiros add column if not exists instagram text;
alter table clube.parceiros add column if not exists descricao text;
alter table clube.parceiros add column if not exists endereco text;
alter table clube.parceiros add column if not exists cep text;
alter table clube.parceiros add column if not exists categoria_id uuid;
alter table clube.parceiros add column if not exists lat double precision;
alter table clube.parceiros add column if not exists lng double precision;
alter table clube.parceiros add column if not exists criado_em timestamptz not null default now();
create unique index if not exists parceiros_slug_key on clube.parceiros (slug) where slug is not null;

create table if not exists clube.categorias (id uuid primary key default gen_random_uuid(), nome text not null default '');
create table if not exists clube.beneficios (
  id uuid primary key default gen_random_uuid(),
  parceiro_id uuid not null,
  titulo text not null,
  descricao text,
  desconto_percentual numeric,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create or replace function clube.e_admin() returns boolean
language sql stable security definer set search_path to 'clube', 'public', 'pg_temp'
as $$
  select exists (select 1 from clube.perfis where id = auth.uid() and papel = 'admin');
$$;

create or replace function clube.apelido_para_loja(p_nome text) returns text
language plpgsql set search_path to 'clube', 'pg_temp'
as $$
declare
  v_base  text;
  v_tenta text;
  v_n     int := 1;
begin
  v_base := lower(translate(coalesce(p_nome, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'));
  v_base := regexp_replace(v_base, '[^a-z0-9]+', '-', 'g');
  v_base := btrim(v_base, '-');
  v_base := left(v_base, 40);
  v_base := btrim(v_base, '-');
  if char_length(v_base) < 3 then
    v_base := btrim('loja-' || v_base, '-');
  end if;
  v_tenta := v_base;
  while exists (select 1 from clube.parceiros p where p.slug = v_tenta) loop
    v_n := v_n + 1;
    v_tenta := left(v_base, 40 - char_length(v_n::text) - 1) || '-' || v_n::text;
    if v_n > 200 then
      raise exception 'não consegui montar um apelido para esta loja' using hint = 'sem_apelido';
    end if;
  end loop;
  return v_tenta;
end;
$$;

create or replace function clube.ligar_dono(p_parceiro_id uuid, p_email text)
returns table(ligou_agora boolean, dono_email text, reservado boolean)
language plpgsql security definer set search_path to 'clube', 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user  uuid;
begin
  if not clube.e_admin() then
    raise exception 'só a administração do clube liga lojista em loja' using hint = 'nao_e_admin';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'e-mail inválido' using hint = 'email_invalido';
  end if;
  if not exists (select 1 from clube.parceiros p where p.id = p_parceiro_id) then
    raise exception 'parceiro não encontrado' using hint = 'parceiro_nao_encontrado';
  end if;
  select u.id into v_user from auth.users u where lower(u.email) = v_email and u.deleted_at is null limit 1;
  if v_user is not null then
    update clube.parceiros set dono_id = v_user, dono_email_reservado = null where id = p_parceiro_id;
    return query select true, v_email, false;
  else
    update clube.parceiros set dono_email_reservado = v_email, dono_id = null where id = p_parceiro_id;
    return query select false, v_email, true;
  end if;
end;
$$;

create or replace function clube.aprovar_parceiro(p_parceiro_id uuid, p_aprovado boolean)
returns table(id uuid, nome text, ativo boolean)
language plpgsql security definer set search_path to 'clube', 'public', 'pg_temp'
as $$
begin
  if not clube.e_admin() then
    raise exception 'so a administracao do clube aprova parceiro' using hint = 'nao_e_admin';
  end if;
  return query
  update clube.parceiros p set ativo = p_aprovado where p.id = p_parceiro_id
  returning p.id, p.nome, p.ativo;
  if not found then
    raise exception 'parceiro nao encontrado' using hint = 'parceiro_nao_encontrado';
  end if;
end;
$$;

-- A da produção também valida logo, CEP, categoria e coordenadas: o cash não manda nenhum desses, e eles ficam de fora
-- do dublê. O que o cash manda (nome, WhatsApp, e-mail OU membro, cidade, UF, benefício, no ar) está igual.
create or replace function clube.criar_loja_pelo_admin(
  p_nome text, p_whatsapp text default null, p_email text default null, p_cidade text default null,
  p_uf text default null, p_desconto numeric default null, p_link_ligado boolean default true,
  p_dono uuid default null, p_logo_url text default null, p_instagram text default null,
  p_descricao text default null, p_endereco text default null, p_cep text default null,
  p_categoria_id uuid default null, p_no_ar boolean default false, p_beneficio text default null,
  p_beneficio_extra text default null, p_lat double precision default null, p_lng double precision default null
) returns table(id uuid, slug text)
language plpgsql security definer set search_path to 'clube', 'comum', 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare
  v_nome  text := nullif(btrim(coalesce(p_nome, '')), '');
  v_fone  text := nullif(regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g'), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_uf    text := nullif(upper(btrim(coalesce(p_uf, ''))), '');
  v_ben   text := nullif(btrim(coalesce(p_beneficio, '')), '');
  v_extra text := nullif(btrim(coalesce(p_beneficio_extra, '')), '');
  v_slug  text;
  v_id    uuid;
  v_tel_do_dono text;
begin
  if not clube.e_admin() then
    raise exception 'só a administração do clube cadastra loja por aqui' using hint = 'nao_e_admin';
  end if;
  if p_dono is not null then
    select pf.telefone into v_tel_do_dono from clube.perfis pf where pf.id = p_dono;
    if not found then raise exception 'membro não encontrado' using hint = 'membro_nao_encontrado'; end if;
    if v_email is not null then
      raise exception 'escolha o membro OU o e-mail do dono, não os dois' using hint = 'dono_em_dobro';
    end if;
    v_fone := coalesce(v_fone, nullif(regexp_replace(coalesce(v_tel_do_dono, ''), '\D', '', 'g'), ''));
  end if;
  if v_nome is null or char_length(v_nome) < 2 then
    raise exception 'o nome da loja é obrigatório' using hint = 'sem_nome';
  end if;
  if v_fone is not null and comum.miolo_do_telefone(v_fone) is null then
    raise exception 'o WhatsApp precisa do DDD' using hint = 'whatsapp_invalido';
  end if;
  if v_uf is not null and v_uf !~ '^[A-Z]{2}$' then
    raise exception 'UF inválida' using hint = 'uf_invalida';
  end if;
  if v_ben is not null and char_length(v_ben) > 80 then
    raise exception 'o benefício pode ter até 80 letras' using hint = 'beneficio_longo';
  end if;
  if exists (select 1 from clube.parceiros p where comum.chave_do_nome(p.nome) = comum.chave_do_nome(v_nome)) then
    raise exception 'esta loja já está cadastrada' using hint = 'ja_existe';
  end if;
  v_slug := clube.apelido_para_loja(v_nome);
  insert into clube.parceiros (nome, slug, ativo, link_ativo, whatsapp, cidade, uf, dono_id)
  values (v_nome, v_slug, coalesce(p_no_ar, false), coalesce(p_link_ligado, true), v_fone,
          nullif(btrim(coalesce(p_cidade, '')), ''), v_uf, p_dono)
  returning clube.parceiros.id into v_id;
  if p_desconto is not null or v_ben is not null then
    insert into clube.beneficios (parceiro_id, titulo, descricao, desconto_percentual, ativo)
    values (v_id, coalesce(v_ben, p_desconto::text || '% de desconto'), v_extra, p_desconto, true);
  end if;
  if v_email is not null then
    perform clube.ligar_dono(v_id, v_email);
  end if;
  return query select v_id, v_slug;
end;
$$;
