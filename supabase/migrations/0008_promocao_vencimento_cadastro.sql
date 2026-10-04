-- ---------------------------------------------------------------------------
-- Cash -- brinde da rede, varredura do vencimento e cadastro.
--
-- UM ARQUIVO POR MIGRATION DA PRODUÇÃO, de propósito. Elas eram duas, maiores, e
-- foram partidas assim porque a ferramenta que aplica migration desiste em 60
-- segundos e abortava a transação inteira -- deixando ZERO função no banco. O
-- repositório ficou com a mesma divisão que a produção para a conferência ser
-- arquivo contra função viva, uma a uma; migration que só existe de um lado é
-- exatamente o que já custou caro aqui ("o repositório não prova a produção").
-- ---------------------------------------------------------------------------

-- Distribuir brinde é a única operação que PARECE criar cash do nada -- e não
-- cria: sai do fundo de promoção, que tem lastro. Se um dia a plataforma emitir
-- cash sem dinheiro atrás, o saque vira promessa e o modelo inteiro cai.
create or replace function cash.distribuir_promocao(
  p_cliente uuid, p_valor numeric, p_chave text default null
) returns uuid
language plpgsql as $$
declare
  v_id uuid;
  v_fundo numeric;
  v_par record;
begin
  v_id := cash.ja_feito(p_chave);
  if v_id is not null then return v_id; end if;

  select * into v_par from cash.parametros where id;
  v_fundo := cash.saldo(cash.conta_promocional());

  if p_valor is null or p_valor <= 0 then raise exception 'valor_invalido'; end if;
  if v_fundo + 0.005 < p_valor then
    raise exception 'fundo_insuficiente'
      using hint = format('O fundo tem %s. Para dar mais que isso, a plataforma precisa depositar dinheiro de verdade antes.', v_fundo);
  end if;

  perform cash.mover(cash.conta_promocional(), cash.conta_acumulo(p_cliente), p_valor,
                     false, current_date + v_par.prazo_acumulo_dias, 'plataforma');

  v_id := cash.registrar(
    p_chave, 'cashback', cash.conta_promocional(), cash.conta_acumulo(p_cliente), p_valor,
    format('Campanha da rede: %s de brinde', round(p_valor,2)));

  perform cash.conferir_invariante();
  return v_id;
end $$;

-- A VARREDURA DO VENCIMENTO. Arquiva o que morreu: sai do bolso de quem não usou
-- e vira fundo de promoção (decisão do dono), e o dinheiro que dava lastro
-- continua na custódia -- então a conta segue fechando.
--
-- Ela é CONTABILIDADE, não regra de gasto: quem impede gastar lote vencido é
-- `cash.saldo`, que já não o conta. Rodar atrasado atrasa o relatório, não
-- libera dinheiro morto.
create or replace function cash.vencer_lotes() returns int
language plpgsql as $$
declare
  l record;
  v_n int := 0;
begin
  for l in
    select id, conta, valor from cash.lotes
     where vence_em is not null and vence_em < current_date
       and conta <> cash.conta_promocional()
     for update
  loop
    delete from cash.lotes where id = l.id;
    insert into cash.lotes (conta, valor, emissor, vence_em)
    values (cash.conta_promocional(), l.valor, 'plataforma', null);
    perform cash.registrar(
      null, 'vencimento', l.conta, cash.conta_promocional(), l.valor,
      format('Venceu %s sem uso e virou fundo de promoção', l.valor));
    v_n := v_n + 1;
  end loop;
  perform cash.conferir_invariante();
  return v_n;
end $$;

-- --- cadastro -----------------------------------------------------------------

-- Acha o cliente pelo telefone ou cria. É o balcão: o vendedor digita o número e
-- segue. Cadastro que exige o cliente parar para preencher formulário no caixa
-- não acontece -- é a lição do "dita seu CPF" do supermercado.
create or replace function cash.achar_ou_criar_cliente(p_telefone text, p_nome text default '')
returns uuid
language plpgsql as $$
declare
  v_id uuid;
  v_tel text := regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g');
begin
  if length(v_tel) < 10 then
    raise exception 'telefone_invalido' using hint = 'Telefone precisa ter DDD e número.';
  end if;

  insert into cash.clientes (telefone, nome) values (v_tel, coalesce(p_nome, ''))
  on conflict (telefone) do update
    -- DUPLICAR FAZ BARULHO, SUBSTITUIR NÃO (lição de 20/09): aqui o `do update`
    -- só preenche o nome quando ele está vazio, nunca por cima do que já existe.
    set nome = case when cash.clientes.nome = '' then excluded.nome else cash.clientes.nome end
  returning id into v_id;

  return v_id;
end $$;

-- A gaveta continua fechada: nada aqui é alcançável por `anon` nem por
-- `authenticated`, porque nenhum dos dois tem `usage` no schema. Quem serve a
-- tela é a camada curta em `public` (a 0003). Isto aqui é o motor.
grant execute on all functions in schema cash to service_role;
