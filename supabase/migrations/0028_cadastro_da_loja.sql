-- ---------------------------------------------------------------------------
-- 0028 — O CADASTRO DA LOJA (22/11)
--
-- Ele, 20/11: *"a gente vai colocar a loja, né? Ela vai fazer um cadastro com a gente para ela poder fazer isso. E aí a
-- gente vai vincular (...) ou o Troco Prime ou a loja do catálogo ou a loja do QR."* E, em 22/11: *"faça o que não
-- depende de mim"*.
--
-- O caminho:
--   1. a loja, logada (o mesmo login do Clube), pede: nome, CPF ou CNPJ, WhatsApp, cidade, UF e as duas regras (troco e
--      desconto no caixa) — `cash_pedir_para_ser_loja`; ela acompanha em `cash_meu_pedido_de_loja`;
--   2. o administrador vê em `cash_admin_pedidos_de_loja` e APROVA escolhendo o vínculo (`cash_admin_aprovar_loja`):
--      só no Troco Prime, ou ligada à loja dela no Catálogo Online ou no QR Único (as funções de vincular de sempre);
--   3. na aprovação, a loja vira PARCEIRA DO CLUBE (`cash.garantir_parceiro_do_clube`), com quem pediu como dono. Sem
--      isso o balcão não lê a carteirinha: o Clube só deixa ler o dono de um parceiro ATIVO (o furo medido em 19/11).
--
-- 🔴 QUEM CRIA O PARCEIRO É O CLUBE, não o cash: `clube.criar_loja_pelo_admin`, `clube.ligar_dono` e
-- `clube.aprovar_parceiro`, as funções da própria administração do Clube. Nenhuma linha do Clube é escrita daqui. E elas
-- exigem o ADMINISTRADOR DO CLUBE (`clube.perfis.papel = 'admin'`): quem aprova no /admin do Troco Prime precisa ser
-- também do Clube (medido em 22/11: dos 5 administradores da casa, 1 é do Clube). Se não for, nada é aprovado (a
-- transação volta inteira) e a tela diz o porquê.
--
-- A loja aparece como parceira no Clube SÓ quando o administrador aprova: o efeito é dele, na hora em que ele decide.
-- ---------------------------------------------------------------------------

create table if not exists cash.pedidos_de_loja (
  id uuid primary key default gen_random_uuid(),
  pedido_por uuid not null,
  email text,
  nome text not null,
  documento text not null,
  whatsapp text not null,
  cidade text,
  uf char(2),
  troco_percentual numeric(5,2) not null check (troco_percentual > 0 and troco_percentual <= 100),
  desconto_no_caixa numeric(5,2) not null default 0 check (desconto_no_caixa >= 0 and desconto_no_caixa < 100),
  situacao text not null default 'pedido' check (situacao in ('pedido', 'aprovado', 'recusado')),
  motivo text,
  criado_em timestamptz not null default now(),
  decidido_em timestamptz,
  decidido_por uuid,
  loja_id uuid references cash.lojas(id)
);
-- Um pedido aberto por pessoa: pedir de novo corrige o que estava aberto.
create unique index if not exists pedidos_de_loja_um_aberto on cash.pedidos_de_loja (pedido_por) where situacao = 'pedido';
alter table cash.pedidos_de_loja enable row level security;
revoke all on cash.pedidos_de_loja from public, anon, authenticated;

-- CPF ou CNPJ com os dígitos verificadores certos. A MESMA conta mora em `src/loja/estado.ts` (a tela avisa antes de
-- mandar); quem manda é esta.
create or replace function cash.documento_valido(p_doc text) returns boolean
language plpgsql immutable
set search_path to 'pg_temp'
as $$
declare
  d text := regexp_replace(coalesce(p_doc, ''), '\D', '', 'g');
  n int[];
  s int;
  dv1 int;
  dv2 int;
  p1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  p2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
begin
  if d ~ '^(\d)\1*$' then return false; end if;
  n := (select array_agg(substr(d, i, 1)::int order by i) from generate_series(1, length(d)) i);
  if length(d) = 11 then
    s := 0; for i in 1..9 loop s := s + n[i] * (11 - i); end loop;
    dv1 := (s * 10) % 11 % 10;
    s := 0; for i in 1..10 loop s := s + n[i] * (12 - i); end loop;
    dv2 := (s * 10) % 11 % 10;
    return dv1 = n[10] and dv2 = n[11];
  elsif length(d) = 14 then
    s := 0; for i in 1..12 loop s := s + n[i] * p1[i]; end loop;
    dv1 := case when s % 11 < 2 then 0 else 11 - s % 11 end;
    s := 0; for i in 1..13 loop s := s + n[i] * p2[i]; end loop;
    dv2 := case when s % 11 < 2 then 0 else 11 - s % 11 end;
    return dv1 = n[13] and dv2 = n[14];
  end if;
  return false;
