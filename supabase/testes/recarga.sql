-- A RECARGA DA LOJA POR PIX (0027, 19/11/2026).
--
-- Ele: *"ele tem que pagar por esse troco (...) pelo menos os R$ 100 para começar (...) esse Pix cai na conta dele"*.
--
-- O que este teste mede, e por quê:
--   1. o mínimo de R$ 100 (99,99 não; 100 sim) e só lojista pede;
--   2. 🔴 O LOJISTA NÃO SE DÁ CRÉDITO: as duas `cash_servidor_*` estão abertas ao logado (a varredura de portas abre
--      todas), mas recusam quem não é o servidor. Sem esta trava, o balcão chamaria a baixa e ganharia R$ 100 de graça;
--   3. a baixa do servidor credita o valor CHEIO na loja, guarda a taxa, e o aviso repetido NÃO credita de novo;
--   4. aviso que chega antes de a cobrança ser guardada acha a recarga pela referência;
--   5. Pix pago a menor não credita: fica "valor_divergente" para o administrador resolver na mão;
--   6. cada loja vê só as suas recargas (com CONFLITO: duas lojas);
--   7. só o administrador confirma na mão.
-- Roda com: bash scripts/banco-de-mentira.sh --testes

do $$
declare
  r text := E'\n';
  v_falhas int := 0;
  v_ok boolean;
  v_txt text;
  v_num numeric;
  v_n int;
  v_rec uuid;
  v_rec2 uuid;
  v_rec3 uuid;
  v_loja uuid;
  v_loja2 uuid;
  cat1 uuid;
  cat2 uuid;
  u_dono  uuid := 'd1111111-1111-1111-1111-111111111111';
  u_dono2 uuid := 'd2222222-2222-2222-2222-222222222222';
  u_fora  uuid := 'd3333333-3333-3333-3333-333333333333';
  a record;
