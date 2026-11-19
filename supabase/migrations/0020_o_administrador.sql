-- ---------------------------------------------------------------------------
-- Troco Prime -- o ADMINISTRADOR vincula o lojista pelo nome, do Catálogo ou do QR Único (19/11/2026).
--
-- Na produção: `cash_0020_o_administrador`.
--
-- O QUE ELE PEDIU, em 19/11: "o lojista que vai dar o desconto vai estar vinculado ou ao QR Único ou ao Catálogo
-- Online (...) a gente vai simplesmente pegar ele e vai adicionar ele. Vai pegar ele ou no banco de dados do QR
-- Único ou no banco de dados do Catálogo Online. Aí digita o nome dele lá e vincula."
--
-- O QUE EXISTIA: vincular loja do Catálogo (`cash_admin_ligar_loja_do_catalogo`) e parceiro do Clube
-- (`cash_admin_ligar_parceiro`), por id, sem tela para achar o id. Do QR Único, nada.
--
-- O QUE ESTA MIGRATION FAZ:
--   1. `cash.lojas` ganha o elo com o QR Único (`qrunico_usuario_id`, uuid solto, regra 2) e o e-mail de quem
--      opera o balcão (`dono_email`, copiado, regra 3);
--   2. `cash_admin_buscar_lojistas(busca)`: digita o nome, acha no Catálogo E no QR Único, sem acento, e diz quem
--      já está vinculado;
--   3. `cash_admin_vincular_qrunico(usuario, percentual)`: vincula a empresa do QR Único, copiando nome, cidade,
--      UF e e-mail;
--   4. `cash_admin_ligar_loja_do_catalogo` passa a copiar cidade e UF (o mapa e a busca do cliente leem isso; sem
--      a cópia a loja nascia fora do mapa) -- o miolo é o da função VIVA de 19/11, mais as duas colunas;
--   5. `cash_admin_lojas()`: as lojas do Troco Prime com o dinheiro de cada uma (crédito, recebido, saque pedido);
--   6. `cash.loja_do_usuario()` reconhece o dono da loja do QR Único. 🔴 O login do QR Único é OUTRO (medido em
--      19/11: dos 1.297 usuários-empresa ativos, nenhum tem o mesmo id no `auth.users`; 111 têm conta com o mesmo
--      e-mail). Então o balcão da loja do QR Único abre para a conta do Supabase com o MESMO e-mail -- e só se o
--      e-mail estiver CONFIRMADO. Sem essa exigência, qualquer um que criasse uma conta com o e-mail do lojista
--      operaria o balcão dele e daria troco com o crédito que ele depositou.
-- ---------------------------------------------------------------------------

-- 1. O elo com o QR Único, e o e-mail de quem opera.
do $migracao$
begin
  execute 'alter table cash.lojas add column if not exists qrunico_usuario_id uuid';
  execute 'alter table cash.lojas add column if not exists dono_email text';
  execute 'create unique index if not exists lojas_qrunico_unico_idx on cash.lojas (qrunico_usuario_id)
             where qrunico_usuario_id is not null';
end $migracao$;