end $$;
revoke all on function cash.documento_valido(text) from public, anon, authenticated;

-- 1. A loja pede.
create or replace function public.cash_pedir_para_ser_loja(
  p_nome text, p_documento text, p_whatsapp text, p_cidade text, p_uf text,
  p_troco numeric, p_desconto numeric default 0
) returns uuid
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare
  v_nome text := nullif(btrim(coalesce(p_nome, '')), '');
  v_doc text := regexp_replace(coalesce(p_documento, ''), '\D', '', 'g');
  v_fone text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
  v_uf text := upper(btrim(coalesce(p_uf, '')));
  v_cidade text := nullif(btrim(coalesce(p_cidade, '')), '');
  v_desc numeric := coalesce(p_desconto, 0);
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'precisa_entrar'; end if;
  if cash.loja_do_usuario() is not null then raise exception 'ja_e_lojista'; end if;
  if v_nome is null or char_length(v_nome) < 2 then raise exception 'nome_da_loja_vazio'; end if;
  if not cash.documento_valido(v_doc) then raise exception 'documento_invalido'; end if;
  if length(v_fone) < 10 or length(v_fone) > 13 then raise exception 'whatsapp_invalido'; end if;
  if v_cidade is null or v_uf !~ '^[A-Z]{2}$' then raise exception 'cidade_e_uf'; end if;
  if p_troco is null or p_troco <= 0 or p_troco > 100 or v_desc < 0 or v_desc >= 100 then
    raise exception 'percentual_invalido';
  end if;
  if p_troco + v_desc > 100 then raise exception 'regras_passam_de_100'; end if;

  update cash.pedidos_de_loja
     set nome = v_nome, documento = v_doc, whatsapp = v_fone, cidade = v_cidade, uf = v_uf,
         troco_percentual = round(p_troco, 2), desconto_no_caixa = round(v_desc, 2), criado_em = now(),
         email = coalesce(nullif(auth.jwt() ->> 'email', ''), email)
   where pedido_por = auth.uid() and situacao = 'pedido'
  returning id into v_id;
  if v_id is null then
    insert into cash.pedidos_de_loja
      (pedido_por, email, nome, documento, whatsapp, cidade, uf, troco_percentual, desconto_no_caixa)
    values
      (auth.uid(), nullif(lower(auth.jwt() ->> 'email'), ''), v_nome, v_doc, v_fone, v_cidade, v_uf,
       round(p_troco, 2), round(v_desc, 2))
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- 2. A loja acompanha o pedido dela (o último).
create or replace function public.cash_meu_pedido_de_loja()
returns table(id uuid, nome text, situacao text, motivo text, criado_em timestamptz, decidido_em timestamptz)
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
begin
  if auth.uid() is null then raise exception 'precisa_entrar'; end if;
  return query
    select p.id, p.nome, p.situacao, p.motivo, p.criado_em, p.decidido_em
      from cash.pedidos_de_loja p
     where p.pedido_por = auth.uid()
     order by p.criado_em desc
     limit 1;
end $$;

-- 3. O administrador vê os pedidos.
create or replace function public.cash_admin_pedidos_de_loja()
returns table(id uuid, nome text, documento text, whatsapp text, email text, cidade text, uf text,
              troco_percentual numeric, desconto_no_caixa numeric, situacao text, criado_em timestamptz,
              loja_id uuid)
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
begin
  if not public.e_admin() then raise exception 'so_admin'; end if;
  return query
    select p.id, p.nome, p.documento, p.whatsapp, p.email, p.cidade, p.uf::text, p.troco_percentual,
           p.desconto_no_caixa, p.situacao, p.criado_em, p.loja_id
      from cash.pedidos_de_loja p
     order by (p.situacao = 'pedido') desc, p.criado_em desc
     limit 100;
end $$;

-- A loja do Troco Prime vira (ou fica) parceira ATIVA do Clube, com dono. Pelas funções do Clube.
create or replace function cash.garantir_parceiro_do_clube(p_loja uuid, p_dono uuid, p_email text, p_whatsapp text)
returns uuid
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare
  l record;
  p record;
  v_id uuid;
  v_troco text;
  v_desc text;
  v_beneficio text;
  v_tem_perfil boolean := exists (select 1 from clube.perfis pf where pf.id = p_dono);