begin
  -- --- bancada: duas lojas do Catálogo, ligadas no Troco Prime, SEM crédito ---------------------------------------
  insert into public.lojas (owner_id, nome, slug) values (u_dono, 'Loja da Recarga', 'lojarecarga') returning id into cat1;
  insert into public.lojas (owner_id, nome, slug) values (u_dono2, 'Outra Loja', 'outraloja') returning id into cat2;
  perform set_config('teste.e_admin', 'on', true);
  v_loja := public.cash_admin_ligar_loja_do_catalogo(cat1, 10);
  v_loja2 := public.cash_admin_ligar_loja_do_catalogo(cat2, 10);
  perform set_config('teste.e_admin', 'off', true);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_dono, 'email', 'dono@recarga.com', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', u_dono::text, true);

  -- 1. O mínimo, e só lojista.
  begin
    perform * from public.cash_pedir_recarga(99.99); v_ok := false;
  exception when others then v_ok := sqlerrm = 'recarga_abaixo_do_minimo';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'recarga de R$ 99,99 e recusada (o minimo e R$ 100)' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  select * into a from public.cash_pedir_recarga(100);
  v_rec := a.recarga_id;
  v_ok := v_rec is not null and a.valor = 100 and a.loja_nome = 'Loja da Recarga' and a.email = 'dono@recarga.com';
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'recarga de R$ 100 aceita, com a loja e o e-mail para o Pix' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  perform set_config('request.jwt.claim.sub', u_fora::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_fora, 'role', 'authenticated')::text, true);
  begin
    perform * from public.cash_pedir_recarga(100); v_ok := false;
  exception when others then v_ok := sqlerrm = 'nao_e_lojista';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'quem nao e lojista nao pede recarga' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 2. 🔴 O lojista NÃO se dá crédito (nem guarda cobrança), mesmo com a porta aberta.
  perform set_config('request.jwt.claim.sub', u_dono::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_dono, 'role', 'authenticated')::text, true);
  begin
    perform public.cash_servidor_baixa_da_recarga('qualquer', v_rec::text, 10000); v_ok := false;
  exception when others then v_ok := sqlerrm = 'so_servidor';
  end;
  begin
    perform public.cash_servidor_cobranca_da_recarga(v_rec, 'mp-1', '000201', now()); v_ok := false;
  exception when others then v_ok := v_ok and sqlerrm = 'so_servidor';
  end;
  select credito into v_num from public.cash_minha_loja();
  v_ok := v_ok and v_num = 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'o lojista NAO se da credito pela baixa (so_servidor; credito ' || coalesce(v_num::text,'?') || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 3. O servidor guarda a cobrança e dá a baixa: crédito CHEIO, taxa guardada, aviso repetido não credita de novo.
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform public.cash_servidor_cobranca_da_recarga(v_rec, 'mp-111', '00020101021226990014br.gov.bcb.pix', now() + interval '1 day');
  v_txt := public.cash_servidor_baixa_da_recarga('mp-111', v_rec::text, 10000, 99, 9901);
  v_ok := v_txt = 'creditada';
  v_txt := public.cash_servidor_baixa_da_recarga('mp-111', v_rec::text, 10000, 99, 9901);
  v_ok := v_ok and v_txt = 'ja_paga';

  perform set_config('request.jwt.claims', json_build_object('sub', u_dono, 'role', 'authenticated')::text, true);
  select credito into v_num from public.cash_minha_loja();
  v_ok := v_ok and v_num = 100;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'o Pix pago credita R$ 100 cheios, e o aviso repetido nao credita de novo (credito ' || coalesce(v_num::text,'?') || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 4. Aviso antes da cobrança guardada: acha pela referência (o id da recarga).
  select recarga_id into v_rec2 from public.cash_pedir_recarga(200);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  v_txt := public.cash_servidor_baixa_da_recarga('mp-222', v_rec2::text, 20000, 198, 19802);
  perform set_config('request.jwt.claims', json_build_object('sub', u_dono, 'role', 'authenticated')::text, true);
  select credito into v_num from public.cash_minha_loja();
  v_ok := v_txt = 'creditada' and v_num = 300;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'o aviso que chega antes acha a recarga pela referencia (' || v_txt || ', credito ' || coalesce(v_num::text,'?') || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 5. Pago a menor: não credita.
  select recarga_id into v_rec3 from public.cash_pedir_recarga(100);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform public.cash_servidor_cobranca_da_recarga(v_rec3, 'mp-333', '000201', now() + interval '1 day');
  v_txt := public.cash_servidor_baixa_da_recarga('mp-333', v_rec3::text, 5000);
  perform set_config('request.jwt.claims', json_build_object('sub', u_dono, 'role', 'authenticated')::text, true);
  select credito into v_num from public.cash_minha_loja();
  v_ok := v_txt = 'valor_divergente' and v_num = 300;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'Pix pago a menor nao credita (' || v_txt || ', credito ' || coalesce(v_num::text,'?') || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 6. Cada loja vê só as suas (a outra loja não vê nenhuma das três).
  select count(*) into v_n from public.cash_minhas_recargas();
  v_ok := v_n = 3;
  perform set_config('request.jwt.claim.sub', u_dono2::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_dono2, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.cash_minhas_recargas();
  v_ok := v_ok and v_n = 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'cada loja ve so as suas recargas (a outra ve ' || v_n || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 7. Só o administrador confirma na mão; e a lista dele mostra a taxa.
  begin
    perform public.cash_admin_confirmar_recarga(v_rec3); v_ok := false;
  exception when others then v_ok := sqlerrm = 'so_admin';
  end;
  perform set_config('teste.e_admin', 'on', true);
  select taxa_do_provedor, valor_liquido into a from public.cash_admin_recargas() where id = v_rec;
  v_ok := v_ok and a.taxa_do_provedor = 0.99 and a.valor_liquido = 99.01;
  v_txt := public.cash_admin_confirmar_recarga(v_rec3);
  v_ok := v_ok and v_txt = 'creditada';
  perform set_config('teste.e_admin', 'off', true);
  perform set_config('request.jwt.claim.sub', u_dono::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_dono, 'role', 'authenticated')::text, true);
  select credito into v_num from public.cash_minha_loja();
  v_ok := v_ok and v_num = 400;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'so o administrador confirma na mao; a lista mostra a taxa (credito ' || coalesce(v_num::text,'?') || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  execute 'reset role';

  -- 8. As portas: anon não, logado sim (as de servidor se defendem por dentro, medido no passo 2).
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('cash_pedir_recarga', 'cash_servidor_cobranca_da_recarga', 'cash_servidor_baixa_da_recarga',
                       'cash_minhas_recargas', 'cash_admin_recargas', 'cash_admin_confirmar_recarga')
     and not has_function_privilege('anon', p.oid, 'execute');
  v_ok := v_n = 6;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'as 6 funcoes da recarga fechadas ao anon (' || v_n || ' de 6)' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  r := r || E'\n' || case when v_falhas = 0 then 'tudo certo' else v_falhas || ' FALHOU' end;
  raise exception 'RESULTADO >>> %', r;
end $$;
