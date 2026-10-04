-- ---------------------------------------------------------------------------
-- Cash -- a liberação: o cliente desce o saldo e o relógio começa.
--
-- UM ARQUIVO POR MIGRATION DA PRODUÇÃO, de propósito. Elas eram duas, maiores, e
-- foram partidas assim porque a ferramenta que aplica migration desiste em 60
-- segundos e abortava a transação inteira -- deixando ZERO função no banco. O
-- repositório ficou com a mesma divisão que a produção para a conferência ser
-- arquivo contra função viva, uma a uma; migration que só existe de um lado é
-- exatamente o que já custou caro aqui ("o repositório não prova a produção").
-- ---------------------------------------------------------------------------

-- O cliente desce o saldo para gastar -- e nesse instante começa o relógio. Ele
-- escolhe QUANTO desce, de propósito: quem desce 30 e deixa 70 guardados não
-- está correndo risco nenhum com os 70.
create or replace function cash.descer_para_gastar(
  p_cliente uuid, p_valor numeric, p_chave text default null
) returns uuid
language plpgsql as $$
declare
  v_id uuid;
  v_acumulado numeric;
  v_par record;
  v_vence date;
begin
  v_id := cash.ja_feito(p_chave);
  if v_id is not null then return v_id; end if;

  select * into v_par from cash.parametros where id;
  v_acumulado := cash.saldo(cash.conta_acumulo(p_cliente));

  if v_acumulado < v_par.gatilho then
    raise exception 'gatilho_nao_alcancado'
      using hint = format('São %s juntados e o gatilho é %s.', v_acumulado, v_par.gatilho);
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'valor_invalido';
  end if;
  if p_valor > v_acumulado + 0.005 then
    raise exception 'saldo_insuficiente' using hint = 'Não dá para descer mais do que está juntado.';
  end if;

  v_vence := current_date + v_par.prazo_gasto_dias;
  perform cash.mover(cash.conta_acumulo(p_cliente), cash.conta_disponivel(p_cliente),
                     p_valor, false, v_vence);

  v_id := cash.registrar(
    p_chave, 'liberacao', cash.conta_acumulo(p_cliente), cash.conta_disponivel(p_cliente),
    p_valor, format('Liberou %s para gastar até %s', round(p_valor,2), v_vence));

  perform cash.conferir_invariante();
  return v_id;
end $$;
