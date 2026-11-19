-- ---------------------------------------------------------------------------
-- 0027 — A RECARGA DA LOJA POR PIX (19/11)
--
-- Ele, 19/11: *"para ele dar o troco, ele tem que ter saldo. Ele não pode dar o troco e não ter saldo, ele tem que
-- pagar por esse troco (...) colocar lá R$ 100, R$ 50, R$ 200 (...) pelo menos os R$ 100 para começar (...) ele tem que
-- fazer um Pix para a gente, esse Pix cai na conta dele (...) vai direto para a conta dele e o saldo fica lá. À medida
-- que ele for vendendo, ele vai jogando os pontos lá e vai abastecendo esse desconto."* E, sobre o caminho: *"Vamos
-- montar no automático e a gente vê quanto que vai cobrar"* (o Pix do Mercado Pago, que avisa sozinho).
--
-- O caminho:
--   1. o lojista pede a recarga no balcão (`cash_pedir_recarga`: mínimo de `cash.parametros.recarga_minima`, R$ 100);
--   2. a função de borda `troco-recarga` cria a cobrança Pix no Mercado Pago e guarda o id e o copia-e-cola
--      (`cash_servidor_cobranca_da_recarga`);
--   3. o Mercado Pago avisa a `troco-pix-webhook`, que CONFERE NA FONTE (pergunta ao Mercado Pago, com o nosso token)
--      e só então dá a baixa (`cash_servidor_baixa_da_recarga`): o crédito entra pelo `cash.depositar` de sempre, com a
--      chave `recarga:<id>` (aviso repetido não credita duas vezes).
--
-- 🔴 QUEM DÁ A BAIXA É SÓ O SERVIDOR. As duas `cash_servidor_*` recusam quem não vem com a chave de serviço
-- (`cash.e_servidor`), mesmo estando na lista da fronteira (a varredura de portas abre toda `public.cash_*` ao logado,
-- e o teste `fronteira.sql` cobra isso): sem esta conferência, o lojista se daria crédito sozinho.
--
-- A TAXA: o Mercado Pago diz, na consulta do pagamento já pago, quanto cobrou (`fee_details`) e quanto caiu
-- (`net_received_amount`). Guardamos as duas em cada recarga: é a resposta exata do "depois você me fala qual que é a
-- taxa". A loja recebe o crédito CHEIO (pagou 100, ganha 100); a taxa fica com a casa (decisão de 19/11; a mensalidade
-- da loja, que ele quer cobrar, ainda vai ser desenhada).
-- ---------------------------------------------------------------------------

alter table cash.parametros add column if not exists recarga_minima numeric(12,2) not null default 100;

create table if not exists cash.recargas (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid not null references cash.lojas(id),
  valor numeric(12,2) not null check (valor > 0),
  situacao text not null default 'aguardando'
    check (situacao in ('aguardando', 'paga', 'valor_divergente', 'cancelada')),
  provedor text not null default 'mercadopago',
  cobranca_externa text unique,
  copia_e_cola text,
  expira_em timestamptz,
  pedida_por uuid,
  criada_em timestamptz not null default now(),
  paga_em timestamptz,
  valor_pago numeric(12,2),
  taxa_do_provedor numeric(12,2),
  valor_liquido numeric(12,2),
  confirmada_por text
);
create index if not exists recargas_da_loja on cash.recargas (loja_id, criada_em desc);
-- A regra da gaveta (`gaveta.sql` cobra): toda tabela com RLS ligada e nenhuma policy. Só as funções entram.
alter table cash.recargas enable row level security;
revoke all on cash.recargas from public, anon, authenticated;

-- Quem chama com a chave de serviço (a função de borda). O mesmo critério do `mapps_e_servidor` e do `auth.role()`.
create or replace function cash.e_servidor() returns boolean
language sql stable
set search_path to 'cash', 'public', 'pg_temp'
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) = 'service_role';
$$;
revoke all on function cash.e_servidor() from public, anon, authenticated;

-- 1. O lojista pede a recarga. Devolve o que a função de borda precisa para cobrar.
create or replace function public.cash_pedir_recarga(p_valor numeric)
returns table(recarga_id uuid, valor numeric, loja_nome text, email text)
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare
  v_loja uuid := cash.loja_do_usuario();
  v_l record;
  v_minima numeric;
  v_valor numeric;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'precisa_entrar'; end if;
  if v_loja is null then raise exception 'nao_e_lojista'; end if;
  select * into v_l from cash.lojas where id = v_loja;
  if not v_l.ativa then raise exception 'loja_inativa'; end if;

  select p.recarga_minima into v_minima from cash.parametros p;
  v_valor := round(p_valor, 2);
  if v_valor is null or v_valor <= 0 or v_valor > 10000 then raise exception 'valor_invalido'; end if;
  if v_valor < v_minima then
    raise exception 'recarga_abaixo_do_minimo' using hint = format('A recarga mínima é de R$ %s.', v_minima);
  end if;
  -- Dedo que toca dez vezes não abre dez cobranças.
  if (select count(*) from cash.recargas r
       where r.loja_id = v_loja and r.situacao = 'aguardando' and r.criada_em > now() - interval '10 minutes') >= 5 then
    raise exception 'recargas_demais';
  end if;

  insert into cash.recargas (loja_id, valor, pedida_por) values (v_loja, v_valor, auth.uid()) returning id into v_id;
  return query select v_id, v_valor, v_l.nome, coalesce(nullif(auth.jwt() ->> 'email', ''), v_l.dono_email);
