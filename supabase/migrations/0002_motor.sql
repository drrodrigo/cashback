-- ---------------------------------------------------------------------------
-- Cash -- as operações. O motor sai do navegador e passa a morar no banco.
--
-- POR QUE ISTO EXISTE, e não basta o motor em TypeScript que já está testado:
-- regra de dinheiro no navegador é sugestão. Quem abre as ferramentas do
-- navegador reescreve o saldo, dá cashback sem crédito e paga sem ter. O
-- `cash/src/nucleo/livro.ts` continua valendo -- ele é a mesma regra, onde dá
-- para testar barato e rápido (29 testes) --, mas a palavra final é esta aqui.
--
-- TRÊS COISAS QUE O MOTOR DO NAVEGADOR NÃO PRECISAVA TER, e aqui são obrigatórias:
--
-- 1. TRAVA DE LINHA (`for update`). Lá roda um navegador só, um clique por vez.
--    Aqui dois balcões podem cobrar o mesmo cliente no mesmo segundo: sem a
--    trava, os dois leem o mesmo saldo e o cliente gasta o dobro do que tem.
--
-- 2. LOTE VENCIDO NÃO É GASTÁVEL NO MESMO INSTANTE EM QUE VENCE. Lá o relógio
--    anda num botão e o vencimento acontece junto. Aqui o dia passa sozinho, e a
--    varredura (`cash.vencer_lotes`) roda quando rodar. Então quem decide o que
--    dá para gastar é a LEITURA (`cash.saldo` ignora o que já venceu), não a
--    varredura -- senão um dia sem varredura é um dia gastando dinheiro morto.
--    A conferência continua somando o lote vencido, porque o lastro dele continua
--    em custódia: ele não desapareceu, só não é de ninguém até ser arquivado.
--
-- 3. `clock_timestamp()`, NÃO `now()`. Dentro de uma transação `now()` é o mesmo
--    valor para todo mundo, e os lotes criados no mesmo lançamento empatariam no
--    desempate de consumo (FIFO por vencimento, depois por criação) -- a ordem
--    ficaria indefinida. É a lição da 0080 do BipeChat, de graça aqui.
--
-- A regra que todas elas protegem continua uma só:
--
--     soma de TODO o cash que existe  ==  dinheiro parado em custódia
--
-- Conferida DEPOIS de cada operação, dentro da mesma transação: se não fechar, a
-- operação não acontece.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Cash -- o motor (as peças que as operações usam).
--
-- A 0002, a 0003 e a 0004 eram um arquivo só, e foram partidas em três por um
-- motivo prático que vale anotar: a ferramenta que aplica migration na produção
-- desiste em 60 segundos, e o arquivo inteiro (27 KB de PL/pgSQL) não cabia --
-- ela abortava e voltava atrás, deixando ZERO função no banco. Partir em três
-- fez cada uma caber. O repositório ficou igual à produção de propósito: três
-- arquivos aqui, três migrations lá.
-- ---------------------------------------------------------------------------

-- Ponto 3 acima. As tabelas nasceram com `now()` na 0001.
alter table cash.lotes        alter column criado_em set default clock_timestamp();
alter table cash.lancamentos  alter column em        set default clock_timestamp();
alter table cash.movimentos_de_caixa alter column em set default clock_timestamp();

-- --- nomes de conta ----------------------------------------------------------
-- Conta é um nome, não uma tabela -- igualzinho ao motor do navegador. Estas
-- funções existem para o nome ser escrito num lugar só: 'cliente:<id>:acumulo'
-- digitado à mão em dez lugares é o jeito mais barato de perder dinheiro de
-- vista (ele não desaparece, fica numa conta que ninguém lê).

create or replace function cash.conta_promocional() returns text
  language sql immutable as $$ select 'plataforma:promocional'::text $$;

create or replace function cash.conta_credito(p_loja uuid) returns text
  language sql immutable as $$ select 'loja:' || p_loja::text || ':credito' $$;

create or replace function cash.conta_recebido(p_loja uuid) returns text
  language sql immutable as $$ select 'loja:' || p_loja::text || ':recebido' $$;

create or replace function cash.conta_acumulo(p_cliente uuid) returns text
  language sql immutable as $$ select 'cliente:' || p_cliente::text || ':acumulo' $$;

create or replace function cash.conta_disponivel(p_cliente uuid) returns text
  language sql immutable as $$ select 'cliente:' || p_cliente::text || ':disponivel' $$;

create or replace function cash.conta_restrita(p_cliente uuid, p_loja uuid) returns text
  language sql immutable as $$ select 'cliente:' || p_cliente::text || ':restrito:' || p_loja::text $$;

-- --- leitura ------------------------------------------------------------------

-- O que dá para gastar nesta conta HOJE. Ignora lote vencido mesmo que a
-- varredura ainda não tenha passado (ponto 2 do cabeçalho).
create or replace function cash.saldo(p_conta text) returns numeric
language sql stable as $$
  select coalesce(sum(valor), 0)::numeric(12,2)
    from cash.lotes
   where conta = p_conta
     and (vence_em is null or vence_em >= current_date);
$$;

-- Tudo que existe, vencido ou não. É este número que tem que bater com a
-- custódia -- e por isso ele NÃO filtra vencimento.
create or replace function cash.cash_existente() returns numeric
language sql stable as $$
  select coalesce(sum(valor), 0)::numeric(12,2) from cash.lotes;
