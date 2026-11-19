-- AS REGRAS "POR SÓCIO" (0019, 19/11/2026): a mesma conta, pelo login do Clube OU pela ponte do QR Bio.
--
-- O que este teste mede, e por quê:
--   1. a gaveta continua fechada: as internas `cash.*_do_membro` não abrem para anon nem para authenticated;
--   2. a interna e a pública dão a MESMA resposta para o mesmo sócio (a pública virou uma linha que chama a interna:
--      se um dia alguém copiar a regra de volta para a pública e mudar só uma, isto acusa);
--   3. o ciclo dos 30 pela interna: ganha 40, libera 30, não libera 10, paga uma cobrança da loja;
--   4. um sócio não confirma a cobrança de OUTRO (o que protege o saldo de terceiro).
-- Roda com: bash scripts/banco-de-mentira.sh --testes

do $$
declare
  r text := E'\n';
  v_falhas int := 0;
  v_ok boolean;
  v_n int;
  v_num numeric;
  v_txt text;
  u_ana uuid := gen_random_uuid();
  u_bia uuid := gen_random_uuid();
  u_fora uuid := gen_random_uuid();
  v_loja uuid;
  v_cli uuid;
  v_cli2 uuid;
  v_cob uuid;
  f text;
  a record;
begin
  -- 1. As portas das internas.
  foreach f in array array[
    'cash.carteira_do_membro(uuid)', 'cash.aderir_membro(uuid)', 'cash.descer_do_membro(uuid, numeric, text)',
    'cash.cobrancas_do_membro(uuid)', 'cash.confirmar_do_membro(uuid, uuid, text)',
    'cash.extrato_do_membro(uuid, integer)', 'cash.restritos_do_membro(uuid)'
  ] loop
    v_ok := not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute');
    r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || f || ' fechada para anon e authenticated' || E'\n';
    if v_ok is not true then v_falhas := v_falhas + 1; end if;
  end loop;

  -- Gente: duas sócias do Clube e alguém de fora. Uma loja da rede que devolve 20%.
  insert into clube.perfis (id, nome, telefone) values (u_ana, 'Ana do QR Bio', '(31) 98888-1111');
  insert into clube.perfis (id, nome, telefone) values (u_bia, 'Bia do QR Bio', '31977771111');
  insert into cash.lojas (nome, cashback_percentual, ativa) values ('Loja Teste', 20, true) returning id into v_loja;
  perform cash.depositar(v_loja, 500, 'por-socio-deposito');

  -- 2. Quem não é do Clube não abre conta.
  begin
    perform cash.aderir_membro(u_fora);
    v_ok := false;
  exception when others then v_ok := sqlerrm = 'precisa_ser_do_clube';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'quem não é do Clube não ativa (precisa_ser_do_clube)' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 3. Ativar pela interna; ativar de novo não cria outra conta.
  select cliente_id into v_cli from cash.aderir_membro(u_ana);
  select cliente_id into v_cli2 from cash.aderir_membro(u_ana);
  v_ok := v_cli is not null and v_cli = v_cli2;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'ativar duas vezes é a mesma conta' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 4. Ganha 40 (20% de 200, PELA INTERNET): junta 40, pode liberar. Na loja física seria o dobro (80): é a regra
  --    `multiplicador_presencial` do motor, que o primeiro rascunho deste teste esqueceu e esperou 40 com `true`.
  perform cash.dar_cashback(v_loja, v_cli, 200, false, false, 'por-socio-cb1');
  select * into a from cash.carteira_do_membro(u_ana);
  v_ok := a.acumulado = 40 and a.pode_descer and a.falta_para_liberar = 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'ganhou 40 de troco: juntado 40, pode liberar (veio ' || a.acumulado || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 5. A interna e a pública dão a MESMA carteira para a mesma sócia.
  perform set_config('request.jwt.claim.sub', u_ana::text, true);
  v_ok := (select to_jsonb(t) from cash.carteira_do_membro(u_ana) t) = (select to_jsonb(t) from public.cash_minha_carteira() t);
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'a carteira pela interna = pela pública' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;
  perform set_config('request.jwt.claim.sub', '', true);

  -- 6. Libera 30; não libera 10 (o mínimo é 30).
  perform cash.descer_do_membro(u_ana, 30, 'por-socio-descer1');
  select * into a from cash.carteira_do_membro(u_ana);
  v_ok := a.disponivel = 30 and a.acumulado = 10 and a.falta_para_liberar = 20;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'liberou 30: pode gastar 30, juntado 10, falta 20' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;
  begin
    perform cash.descer_do_membro(u_ana, 10, 'por-socio-descer2');
    v_ok := false;
  exception when others then v_ok := true;
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'não libera 10 (abaixo do mínimo de 30)' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 7. A loja cobra 30 numa compra de 100; a Bia NÃO confirma a cobrança da Ana; a Ana confirma.
  perform cash.aderir_membro(u_bia);
  v_cob := cash.pedir_pagamento(v_loja, v_cli, 100, 30);
  select count(*) into v_n from cash.cobrancas_do_membro(u_ana);
  r := r || case when v_n = 1 then '[ok]     ' else '[FALHOU] ' end || 'a cobrança aparece para a Ana (' || v_n || ')' || E'\n';
  if v_n <> 1 then v_falhas := v_falhas + 1; end if;
  begin
    perform cash.confirmar_do_membro(u_bia, v_cob, 'por-socio-conf-bia');
    v_ok := false;
  exception when others then v_ok := sqlerrm = 'cobranca_nao_encontrada';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'a Bia não confirma a cobrança da Ana' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;
  perform cash.confirmar_do_membro(u_ana, v_cob, 'por-socio-conf-ana');
  select * into a from cash.carteira_do_membro(u_ana);
  select count(*) into v_n from cash.cobrancas_do_membro(u_ana);
  v_ok := a.disponivel = 0 and v_n = 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'a Ana confirmou: pode gastar 0, nenhuma cobrança esperando' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 8. O extrato pela interna = pela pública.
  select count(*) into v_n from cash.extrato_do_membro(u_ana, 50);
  perform set_config('request.jwt.claim.sub', u_ana::text, true);
  select count(*) into v_num from public.cash_meu_extrato(50);
  perform set_config('request.jwt.claim.sub', '', true);
  v_ok := v_n >= 3 and v_n = v_num;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'o extrato pela interna = pela pública (' || v_n || ' lançamentos)' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 9. A conferência do dinheiro continua fechando depois de tudo isso.
  select fecha into v_ok from public.cash_conferencia();
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'a conferência fecha (todo troco tem dinheiro atrás)' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  r := r || E'\n' || case when v_falhas = 0 then 'tudo certo' else v_falhas || ' FALHOU' end;
  raise exception 'RESULTADO >>> %', r;
end $$;