end $$;

-- 2. A função de borda guarda a cobrança que o Mercado Pago criou. Só o servidor.
create or replace function public.cash_servidor_cobranca_da_recarga(
  p_recarga uuid, p_cobranca_externa text, p_copia_e_cola text, p_expira_em timestamptz
) returns void
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
begin
  if not cash.e_servidor() then raise exception 'so_servidor'; end if;
  update cash.recargas
     set cobranca_externa = btrim(p_cobranca_externa), copia_e_cola = p_copia_e_cola, expira_em = p_expira_em
   where id = p_recarga and situacao = 'aguardando';
  if not found then raise exception 'recarga_nao_encontrada'; end if;
end $$;

-- 3. A baixa: só depois de o webhook conferir na fonte. Só o servidor. Devolve o que aconteceu, em uma palavra.
create or replace function public.cash_servidor_baixa_da_recarga(
  p_cobranca_externa text, p_referencia text, p_valor_centavos integer,
  p_taxa_centavos integer default null, p_liquido_centavos integer default null
) returns text
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare
  r cash.recargas%rowtype;
begin
  if not cash.e_servidor() then raise exception 'so_servidor'; end if;

  select * into r from cash.recargas where cobranca_externa = btrim(p_cobranca_externa) for update;
  if not found and p_referencia ~ '^[0-9a-f-]{36}$' then
    -- A rede de segurança: o aviso chegou antes de a cobrança ser guardada; a referência é o id da recarga.
    select * into r from cash.recargas where id = p_referencia::uuid for update;
  end if;
  if not found then return 'nao_encontrada'; end if;
  if r.situacao = 'paga' then return 'ja_paga'; end if;
  if r.situacao = 'cancelada' then return 'cancelada'; end if;

  if p_valor_centavos is null or p_valor_centavos < round(r.valor * 100) then
    update cash.recargas
       set situacao = 'valor_divergente', valor_pago = p_valor_centavos / 100.0,
           cobranca_externa = coalesce(cobranca_externa, btrim(p_cobranca_externa))
     where id = r.id;
    return 'valor_divergente';
  end if;

  update cash.recargas
     set situacao = 'paga', paga_em = now(), valor_pago = p_valor_centavos / 100.0,
         taxa_do_provedor = p_taxa_centavos / 100.0, valor_liquido = p_liquido_centavos / 100.0,
         confirmada_por = 'provedor', cobranca_externa = coalesce(cobranca_externa, btrim(p_cobranca_externa))
   where id = r.id;
  perform cash.depositar(r.loja_id, r.valor, 'recarga:' || r.id::text);
  return 'creditada';
end $$;

-- 4. As recargas da loja, para o balcão acompanhar ("aguardando o Pix" → "crédito na conta").
create or replace function public.cash_minhas_recargas()
returns table(id uuid, valor numeric, situacao text, criada_em timestamptz, paga_em timestamptz,
              copia_e_cola text, expira_em timestamptz)
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare v_loja uuid := cash.loja_do_usuario();
begin
  if v_loja is null then raise exception 'nao_e_lojista'; end if;
  return query
    select r.id, r.valor, r.situacao, r.criada_em, r.paga_em,
           case when r.situacao = 'aguardando' and coalesce(r.expira_em, now() + interval '1 minute') > now()
                then r.copia_e_cola end,
           r.expira_em
      from cash.recargas r
     where r.loja_id = v_loja
     order by r.criada_em desc
     limit 20;
end $$;

-- 5. O administrador vê todas, com a taxa que o Mercado Pago cobrou em cada uma.
create or replace function public.cash_admin_recargas()
returns table(id uuid, loja_id uuid, loja_nome text, valor numeric, situacao text, criada_em timestamptz,
              paga_em timestamptz, valor_pago numeric, taxa_do_provedor numeric, valor_liquido numeric,
              confirmada_por text)
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
begin
  if not public.e_admin() then raise exception 'so_admin'; end if;
  return query
    select r.id, r.loja_id, l.nome, r.valor, r.situacao, r.criada_em, r.paga_em, r.valor_pago,
           r.taxa_do_provedor, r.valor_liquido, r.confirmada_por
      from cash.recargas r join cash.lojas l on l.id = r.loja_id
     order by (r.situacao in ('aguardando', 'valor_divergente')) desc, r.criada_em desc
     limit 200;
end $$;

-- 6. A mão do administrador, para quando o aviso do Mercado Pago não chegou (ele conferiu no extrato).
create or replace function public.cash_admin_confirmar_recarga(p_recarga uuid)
returns text
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare r cash.recargas%rowtype;
begin
  if not public.e_admin() then raise exception 'so_admin'; end if;
  select * into r from cash.recargas where id = p_recarga for update;
  if not found then raise exception 'recarga_nao_encontrada'; end if;
  if r.situacao = 'paga' then return 'ja_paga'; end if;
  if r.situacao = 'cancelada' then raise exception 'recarga_nao_encontrada'; end if;
  update cash.recargas
     set situacao = 'paga', paga_em = now(), confirmada_por = 'admin:' || coalesce(auth.uid()::text, '?')
   where id = r.id;
  perform cash.depositar(r.loja_id, r.valor, 'recarga:' || r.id::text);
  return 'creditada';
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