-- 2. A busca: digita o nome, acha no Catálogo e no QR Único.
create or replace function public.cash_admin_buscar_lojistas(p_busca text)
returns table(origem text, origem_id uuid, nome text, cidade text, uf text, contato text,
              desconto_do_clube numeric, loja_id uuid, cashback_percentual numeric, vinculada boolean)
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare
  v_busca text := lower(translate(trim(coalesce(p_busca, '')),
                    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'));
begin
  if not public.e_admin() then raise exception 'so_admin'; end if;
  -- Duas letras não acham ninguém útil entre 3 mil lojas: devolve vazio em vez de uma lista que não ajuda.
  if length(v_busca) < 3 then return; end if;

  return query
    select * from (
      select 'catalogo'::text, lo.id, lo.nome::text, nullif(trim(lo.endereco_cidade), ''), upper(nullif(trim(lo.endereco_uf), '')),
             coalesce(lo.slug, '')::text, lo.clube_desconto_percentual,
             l.id, l.cashback_percentual, coalesce(l.ativa, false)
        from public.lojas lo
        left join cash.lojas l on l.catalogo_loja_id = lo.id
       where lo.excluida_em is null and not coalesce(lo.loja_teste, false)
         and lower(translate(lo.nome, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                                      'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) like '%' || v_busca || '%'
      union all
      select 'qrunico'::text, u.id, u.name::text, nullif(trim(c.city), '')::text, upper(nullif(trim(c.uf), ''))::text,
             coalesce(u.nickname, '')::text, null::numeric,
             l.id, l.cashback_percentual, coalesce(l.ativa, false)
        from qrunico.users u
        left join lateral (
          select qc.city, qc.uf from qrunico.qr_card qc
           where qc.user_id = u.id and qc.is_active
           order by qc.created_at desc limit 1
        ) c on true
        left join cash.lojas l on l.qrunico_usuario_id = u.id
       where u.is_company and u.active and not u.is_removed
         and lower(translate(u.name || ' ' || coalesce(u.nickname, ''),
                             'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                             'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) like '%' || v_busca || '%'
    ) achados
    order by 10 desc, 3
    limit 40;
end $$;

-- 3. Vincular a empresa do QR Único.
create or replace function public.cash_admin_vincular_qrunico(p_usuario uuid, p_cashback_percentual numeric)
returns uuid
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare
  v_id uuid;
  v_u record;
begin
  if not public.e_admin() then raise exception 'so_admin'; end if;

  -- Cidade e UF SEM ESPAÇO: medido em 19/11, o QR Único guarda "Belo Horizonte " e "MG ", e o mapa agrupa por cidade
  -- (com o espaço, a mesma cidade viraria duas).
  select trim(u.name) as name, lower(trim(u.email)) as email, nullif(trim(c.city), '') as city,
         upper(nullif(trim(c.uf), '')) as uf into v_u
    from qrunico.users u
    left join lateral (
      select qc.city, qc.uf from qrunico.qr_card qc
       where qc.user_id = u.id and qc.is_active order by qc.created_at desc limit 1
    ) c on true
   where u.id = p_usuario and u.is_company and u.active and not u.is_removed;
  if v_u.name is null then raise exception 'empresa_do_qrunico_nao_encontrada'; end if;

  insert into cash.lojas (nome, cashback_percentual, qrunico_usuario_id, dono_email, cidade, uf)
  values (v_u.name, p_cashback_percentual, p_usuario, nullif(v_u.email, ''), v_u.city, left(v_u.uf, 2))
  on conflict (qrunico_usuario_id) where qrunico_usuario_id is not null
  do update set cashback_percentual = excluded.cashback_percentual, nome = excluded.nome,
                dono_email = excluded.dono_email, cidade = excluded.cidade, uf = excluded.uf, ativa = true
  returning id into v_id;
  return v_id;
end $$;

-- 4. A loja do Catálogo passa a vir com cidade e UF (o resto é o miolo vivo de 19/11).
create or replace function public.cash_admin_ligar_loja_do_catalogo(p_catalogo_loja_id uuid, p_cashback_percentual numeric)
returns uuid
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare
  v_id uuid;
  v_nome text;
  v_slug text;
  v_cidade text;
  v_uf text;
begin
  if not public.e_admin() then raise exception 'so_admin'; end if;

  select trim(lo.nome), lo.slug, nullif(trim(lo.endereco_cidade), ''), upper(nullif(trim(lo.endereco_uf), ''))
    into v_nome, v_slug, v_cidade, v_uf
    from public.lojas lo where lo.id = p_catalogo_loja_id;
  if v_nome is null then raise exception 'loja_do_catalogo_nao_encontrada'; end if;

  insert into cash.lojas (nome, cashback_percentual, catalogo_loja_id, catalogo_loja_slug, cidade, uf)
  values (v_nome, p_cashback_percentual, p_catalogo_loja_id, v_slug, v_cidade, left(v_uf, 2))
  on conflict (catalogo_loja_id) where catalogo_loja_id is not null
  do update set cashback_percentual = excluded.cashback_percentual,
                nome = excluded.nome, catalogo_loja_slug = excluded.catalogo_loja_slug,
                cidade = excluded.cidade, uf = excluded.uf,
                ativa = true
  returning id into v_id;
  return v_id;
end $$;

-- 5. As lojas do Troco Prime, com o dinheiro de cada uma.
create or replace function public.cash_admin_lojas()
returns table(loja_id uuid, nome text, origem text, cashback_percentual numeric, ativa boolean,
              cidade text, uf text, credito numeric, recebido numeric, saque_pedido numeric)
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
begin
  if not public.e_admin() then raise exception 'so_admin'; end if;
  return query
    select l.id, l.nome,
           case when l.qrunico_usuario_id is not null then 'qrunico'
                when l.catalogo_loja_id is not null then 'catalogo'
                when l.clube_parceiro_id is not null then 'clube'
                else 'avulsa' end,
           l.cashback_percentual, l.ativa, l.cidade, l.uf::text,
           cash.saldo(cash.conta_credito(l.id)),
           cash.saldo(cash.conta_recebido(l.id)),
           coalesce((select sum(s.valor) from cash.saques_pedidos s
                      where s.loja_id = l.id and s.situacao = 'pedido'), 0)
      from cash.lojas l
     order by l.ativa desc, lower(l.nome);
end $$;

-- 6. Quem opera o balcão. O miolo é o da função VIVA de 19/11 (Clube e Catálogo), mais o terceiro caminho: o
--    dono da loja do QR Único, pelo e-mail CONFIRMADO.
create or replace function cash.loja_do_usuario()
returns uuid
language sql stable
as $function$
  select cl.id from cash.lojas cl
    join clube.parceiros cp on cp.id = cl.clube_parceiro_id
   where cp.dono_id = auth.uid() and cp.ativo and cl.ativa
  union all
  select cl.id from cash.lojas cl
    join public.lojas pl on pl.id = cl.catalogo_loja_id
   where pl.owner_id = auth.uid() and cl.ativa
  union all
  select cl.id from cash.lojas cl
    join auth.users au on au.id = auth.uid()
   where cl.qrunico_usuario_id is not null and cl.ativa
     and cl.dono_email is not null and au.email_confirmed_at is not null
     and lower(au.email) = cl.dono_email
  limit 1;
$function$;

-- As portas: a varredura de sempre sobre as `public.cash_*`, MENOS a `cash_dist(money, money)`, que é da extensão
-- `btree_gist` (mora em `public` por acaso do nome) e tem que continuar como o Postgres a deixou.
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
