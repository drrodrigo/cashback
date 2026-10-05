-- ---------------------------------------------------------------------------
-- Cash -- O MÍNIMO PARA TRANSFERIR. O gatilho vira piso, não só porteiro.
--
-- 🔴 O DEFEITO QUE ISTO CONSERTA, e ele furava o produto inteiro:
--
-- O motor exigia ter 30 juntados para PODER transferir, mas depois deixava
-- transferir qualquer valor -- inclusive 10. Quem tivesse 30 descia 10, gastava,
-- descia 10, gastava: nunca juntava nada, e a regra dos 30 não pressionava
-- ninguém. O porteiro conferia na entrada e deixava a porta aberta.
--
-- A regra dele, de 05/10, e é dela que sai o piso:
--
--     *"Toda vez que ele tirar R$ 30 ele tem que botar R$ 30. (...) toda vez que
--     ele transferir o dinheiro para o gasto, ele tem que aguardar mais R$ 30.
--     (...) ele tem que juntar, criar A VONTADE DE JUNTAR os 30. Quando ele
--     estiver com 20, ele fala: não, falta só 10, vou gastar na loja que tem
--     cashback para eu ganhar mais 10 e poder gastar 30. Essa que é a ideia."*
--
-- A frase que decide é *"criar a vontade de juntar"*. O número 30 não existe
-- para travar o resgate -- existe para a pessoa querer achar a próxima loja da
-- rede. Transferência de 10 em 10 mata exatamente isso.
--
-- O QUE CONTINUA LIVRE, porque ele foi explícito:
--
-- - **Juntar não tem teto.** *"ele pode juntar 80, 100 reais"* -- e pode.
-- - **Gastar não é preso a uma loja.** *"o cara vai falar com ele: eu vou te dar
--   em cashback, mas você pode gastar AQUI, ou pode gastar em OUTRA LOJA PARCEIRA
--   nossa."* Ele chegou a cogitar prender na mesma loja e descartou na mesma
--   frase: *"então ele gasta na mesma loja. Não é isso, ele tem que juntar."*
--   Então a aceitação segue incondicional, como já estava.
-- - **Transferir acima do mínimo.** Quem tem 100 pode descer 30, 50 ou os 100.
--   O que não pode é descer 29.
--
-- ⚠️ A PERGUNTA QUE SOBRA, e está registrada na spec em vez de adivinhada: quando
-- a transferência deixa SOBRA (desce 30 de 45, restam 15), os 15 contam para o
-- próximo ciclo ou o ciclo recomeça do zero? *"Tem que botar R$ 30"* dá a
-- entender que recomeça; *"falta só 10"* dá a entender que conta. Hoje conta -- é
-- o mais favorável a ela, e o caso só existe se ela deixar sobra de propósito.
-- ---------------------------------------------------------------------------

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

  -- O PISO. Sem ele, quem tem 30 desce 10, gasta, desce 10 -- e nunca junta.
  if p_valor + 0.005 < v_par.gatilho then
    raise exception 'abaixo_do_minimo'
      using hint = format('A transferência mínima é %s. Juntar é o que faz o programa funcionar.', v_par.gatilho);
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

-- A tela tem que DIZER o mínimo, não descobrir pelo erro. Botão que recusa depois
-- do toque é meia porta: a pessoa digita 10, toma "mínimo é 30" e se pergunta por
-- que o campo aceitou.
drop function if exists public.cash_minha_carteira();

create or replace function public.cash_minha_carteira()
returns table(cliente_id uuid, nome text, aderiu boolean, acumulado numeric,
              disponivel numeric, vence_em date, gatilho numeric,
              falta_para_liberar numeric, pode_descer boolean,
              minimo_para_transferir numeric, pode_transferir_ate numeric)
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare
  v_cli uuid := cash.cliente_do_usuario();
  v_gatilho numeric := cash.parametro_gatilho();
  v_acumulado numeric;
begin
  -- Quem não aderiu recebe UMA LINHA dizendo isso, não vazio: vazio obrigaria a
  -- tela a adivinhar entre "não aderiu" e "deu erro".
  if v_cli is null then
    return query select null::uuid, ''::text, false, 0::numeric, 0::numeric,
                        null::date, v_gatilho, v_gatilho, false, v_gatilho, 0::numeric;
    return;
  end if;

  v_acumulado := cash.saldo(cash.conta_acumulo(v_cli));
  return query
    select c.id, c.nome, c.aderiu_em is not null,
           v_acumulado,
           cash.saldo(cash.conta_disponivel(c.id)),
           cash.vence_em_disponivel(c.id),
           v_gatilho,
           greatest(0, round(v_gatilho - v_acumulado, 2)),
           v_acumulado >= v_gatilho,
           v_gatilho,
           -- Juntar não tem teto, então o que ela pode transferir é tudo que
           -- juntou -- desde que alcance o mínimo.
           case when v_acumulado >= v_gatilho then v_acumulado else 0 end
      from cash.clientes c where c.id = v_cli;
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'cash\_%'
  loop
    execute format('revoke all on function %s from public, anon', f.assinatura);
    execute format('grant execute on function %s to authenticated, service_role', f.assinatura);
  end loop;
end $$;
