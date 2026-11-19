-- ---------------------------------------------------------------------------
-- 0024 — AS LOJAS DA REDE COM AS DUAS REGRAS (19/11)
--
-- Pedido da conversa do QR Bio (19/11): o "Onde usar" do QR Bio quer mostrar "10% de desconto + 10% de troco" na loja
-- que dá os dois (a decisão de 19/11, `0023`). A `cash_lojas_da_rede` não devolve o desconto no caixa, e ela é do
-- CONTRATO com o QR Bio: mudar as colunas dela quebraria a ponte. Então nasce uma IRMÃ, com as mesmas colunas, na mesma
-- ordem, mais `desconto_no_caixa`.
--
-- 🔴 A busca mora num lugar só: a irmã LÊ a `cash_lojas_da_rede` (que ignora acento) e só acrescenta a coluna. Se a
-- busca mudar lá, muda aqui junto. Em 08/11 a busca em dois lugares fez a lista "pular" na mão dela.
--
-- Portas: as mesmas da irmã (authenticated sim, anon não), pela varredura de sempre.
-- ---------------------------------------------------------------------------

create or replace function public.cash_lojas_da_rede_com_regras(p_busca text default null)
returns table(loja_id uuid, nome text, cashback_percentual numeric, catalogo_slug text, clube_parceiro_id uuid,
              cidade text, uf text, desconto_no_caixa numeric)
language sql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
  select r.loja_id, r.nome, r.cashback_percentual, r.catalogo_slug, r.clube_parceiro_id, r.cidade, r.uf,
         l.desconto_no_caixa
    from public.cash_lojas_da_rede(p_busca) with ordinality
           as r(loja_id, nome, cashback_percentual, catalogo_slug, clube_parceiro_id, cidade, uf, ordem)
    join cash.lojas l on l.id = r.loja_id
   order by r.ordem;
$$;

comment on function public.cash_lojas_da_rede_com_regras(text) is
  'As lojas ativas da rede, como a cash_lojas_da_rede, mais o desconto no caixa (0023). Pedido do QR Bio, 19/11.';

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
