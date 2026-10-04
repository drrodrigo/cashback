-- ---------------------------------------------------------------------------
-- Cash -- reciclar (de graça) e sacar (com taxa para o fundo).
--
-- UM ARQUIVO POR MIGRATION DA PRODUÇÃO, de propósito. Elas eram duas, maiores, e
-- foram partidas assim porque a ferramenta que aplica migration desiste em 60
-- segundos e abortava a transação inteira -- deixando ZERO função no banco. O
-- repositório ficou com a mesma divisão que a produção para a conferência ser
-- arquivo contra função viva, uma a uma; migration que só existe de um lado é
-- exatamente o que já custou caro aqui ("o repositório não prova a produção").
-- ---------------------------------------------------------------------------

-- Reciclar é DE GRAÇA, de propósito: é o que mantém o cash girando na rede em
-- vez de virar saque. O lojista que recebeu cash de clientes usa de novo para
-- dar cashback, sem pagar taxa nenhuma.
create or replace function cash.reciclar(p_loja uuid, p_valor numeric, p_chave text default null)
returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  v_id := cash.ja_feito(p_chave);
  if v_id is not null then return v_id; end if;

  perform cash.mover(cash.conta_recebido(p_loja), cash.conta_credito(p_loja), p_valor, false, null);

  v_id := cash.registrar(
    p_chave, 'reciclagem', cash.conta_recebido(p_loja), cash.conta_credito(p_loja), p_valor,
    format('Reciclou %s para dar cashback de novo (sem taxa)', round(p_valor,2)));

  perform cash.conferir_invariante();
  return v_id;
end $$;

-- A saída de dinheiro. A taxa NÃO vira lucro escondido: ela continua existindo
-- como cash, no fundo de promoção -- ou seja, volta para a rede em campanha.
-- Só o que o lojista leva embora sai da custódia.
create or replace function cash.sacar(p_loja uuid, p_valor numeric, p_chave text default null)
returns jsonb
language plpgsql as $$
declare
  v_id uuid;
  v_par record;
  v_recebido numeric;
  v_taxa numeric;
  v_liquido numeric;
  v_restante numeric;
  l record;
  v_usado numeric;
  v_volta jsonb;
begin
  v_id := cash.ja_feito(p_chave);
  if v_id is not null then
    -- Repetido: devolve os MESMOS números do saque original, recalculados do
    -- lançamento que ficou gravado. Devolver outra coisa (ou erro) faria o balcão
    -- achar que falhou e tentar de novo, que é exatamente o que a chave evita.
    select jsonb_build_object(
             'lancamento_id', l2.id,
             'valor', l2.valor,
             'taxa', round(l2.valor * p.taxa_saque_percentual / 100, 2),
             'recebe_em_reais', round(l2.valor - round(l2.valor * p.taxa_saque_percentual / 100, 2), 2),
             'repetido', true)
      into v_volta
      from cash.lancamentos l2, cash.parametros p
     where l2.id = v_id and p.id;
    return v_volta;
  end if;

  select * into v_par from cash.parametros where id;
  v_recebido := cash.saldo(cash.conta_recebido(p_loja));

  if p_valor is null or p_valor <= 0 then
    raise exception 'valor_invalido' using hint = 'Saque precisa ser maior que zero.';
  end if;
  if v_recebido + 0.005 < p_valor then
    raise exception 'saldo_insuficiente'
      using hint = format('A loja recebeu %s de clientes; não dá para sacar %s.', v_recebido, round(p_valor,2));
  end if;

  v_taxa := round(p_valor * v_par.taxa_saque_percentual / 100, 2);
  v_liquido := round(p_valor - v_taxa, 2);

  if v_taxa > 0 then
    perform cash.mover(cash.conta_recebido(p_loja), cash.conta_promocional(),
                       v_taxa, false, null, 'plataforma');
    perform cash.registrar(
      null, 'taxa', cash.conta_recebido(p_loja), cash.conta_promocional(), v_taxa,
      format('Taxa de %s%% do saque foi para o fundo de promoção', v_par.taxa_saque_percentual));
  end if;

  -- O que o lojista leva SOME do sistema: os lotes são destruídos e a custódia
  -- cai exatamente o mesmo tanto. É o espelho do depósito.
  v_restante := v_liquido;
  for l in
    select id, valor from cash.lotes
     where conta = cash.conta_recebido(p_loja)
       and (vence_em is null or vence_em >= current_date)
     order by vence_em asc nulls last, criado_em asc, id asc
     for update
  loop
    exit when v_restante <= 0;
    v_usado := least(l.valor, v_restante);
    if v_usado >= l.valor then
      delete from cash.lotes where id = l.id;
    else
      update cash.lotes set valor = round(valor - v_usado, 2) where id = l.id;
    end if;
    v_restante := round(v_restante - v_usado, 2);
  end loop;

  v_id := cash.registrar(
    p_chave, 'saque', cash.conta_recebido(p_loja), 'externo:banco', p_valor,
    format('Sacou %s e recebeu R$ %s (taxa de %s)', round(p_valor,2), v_liquido, v_taxa));

  insert into cash.movimentos_de_caixa (lancamento_id, valor_em_reais)
  values (v_id, -v_liquido);

  perform cash.conferir_invariante();
  return jsonb_build_object(
    'lancamento_id', v_id, 'valor', round(p_valor,2),
    'taxa', v_taxa, 'recebe_em_reais', v_liquido, 'repetido', false);
end $$;
