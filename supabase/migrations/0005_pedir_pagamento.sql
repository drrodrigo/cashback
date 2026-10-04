-- ---------------------------------------------------------------------------
-- Cash -- a cobrança no balcão (o primeiro dos dois passos).
--
-- UM ARQUIVO POR MIGRATION DA PRODUÇÃO, de propósito. Elas eram duas, maiores, e
-- foram partidas assim porque a ferramenta que aplica migration desiste em 60
-- segundos e abortava a transação inteira -- deixando ZERO função no banco. O
-- repositório ficou com a mesma divisão que a produção para a conferência ser
-- arquivo contra função viva, uma a uma; migration que só existe de um lado é
-- exatamente o que já custou caro aqui ("o repositório não prova a produção").
-- ---------------------------------------------------------------------------

-- O balcão PEDE a cobrança; ela só vale depois que o cliente confirma na tela
-- dele. Os dois números (a compra e o cash) viram acordo entre as duas partes --
-- é isso que protege o cliente de um débito errado, e é isso que transforma o
-- valor declarado em dado que sustenta relatório.
create or replace function cash.pedir_pagamento(
  p_loja uuid, p_cliente uuid, p_valor_compra numeric, p_valor_em_cash numeric
) returns uuid
language plpgsql as $$
declare
  v_pode numeric;
  v_id uuid;
begin
  if p_valor_compra is null or p_valor_compra <= 0 then
    raise exception 'valor_invalido' using hint = 'Valor da compra precisa ser maior que zero.';
  end if;
  if p_valor_em_cash is null or p_valor_em_cash <= 0 then
    raise exception 'valor_invalido' using hint = 'Valor em cash precisa ser maior que zero.';
  end if;

  -- ACEITAÇÃO É INCONDICIONAL. Loja da rede aceita cash sem compra mínima e sem
  -- teto por compra -- decisão do dono, e é o que faz o cash ser forma de
  -- pagamento em vez de cupom. O único limite é o valor da própria compra:
  -- ninguém paga 60 numa compra de 50.
  if p_valor_em_cash > p_valor_compra + 0.005 then
    raise exception 'cash_passa_da_compra'
      using hint = 'O cash usado não pode passar do valor da compra.';
  end if;

  v_pode := cash.pode_usar_na_loja(p_cliente, p_loja);
  if v_pode + 0.005 < p_valor_em_cash then
    raise exception 'saldo_insuficiente'
      using hint = format('O cliente tem %s para usar aqui.', v_pode);
  end if;

  insert into cash.pagamentos_pendentes (loja_id, cliente_id, valor_compra, valor_em_cash)
  values (p_loja, p_cliente, round(p_valor_compra,2), round(p_valor_em_cash,2))
  returning id into v_id;
  return v_id;
end $$;