$$;

create or replace function cash.custodia() returns numeric
language sql stable as $$
  select coalesce(sum(valor_em_reais), 0)::numeric(12,2) from cash.movimentos_de_caixa;
$$;

-- Quanto deste cliente dá para usar NESTA loja: o restrito dela mais o livre.
create or replace function cash.pode_usar_na_loja(p_cliente uuid, p_loja uuid) returns numeric
language sql stable as $$
  select (cash.saldo(cash.conta_restrita(p_cliente, p_loja))
        + cash.saldo(cash.conta_disponivel(p_cliente)))::numeric(12,2);
$$;

-- Quando morre o primeiro pedaço do que já está liberado para gastar. É o número
-- que a carteira mostra em letra grande: prazo que a pessoa não vê não apressa
-- ninguém, e apressar é o produto todo.
create or replace function cash.vence_em_disponivel(p_cliente uuid) returns date
language sql stable as $$
  select min(vence_em) from cash.lotes
   where conta = cash.conta_disponivel(p_cliente)
     and vence_em is not null and vence_em >= current_date;
$$;

-- --- a trava ------------------------------------------------------------------

create or replace function cash.conferir_invariante() returns void
language plpgsql as $$
declare
  v_cash numeric := cash.cash_existente();
  v_custodia numeric := cash.custodia();
begin
  if abs(v_cash - v_custodia) >= 0.005 then
    -- Aborta a transação inteira: a operação que desequilibrou não aconteceu.
    -- Melhor a pessoa ver um erro no balcão do que a rede carregar um furo que
    -- só aparece no dia em que alguém for sacar.
    raise exception 'invariante_quebrada'
      using hint = format('Existe %s de cash para %s em custódia.', v_cash, v_custodia);
  end if;
end $$;

-- Idempotência. O balcão tem sinal ruim e o vendedor toca duas vezes: a mesma
-- chave nunca vira dois lançamentos. A trava de aviso (`pg_advisory_xact_lock`)
-- é o que faz os DOIS toques simultâneos virarem um -- sem ela, as duas
-- transações não acham lançamento nenhum e as duas gravam.
create or replace function cash.ja_feito(p_chave text) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  if p_chave is null then return null; end if;
  perform pg_advisory_xact_lock(hashtext('cash:' || p_chave));
  select id into v_id from cash.lancamentos where chave = p_chave;
  return v_id;
end $$;

create or replace function cash.parametro_gatilho() returns numeric
  language sql stable as $$ select gatilho from cash.parametros where id $$;

-- --- o movimento, que é onde o dinheiro realmente anda -------------------------
-- Nunca cria nem destrói valor: o que sai de um lado entra do outro, sempre.
-- A ordem de consumo importa mais do que parece -- sai primeiro o que vence
-- antes. O contrário deixaria o cliente perder saldo TENDO GASTADO, que é a
-- reclamação mais cara que um programa desses consegue gerar.
create or replace function cash.mover(
  p_de text,
  p_para text,
  p_valor numeric,
  p_manter_vencimento boolean,
  p_vence_em date,
  p_emissor text default null
) returns void
language plpgsql as $$
declare
  v_restante numeric := round(p_valor, 2);
  v_disponivel numeric;
  v_usado numeric;
  l record;
begin
  if p_valor is null or p_valor <= 0 then
    raise exception 'valor_invalido' using hint = 'Valor precisa ser maior que zero.';
  end if;

  -- Ponto 1 do cabeçalho: trava as linhas da origem antes de ler o saldo.
  perform 1 from cash.lotes
   where conta = p_de and (vence_em is null or vence_em >= current_date)
   for update;

  v_disponivel := cash.saldo(p_de);
  if v_disponivel + 0.005 < p_valor then
    raise exception 'saldo_insuficiente'
      using hint = format('A conta tem %s e a operação pede %s.', v_disponivel, round(p_valor, 2));
  end if;

  for l in
    select id, valor, emissor, vence_em
      from cash.lotes
     where conta = p_de and (vence_em is null or vence_em >= current_date)
     order by vence_em asc nulls last, criado_em asc, id asc
  loop
    exit when v_restante <= 0;
    v_usado := least(l.valor, v_restante);

    -- Apaga em vez de zerar: a tabela tem `check (valor > 0)` de propósito, para
    -- não existir lote fantasma de zero real ocupando conta.
    if v_usado >= l.valor then
      delete from cash.lotes where id = l.id;
    else
      update cash.lotes set valor = round(valor - v_usado, 2) where id = l.id;
    end if;

    v_restante := round(v_restante - v_usado, 2);

    insert into cash.lotes (conta, valor, emissor, vence_em)
    values (
      p_para,
      v_usado,
      coalesce(p_emissor, l.emissor),
      case when p_manter_vencimento then l.vence_em else p_vence_em end
    );
  end loop;
end $$;

create or replace function cash.registrar(
  p_chave text,
  p_tipo cash.tipo_lancamento,
  p_de text,
  p_para text,
  p_valor numeric,
  p_descricao text,
  p_valor_compra numeric default null
) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into cash.lancamentos (chave, tipo, conta_origem, conta_destino, valor, valor_compra, descricao)
  values (p_chave, p_tipo, p_de, p_para, round(p_valor, 2), p_valor_compra, p_descricao)
  returning id into v_id;
  return v_id;
end $$;

