-- ---------------------------------------------------------------------------
-- Cash -- o cliente confirma (o segundo dos dois passos).
--
-- UM ARQUIVO POR MIGRATION DA PRODUÇÃO, de propósito. Elas eram duas, maiores, e
-- foram partidas assim porque a ferramenta que aplica migration desiste em 60
-- segundos e abortava a transação inteira -- deixando ZERO função no banco. O
-- repositório ficou com a mesma divisão que a produção para a conferência ser
-- arquivo contra função viva, uma a uma; migration que só existe de um lado é
-- exatamente o que já custou caro aqui ("o repositório não prova a produção").
-- ---------------------------------------------------------------------------

create or replace function cash.confirmar_pagamento(p_pagamento uuid, p_chave text default null)
returns uuid
language plpgsql as $$
declare
  v_id uuid;
  v_pag record;
  v_nome text;
  v_restrito numeric;
  v_do_restrito numeric;
  v_do_disponivel numeric;
begin
  v_id := cash.ja_feito(p_chave);
  if v_id is not null then return v_id; end if;

  -- Trava a cobrança: dois toques no "confirmar" não viram dois débitos.
  select * into v_pag from cash.pagamentos_pendentes where id = p_pagamento for update;
  if not found then
    raise exception 'cobranca_nao_encontrada' using hint = 'Cobrança não encontrada (ou já confirmada).';
  end if;

  select nome into v_nome from cash.lojas where id = v_pag.loja_id;

  -- RESTRITO DA LOJA PRIMEIRO, depois o livre. O contrário deixaria o saldo
  -- restrito preso para sempre -- ele só vale aqui, então se o livre for gasto
  -- primeiro o cliente fica com um crédito que nunca vai conseguir usar.
  v_restrito := cash.saldo(cash.conta_restrita(v_pag.cliente_id, v_pag.loja_id));
  v_do_restrito := least(v_restrito, v_pag.valor_em_cash);
  v_do_disponivel := round(v_pag.valor_em_cash - v_do_restrito, 2);

  if v_do_restrito > 0 then
    perform cash.mover(cash.conta_restrita(v_pag.cliente_id, v_pag.loja_id),
                       cash.conta_recebido(v_pag.loja_id), v_do_restrito, false, null);
  end if;
  if v_do_disponivel > 0 then
    perform cash.mover(cash.conta_disponivel(v_pag.cliente_id),
                       cash.conta_recebido(v_pag.loja_id), v_do_disponivel, false, null);
  end if;

  delete from cash.pagamentos_pendentes where id = p_pagamento;

  v_id := cash.registrar(
    p_chave, 'pagamento', 'cliente:' || v_pag.cliente_id::text,
    cash.conta_recebido(v_pag.loja_id), v_pag.valor_em_cash,
    format('%s: compra de R$ %s paga com %s de cash e R$ %s em dinheiro',
      coalesce(v_nome, v_pag.loja_id::text), v_pag.valor_compra, v_pag.valor_em_cash,
      round(v_pag.valor_compra - v_pag.valor_em_cash, 2)),
    v_pag.valor_compra);

  perform cash.conferir_invariante();
  return v_id;
end $$;
