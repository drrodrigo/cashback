-- ---------------------------------------------------------------------------
-- Troco Prime -- o troco é o percentual da loja, sem dobro; e a loja pode dar desconto no caixa E troco (19/11/2026).
--
-- Na produção: `cash_0023_troco_sem_dobro_e_desconto_no_caixa`.
--
-- A DECISÃO DELE, em 19/11: "em vez de dar o desconto em dinheiro, a gente vai dar em crédito para gastar dentro da
-- nossa rede. Então, se um produto custa 100 e ele colocou 20% de desconto, ele coloca 20% no saldo do associado do
-- clube. (...) ele pode também ter uma versão que ele dá o desconto e ainda dá o troco (...) aqui você ganha 10% de
-- desconto e ainda ganha mais 10% de cashback."
--
-- O QUE ISSO MUDA:
--   1. SEM O DOBRO. A regra de 06/09 ("compra na loja vale o dobro") estava ligada (`multiplicador_presencial = 2`) e o
--      balcão manda toda compra como presencial: numa loja de 10%, uma compra de R$ 200 lançaria 40 de troco, tirados
--      do crédito da loja, enquanto a tela do balcão dizia 20 (achado em 19/11, com zero loja e zero movimento). Agora
--      o multiplicador é 1: 10% de R$ 200 = 20 de troco, igual à tela. O botão continua existindo em
--      `cash.parametros`, para o dia em que ele quiser uma campanha.
--   2. DESCONTO NO CAIXA. Cada loja passa a ter, além do % de troco (`cashback_percentual`), o % de desconto que ela dá
--      direto no caixa (`desconto_no_caixa`, 0 por padrão). As duas formas dele:
--        - só troco: desconto_no_caixa = 0, troco = 20 (paga 100, ganha 20 de troco);
--        - desconto + troco: desconto_no_caixa = 10, troco = 10 (paga 90, ganha 10% do que pagou em troco).
--      O desconto no caixa é a loja que aplica no preço: o Troco Prime só guarda e MOSTRA, para o vendedor e o
--      cliente saberem a regra. O troco é calculado sobre o valor que o vendedor digita no balcão (o que o cliente
--      pagou).
--   3. `cash_admin_regras_da_loja`: o administrador muda as duas porcentagens de uma loja já vinculada.
--   4. `cash_minha_loja` (o balcão) e `cash_admin_lojas` (o administrador) passam a devolver o desconto no caixa. Mudar
--      a lista de colunas exige recriar a função (o `create or replace` recusa): o `drop` vai dentro de `execute`
--      (regra 6), e a varredura das portas no fim devolve os grants. Nenhuma das duas está no contrato com o QR Bio.
-- ---------------------------------------------------------------------------

do $migracao$
begin
  -- 1. Sem o dobro.
  execute 'update cash.parametros set multiplicador_presencial = 1 where id';
  execute 'alter table cash.parametros alter column multiplicador_presencial set default 1';

  -- 2. O desconto no caixa de cada loja.
  execute 'alter table cash.lojas add column if not exists desconto_no_caixa numeric(5,2) not null default 0';
  if not exists (select 1 from pg_constraint where conname = 'lojas_desconto_no_caixa_check') then
    execute 'alter table cash.lojas add constraint lojas_desconto_no_caixa_check
               check (desconto_no_caixa >= 0 and desconto_no_caixa < 100)';
  end if;

  -- 4. As duas funções que mudam de forma.
  execute 'drop function if exists public.cash_minha_loja()';
  execute 'drop function if exists public.cash_admin_lojas()';
end $migracao$;

-- 3. As regras de uma loja: % de troco e % de desconto no caixa.
create or replace function public.cash_admin_regras_da_loja(p_loja uuid, p_troco numeric, p_desconto_no_caixa numeric)
returns void
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
begin
  if not public.e_admin() then raise exception 'so_admin'; end if;
  if p_troco is null or p_troco <= 0 or p_troco > 100
     or p_desconto_no_caixa is null or p_desconto_no_caixa < 0 or p_desconto_no_caixa >= 100 then
    raise exception 'percentual_invalido';
  end if;
  -- Desconto e troco juntos passando de 100% é a loja pagando para vender: recusa, em vez de deixar o erro de digitação
  -- virar dinheiro.
  if p_troco + p_desconto_no_caixa > 100 then raise exception 'regras_passam_de_100'; end if;

  update cash.lojas set cashback_percentual = p_troco, desconto_no_caixa = p_desconto_no_caixa where id = p_loja;
  if not found then raise exception 'loja_nao_encontrada'; end if;
end $$;

-- 4a. O balcão: a loja de quem está logado, agora com o desconto no caixa.
create function public.cash_minha_loja()
returns table(loja_id uuid, nome text, cashback_percentual numeric, desconto_no_caixa numeric,
              credito numeric, recebido numeric, saque_pedido numeric)
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare v_loja uuid := cash.loja_do_usuario();
begin
  if v_loja is null then return; end if;
  return query
    select l.id, l.nome, l.cashback_percentual, l.desconto_no_caixa,
           cash.saldo(cash.conta_credito(l.id)),
           cash.saldo(cash.conta_recebido(l.id)),
           coalesce((select sum(s.valor) from cash.saques_pedidos s
                      where s.loja_id = l.id and s.situacao = 'pedido'), 0)
      from cash.lojas l where l.id = v_loja;
end $$;

-- 4b. O administrador: as lojas com o dinheiro e as duas porcentagens.
create function public.cash_admin_lojas()
returns table(loja_id uuid, nome text, origem text, cashback_percentual numeric, desconto_no_caixa numeric,
              ativa boolean, cidade text, uf text, credito numeric, recebido numeric, saque_pedido numeric)
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
           l.cashback_percentual, l.desconto_no_caixa, l.ativa, l.cidade, l.uf::text,
           cash.saldo(cash.conta_credito(l.id)),
           cash.saldo(cash.conta_recebido(l.id)),
           coalesce((select sum(s.valor) from cash.saques_pedidos s
                      where s.loja_id = l.id and s.situacao = 'pedido'), 0)
      from cash.lojas l
     order by l.ativa desc, lower(l.nome);
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