begin
  select * into l from cash.lojas where id = p_loja;
  if not found then raise exception 'loja_nao_encontrada'; end if;

  v_id := l.clube_parceiro_id;
  if v_id is null then
    -- A loja já é parceira do Clube com o mesmo nome? Então é ela (o Clube recusaria o repetido).
    select cp.id into v_id from clube.parceiros cp
     where comum.chave_do_nome(cp.nome) = comum.chave_do_nome(l.nome)
     limit 1;
  end if;

  if v_id is not null then
    select cp.id, cp.dono_id, cp.ativo into p from clube.parceiros cp where cp.id = v_id;
    -- Parceiro com OUTRO dono: o balcão de quem pediu não leria a carteirinha. Não se mexe no dono de ninguém daqui.
    if p.dono_id is not null and p.dono_id <> p_dono then raise exception 'loja_do_clube_tem_outro_dono'; end if;
    if exists (select 1 from cash.lojas o where o.clube_parceiro_id = v_id and o.id <> p_loja) then
      raise exception 'parceiro_ja_tem_loja';
    end if;
    if p.dono_id is null and p_email is not null then perform clube.ligar_dono(v_id, p_email); end if;
    if not p.ativo then perform clube.aprovar_parceiro(v_id, true); end if;
  else
    v_troco := replace(rtrim(rtrim(to_char(l.cashback_percentual, 'FM990.99'), '0'), '.'), '.', ',');
    v_desc := replace(rtrim(rtrim(to_char(coalesce(l.desconto_no_caixa, 0), 'FM990.99'), '0'), '.'), '.', ',');
    v_beneficio := case when coalesce(l.desconto_no_caixa, 0) > 0
                        then v_desc || '% de desconto + ' || v_troco || '% de troco'
                        else v_troco || '% de troco no Troco Prime' end;
    select c.id into v_id
      from clube.criar_loja_pelo_admin(
             p_nome => l.nome,
             p_whatsapp => p_whatsapp,
             p_email => case when v_tem_perfil then null else p_email end,
             p_cidade => l.cidade,
             p_uf => l.uf::text,
             p_link_ligado => true,
             p_dono => case when v_tem_perfil then p_dono else null end,
             p_no_ar => true,
             p_beneficio => v_beneficio) c;
  end if;

  update cash.lojas set clube_parceiro_id = v_id where id = p_loja;
  return v_id;
end $$;
revoke all on function cash.garantir_parceiro_do_clube(uuid, uuid, text, text) from public, anon, authenticated;

-- 4. O administrador aprova, escolhendo o vínculo: 'troco' (só no Troco Prime), 'catalogo' ou 'qrunico'.
create or replace function public.cash_admin_aprovar_loja(p_pedido uuid, p_origem text, p_origem_id uuid default null)
returns uuid
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare
  p cash.pedidos_de_loja%rowtype;
  v_loja uuid;
begin
  if not public.e_admin() then raise exception 'so_admin'; end if;
  select * into p from cash.pedidos_de_loja where id = p_pedido for update;
  if not found or p.situacao <> 'pedido' then raise exception 'pedido_de_loja_nao_encontrado'; end if;

  if p_origem = 'troco' then
    insert into cash.lojas (nome, cashback_percentual, desconto_no_caixa, cidade, uf, ativa, dono_email)
    values (p.nome, p.troco_percentual, p.desconto_no_caixa, p.cidade, p.uf, true, p.email)
    returning id into v_loja;
  elsif p_origem = 'catalogo' and p_origem_id is not null then
    v_loja := public.cash_admin_ligar_loja_do_catalogo(p_origem_id, p.troco_percentual);
  elsif p_origem = 'qrunico' and p_origem_id is not null then
    v_loja := public.cash_admin_vincular_qrunico(p_origem_id, p.troco_percentual);
  else
    raise exception 'origem_invalida';
  end if;

  perform public.cash_admin_regras_da_loja(v_loja, p.troco_percentual, p.desconto_no_caixa);
  perform cash.garantir_parceiro_do_clube(v_loja, p.pedido_por, p.email, p.whatsapp);

  update cash.pedidos_de_loja
     set situacao = 'aprovado', loja_id = v_loja, decidido_em = now(), decidido_por = auth.uid()
   where id = p.id;
  return v_loja;
end $$;

-- 5. Ou recusa, com o motivo (a loja vê).
create or replace function public.cash_admin_recusar_loja(p_pedido uuid, p_motivo text default null)
returns void
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
begin
  if not public.e_admin() then raise exception 'so_admin'; end if;
  update cash.pedidos_de_loja
     set situacao = 'recusado', motivo = nullif(btrim(coalesce(p_motivo, '')), ''), decidido_em = now(),
         decidido_por = auth.uid()
   where id = p_pedido and situacao = 'pedido';
  if not found then raise exception 'pedido_de_loja_nao_encontrado'; end if;
end $$;

-- As portas: a varredura de sempre sobre as `public.cash_*`, menos as de extensão (a `cash_dist` do btree_gist).
do $portas$
declare f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'cash\_%'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public, anon', f.assinatura);
    execute format('grant execute on function %s to authenticated, service_role', f.assinatura);
  end loop;
end $portas$;
