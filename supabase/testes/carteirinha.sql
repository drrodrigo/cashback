-- A CARTEIRINHA DENTRO DO APLICATIVO (0025, 19/11/2026).
--
-- Ele: *"clicar na carteirinha (...) aí a carteirinha aparece (...) com o QR Code para fazer a transferência do troco"*.
--
-- O que este teste mede, e por quê:
--   1. as duas portas novas: logado sim, visitante não;
--   2. cada sócia vê a SUA carteirinha (com CONFLITO: duas sócias, e a resposta tem de ser a de quem está logada);
--   3. o QR que sai daqui é o do Clube (32 hexadecimais, 90 segundos);
--   4. a VOLTA INTEIRA: o QR emitido pelo app é lido no balcão e acha a pessoa certa (e não a outra);
--   5. as recusas com os códigos que a tela traduz: carteirinha desligada, quem não é do Clube, quem não entrou.
-- Roda com: bash scripts/banco-de-mentira.sh --testes

do $$
declare
  r text := E'\n';
  v_falhas int := 0;
  v_ok boolean;
  v_txt text;
  v_token text;
  v_token_bia text;
  v_expira timestamptz;
  v_loja uuid;
  p_clube uuid;
  a record;
  f text;
  u_parc    uuid := 'c1111111-1111-1111-1111-111111111111';
  u_ana     uuid := 'c2222222-2222-2222-2222-222222222222';
  u_bia     uuid := 'c3333333-3333-3333-3333-333333333333';
  u_inativa uuid := 'c4444444-4444-4444-4444-444444444444';
  u_fora    uuid := 'c5555555-5555-5555-5555-555555555555';
begin
  -- --- bancada, como superusuário ---------------------------------------------
  insert into clube.parceiros (nome, dono_id, ativo, cidade, uf)
  values ('Parceiro da Carteirinha', u_parc, true, 'Lagoa Santa', 'MG') returning id into p_clube;
  insert into clube.perfis (id, nome, telefone, nivel, prime_ate) values (u_ana, 'Ana da Carteirinha', '31988880001', 'prime', current_date + 30);
  insert into clube.perfis (id, nome, telefone) values (u_bia, 'Bia da Carteirinha', '31988880002');
  insert into clube.perfis (id, nome, telefone) values (u_inativa, 'Ivo Desligado', '31988880003');
  insert into clube.carteirinhas (membro_id, codigo_publico) values (u_ana, 'ANA0000001');
  insert into clube.carteirinhas (membro_id, codigo_publico) values (u_bia, 'BIA0000002');
  insert into clube.carteirinhas (membro_id, codigo_publico, ativa) values (u_inativa, 'IVO0000003', false);

  perform set_config('teste.e_admin', 'on', true);
  v_loja := public.cash_admin_ligar_parceiro(p_clube, 10);
  perform public.cash_admin_depositar(v_loja, 300);
  perform set_config('teste.e_admin', 'off', true);

  -- 1. As portas.
  foreach f in array array['public.cash_minha_carteirinha()', 'public.cash_qr_da_carteirinha()'] loop
    v_ok := not has_function_privilege('anon', f, 'execute') and has_function_privilege('authenticated', f, 'execute');
    r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || f || ': anon nao, logado sim' || E'\n';
    if v_ok is not true then v_falhas := v_falhas + 1; end if;
  end loop;

  execute 'set local role authenticated';

  -- As duas ativam o Troco Prime (o balcão só lê quem ativou).
  perform set_config('request.jwt.claim.sub', u_ana::text, true);
  perform public.cash_aderir();
  perform set_config('request.jwt.claim.sub', u_bia::text, true);
  perform public.cash_aderir();

  -- 2. Cada uma vê a SUA carteirinha.
  perform set_config('request.jwt.claim.sub', u_ana::text, true);
  select * into a from public.cash_minha_carteirinha();
  v_ok := a.nome = 'Ana da Carteirinha' and a.codigo_publico = 'ANA0000001' and a.ativa and a.nivel = 'prime' and a.prime_em_dia
          and a.membro_desde is not null;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'a Ana ve a carteirinha dela, Prime em dia (' || coalesce(a.codigo_publico, 'nada') || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  perform set_config('request.jwt.claim.sub', u_bia::text, true);
  select * into a from public.cash_minha_carteirinha();
  v_ok := a.nome = 'Bia da Carteirinha' and a.codigo_publico = 'BIA0000002' and not a.prime_em_dia;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'a Bia ve a dela, e nao a da Ana (' || coalesce(a.codigo_publico, 'nada') || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 3. O QR é o do Clube: 32 hexadecimais, uns 90 segundos.
  perform set_config('request.jwt.claim.sub', u_ana::text, true);
  select t.token, t.expira_em into v_token, v_expira from public.cash_qr_da_carteirinha() t;
  v_ok := v_token ~ '^[0-9a-f]{32}$' and v_expira between now() + interval '80 seconds' and now() + interval '95 seconds';
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'o QR da carteirinha: 32 hexadecimais, vale ~90 s' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  perform set_config('request.jwt.claim.sub', u_bia::text, true);
  select t.token into v_token_bia from public.cash_qr_da_carteirinha() t;

  -- 4. A VOLTA INTEIRA: o balcão lê o QR que o app mostrou, e acha a pessoa CERTA.
  perform set_config('request.jwt.claim.sub', u_parc::text, true);
  select nome into v_txt from public.cash_balcao_ler_carteirinha(v_token);
  v_ok := v_txt = 'Ana da Carteirinha';
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'o balcao le o QR do app e acha a Ana (' || coalesce(v_txt, 'nada') || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  select nome into v_txt from public.cash_balcao_ler_carteirinha(v_token_bia);
  v_ok := v_txt = 'Bia da Carteirinha';
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'e o QR da Bia acha a Bia (' || coalesce(v_txt, 'nada') || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 5. As recusas, nos códigos que a tela traduz.
  perform set_config('request.jwt.claim.sub', u_inativa::text, true);
  begin
    perform * from public.cash_qr_da_carteirinha(); v_ok := false;
  exception when others then v_ok := sqlerrm = 'carteirinha_inativa';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'carteirinha desligada nao emite QR (carteirinha_inativa)' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  perform set_config('request.jwt.claim.sub', u_fora::text, true);
  begin
    perform * from public.cash_minha_carteirinha(); v_ok := false;
  exception when others then v_ok := sqlerrm = 'precisa_ser_do_clube';
  end;
  begin
    perform * from public.cash_qr_da_carteirinha(); v_ok := false;
  exception when others then v_ok := v_ok and sqlerrm = 'precisa_ser_do_clube';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'quem nao e do Clube nao tem carteirinha nem QR (precisa_ser_do_clube)' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform * from public.cash_qr_da_carteirinha(); v_ok := false;
  exception when others then v_ok := sqlerrm = 'precisa_entrar';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'sem entrar, nada de QR (precisa_entrar)' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  execute 'reset role';
  r := r || E'\n' || case when v_falhas = 0 then 'tudo certo' else v_falhas || ' FALHOU' end;
  raise exception 'RESULTADO >>> %', r;
end $$;
