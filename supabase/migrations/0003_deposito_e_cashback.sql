-- ---------------------------------------------------------------------------
-- Cash -- depósito e cashback: a entrada de valor e a venda.
--
-- UM ARQUIVO POR MIGRATION DA PRODUÇÃO, de propósito. Elas eram duas, maiores, e
-- foram partidas assim porque a ferramenta que aplica migration desiste em 60
-- segundos e abortava a transação inteira -- deixando ZERO função no banco. O
-- repositório ficou com a mesma divisão que a produção para a conferência ser
-- arquivo contra função viva, uma a uma; migration que só existe de um lado é
-- exatamente o que já custou caro aqui ("o repositório não prova a produção").
-- ---------------------------------------------------------------------------

-- A ÚNICA PORTA DE ENTRADA de valor no sistema. O lojista põe dinheiro de
-- verdade e recebe cash para distribuir -- e é isto que mata sozinho a fraude da
-- loja de fachada: para dar 1.000 de cashback ela depositou 1.000 antes.
--
-- Repare que não existe frontreira pública do lojista para esta função, e é de
-- propósito: quem diz "o dinheiro entrou" é a plataforma, depois de conferir o
-- pagamento. Lojista declarando o próprio depósito é cash sem lastro.
create or replace function cash.depositar(p_loja uuid, p_valor numeric, p_chave text default null)
returns uuid
language plpgsql as $$
declare
  v_id uuid;
  v_lanc uuid;
begin
  v_id := cash.ja_feito(p_chave);
  if v_id is not null then return v_id; end if;

  if p_valor is null or p_valor <= 0 then
    raise exception 'valor_invalido' using hint = 'Depósito precisa ser maior que zero.';
  end if;
  if not exists (select 1 from cash.lojas where id = p_loja) then
    raise exception 'loja_nao_encontrada';
  end if;

  insert into cash.lotes (conta, valor, emissor, vence_em)
  values (cash.conta_credito(p_loja), round(p_valor, 2), p_loja::text, null);

  v_lanc := cash.registrar(
    p_chave, 'deposito', 'externo:banco', cash.conta_credito(p_loja), p_valor,
    format('Depósito de R$ %s vira %s de crédito', round(p_valor,2), round(p_valor,2)));

  insert into cash.movimentos_de_caixa (lancamento_id, valor_em_reais)
  values (v_lanc, round(p_valor, 2));

  perform cash.conferir_invariante();
  return v_lanc;
end $$;

-- A venda com cashback. Sai do crédito que o lojista já pagou.
create or replace function cash.dar_cashback(
  p_loja uuid,
  p_cliente uuid,
  p_valor_compra numeric,
  p_presencial boolean default false,
  p_restrito boolean default false,
  p_chave text default null
) returns uuid
language plpgsql as $$
declare
  v_id uuid;
  v_loja record;
  v_par record;
  v_mult numeric;
  v_valor numeric;
  v_destino text;
  v_prazo int;
begin
  v_id := cash.ja_feito(p_chave);
  if v_id is not null then return v_id; end if;

  select * into v_loja from cash.lojas where id = p_loja;
  if not found then raise exception 'loja_nao_encontrada'; end if;
  if not v_loja.ativa then raise exception 'loja_inativa'; end if;
  if not exists (select 1 from cash.clientes where id = p_cliente) then
    raise exception 'cliente_nao_encontrado';
  end if;
  if p_valor_compra is null or p_valor_compra <= 0 then
    raise exception 'valor_invalido' using hint = 'Valor da compra precisa ser maior que zero.';
  end if;

  select * into v_par from cash.parametros where id;

  -- Compra no balcão ganha o multiplicador; pela internet, não. É a regra que
  -- faz o programa trazer gente para a rua, que é o produto.
  v_mult := case when p_presencial then v_par.multiplicador_presencial else 1 end;
  v_valor := round(p_valor_compra * v_loja.cashback_percentual / 100 * v_mult, 2);
  if v_valor <= 0 then
    raise exception 'cashback_zero' using hint = 'O cashback calculado ficou em zero.';
  end if;

  v_destino := case when p_restrito then cash.conta_restrita(p_cliente, p_loja)
                    else cash.conta_acumulo(p_cliente) end;
  v_prazo := case when p_restrito then v_par.prazo_restrito_dias else v_par.prazo_acumulo_dias end;

  perform cash.mover(cash.conta_credito(p_loja), v_destino, v_valor,
                     false, current_date + v_prazo, p_loja::text);

  v_id := cash.registrar(
    p_chave, 'cashback', cash.conta_credito(p_loja), v_destino, v_valor,
    format('%s: compra de R$ %s%s rendeu %s%s',
      v_loja.nome, round(p_valor_compra,2),
      case when p_presencial then ' na loja (dobro)' else ' pela internet' end,
      v_valor,
      case when p_restrito then ' só para usar aqui' else '' end),
    round(p_valor_compra, 2));

  perform cash.conferir_invariante();
  return v_id;
end $$;
