-- ---------------------------------------------------------------------------
-- 0026 — AS LOJAS DO TROCO PRIME PARA O MAPA (19/11)
--
-- Ele, 19/11: *"Dentro do aplicativo, nós vamos colocar um mapa (...) onde ele vai achar as lojas que ele vai ter o
-- troco Prime. Aí nós vamos classificar as lojas como clube de oferta, ofertas Prime e talvez troco Prime também. Vamos
-- marcar que lá tem troco Prime, justamente para ele correr atrás das lojas onde ele sabe que ele vai ganhar"*.
--
-- O mapa da casa é o MAPPS (regra da casa: o mapa não se copia). Ele já marca os pinos com `desconto_clube` (Clube
-- Prime) e `oferta_prime` (Ofertas Prime) em `public.portal_empresas`. A marca "Troco Prime" é a terceira, e quem a
-- põe no pino é o Mapps, do lado dele (regra 3: dado de referência se copia, não se lê do vizinho).
--
-- Do lado de cá, só a LISTA, numa interna fechada como as da 0019 (só `service_role`; o Mapps lê por uma função dele,
-- `security definer`): cada loja ATIVA do Troco Prime, com os elos que o Mapps usa para achar o pino (a loja do
-- Catálogo = `portal_empresas.reivindicado_por_loja_id`; a empresa do QR Único; o parceiro do Clube), a cidade e as
-- duas regras (troco e desconto no caixa), para o balão do pino dizer "10% de desconto + 10% de troco".
-- ---------------------------------------------------------------------------

create or replace function cash.lojas_para_o_mapa()
returns table(loja_id uuid, nome text, origem text, catalogo_loja_id uuid, qrunico_usuario_id uuid,
              clube_parceiro_id uuid, cidade text, uf text, cashback_percentual numeric, desconto_no_caixa numeric)
language sql stable security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
  select l.id, l.nome,
         case when l.qrunico_usuario_id is not null then 'qrunico'
              when l.catalogo_loja_id is not null then 'catalogo'
              when l.clube_parceiro_id is not null then 'clube'
              else 'avulsa' end,
         l.catalogo_loja_id, l.qrunico_usuario_id, l.clube_parceiro_id, l.cidade, l.uf::text,
         l.cashback_percentual, l.desconto_no_caixa
    from cash.lojas l
   where l.ativa
   order by lower(l.nome);
$$;

comment on function cash.lojas_para_o_mapa() is
  'As lojas ativas do Troco Prime, com os elos para o Mapps achar o pino e as duas regras (0026). Só service_role.';

revoke all on function cash.lojas_para_o_mapa() from public, anon, authenticated;
grant execute on function cash.lojas_para_o_mapa() to service_role;
