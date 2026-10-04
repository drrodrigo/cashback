-- A FRONTEIRA, medida VESTINDO cada papel.
--
-- Os testes de operação (operacoes.sql) rodam como superusuário: eles medem a
-- REGRA DO DINHEIRO. Este mede quem alcança o quê, e para isso ele troca de
-- papel de verdade (`set local role`) e troca o `auth.uid()` -- teste de
-- permissão que roda como superusuário não mede permissão nenhuma.
--
-- É a lição de 21/09: as telas de tema liam a tabela sem `eq('loja_id')`,
-- confiando na RLS, e a RLS filtrava -- menos para o ADMIN, que tinha uma policy
-- a mais. Os testes vestiam `anon`, dono e terceiro, nunca admin. A permissão que
-- ninguém veste é a que ninguém mede, então aqui vestimos SEIS: `anon`, lojista
-- dono, OUTRO lojista, quem não tem loja, cliente dono e OUTRO cliente -- mais o
-- administrador.
--
-- Roda com: bash bipechat/scripts/banco-de-mentira.sh --raiz cash --testes

do $$
declare
  r text := E'\n';
  v_falhas int := 0;
  v_ok boolean;
  v_n int;
  v_n2 int;
  v_num numeric;

  u_loj1 uuid := '11111111-1111-1111-1111-111111111111';
  u_loj2 uuid := '22222222-2222-2222-2222-222222222222';
  u_sem  uuid := '33333333-3333-3333-3333-333333333333';
  u_cli1 uuid := '44444444-4444-4444-4444-444444444444';
  u_cli2 uuid := '55555555-5555-5555-5555-555555555555';

  cat1 uuid;
  cat2 uuid;
  v_loja1 uuid;
  v_loja2 uuid;
  v_cli1 uuid;
  v_cli2 uuid;
  v_pag uuid;
  v_ped uuid;
  v_txt text;
begin
  -- --- bancada, como superusuário ---------------------------------------------
  insert into public.lojas (owner_id, nome, slug) values (u_loj1, 'Loja Um', 'lojaum') returning id into cat1;
  insert into public.lojas (owner_id, nome, slug) values (u_loj2, 'Loja Dois', 'lojadois') returning id into cat2;

  -- Vestindo ADMIN para cadastrar as duas lojas no cash: é o caminho de verdade,
  -- e já mede a função de administrador de carona.
  perform set_config('teste.e_admin', 'on', true);
  v_loja1 := public.cash_admin_cadastrar_loja(cat1, 10);
  v_loja2 := public.cash_admin_cadastrar_loja(cat2, 5);
  perform public.cash_admin_depositar(v_loja1, 1000);
  perform public.cash_admin_depositar(v_loja2, 500);
  perform set_config('teste.e_admin', 'off', true);

  -- 1. A PORTA DO VISITANTE. Nenhuma função da fronteira é alcançável por `anon`
  --    -- e isto se mede com `has_function_privilege`, nunca lendo o `revoke`:
  --    fechar são DUAS coisas (de `public` e de `anon`), e cada uma sozinha deixa
  --    a outra aberta.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'cash\_%'
     and has_function_privilege('anon', p.oid, 'execute');
  v_ok := v_n = 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'nenhuma funcao public.cash_* aberta para anon (abertas: ' || v_n || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 2. E o logado alcança todas: porta fechada demais é meia porta também -- a
  --    tela chamaria e tomaria erro de permissão, que ninguém entende.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'cash\_%'
     and not has_function_privilege('authenticated', p.oid, 'execute');
  v_ok := v_n = 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o logado alcanca todas as funcoes da fronteira (sem: ' || v_n || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- --- daqui para baixo, vestindo gente de verdade -----------------------------
  execute 'set local role authenticated';

  -- 3. O LOJISTA VÊ A LOJA DELE.
  perform set_config('request.jwt.claim.sub', u_loj1::text, true);
  select nome into v_txt from public.cash_minha_loja();
  v_ok := v_txt = 'Loja Um';
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o lojista um ve a Loja Um (' || coalesce(v_txt, 'nada') || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 4. E O OUTRO LOJISTA VÊ A DELE -- não a do primeiro. Este é o caso que tem
  --    CONFLITO: se a função ignorasse o dono, os dois veriam a mesma loja e
  --    nenhum teste de um lado só perceberia.
  perform set_config('request.jwt.claim.sub', u_loj2::text, true);
  select nome into v_txt from public.cash_minha_loja();
  v_ok := v_txt = 'Loja Dois';
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o lojista dois ve a Loja Dois (' || coalesce(v_txt, 'nada') || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 5. Quem não tem loja não vê loja nenhuma -- e recebe VAZIO, não a de outro.
  perform set_config('request.jwt.claim.sub', u_sem::text, true);
  select count(*) into v_n from public.cash_minha_loja();
  v_ok := v_n = 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'quem nao tem loja recebe vazio (linhas: ' || v_n || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 6. E não consegue operar balcão nenhum.
  begin
    perform public.cash_balcao_dar_cashback(gen_random_uuid(), 100);
    v_ok := false;
  exception when others then
    v_ok := sqlerrm like '%nao_e_lojista%';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'quem nao tem loja nao da cashback' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 7. O BALCÃO ACHA O CLIENTE PELO TELEFONE e cria na hora. Sem isto o cadastro
  --    no caixa não acontece.
  perform set_config('request.jwt.claim.sub', u_loj1::text, true);
  select cliente_id into v_cli1 from public.cash_balcao_cliente('31988880000', 'Ana');
  v_ok := v_cli1 is not null;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o balcao cadastra o cliente pelo telefone' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 8. Cashback presencial pelo balcão: 10% de 200 em dobro = 40.
  perform public.cash_balcao_dar_cashback(v_cli1, 200, true);
  perform set_config('request.jwt.claim.sub', u_loj1::text, true);
  select acumulado into v_num from public.cash_balcao_cliente('31988880000');
  v_ok := v_num = 40;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'cashback presencial de 200 a 10% rendeu 40 (' || v_num || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 9. O EXTRATO DE UMA LOJA NÃO MOSTRA A OUTRA. O extrato diz quanto e quando a
  --    pessoa comprou: o que ela gastou na Loja B não é da Loja A nunca.
  perform set_config('request.jwt.claim.sub', u_loj2::text, true);
  select count(*) into v_n from public.cash_balcao_extrato(200)
   where descricao like '%Loja Um%';
  v_ok := v_n = 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o extrato da Loja Dois nao mostra lancamento da Loja Um (' || v_n || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 10. 🔴 A CARTEIRA SE LIGA AO LOGIN PELO TELEFONE DO PRÓPRIO LOGIN, e o 55 do
  --     Brasil é tirado -- sem isso a MESMA pessoa viraria dois clientes, um com
  --     saldo e outro vazio, e ela veria a carteira vazia sem entender.
  perform set_config('request.jwt.claim.sub', u_cli1::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_cli1::text, 'phone', '5531988880000')::text, true);
  v_ok := public.cash_entrar() = v_cli1;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o login por telefone cai na carteira que o balcao criou (o 55 sai)' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 11. Quem entrou por e-mail (sem telefone no login) NÃO vira cliente. Receber
  --     o telefone num campo digitado seria a conta fantasma do BipeChat outra
  --     vez -- qualquer um logado reivindicaria a carteira de qualquer um.
  perform set_config('request.jwt.claim.sub', u_sem::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_sem::text)::text, true);
  begin
    perform public.cash_entrar();
    v_ok := false;
  exception when others then
    v_ok := sqlerrm like '%precisa_entrar_por_telefone%';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'sem telefone no login nao se liga carteira nenhuma' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 12. E O NÚMERO DE OUTRA CONTA NÃO SE ROUBA. Tem dinheiro de alguém do outro
  --     lado: a função recusa em vez de remanejar o vínculo.
  perform set_config('request.jwt.claim.sub', u_cli2::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_cli2::text, 'phone', '5531988880000')::text, true);
  begin
    perform public.cash_entrar();
    v_ok := false;
  exception when others then
    v_ok := sqlerrm like '%telefone_de_outra_conta%';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'telefone ja ligado a outro login e recusado' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 13. A carteira do cliente mostra o dele, e o gatilho.
  perform set_config('request.jwt.claim.sub', u_cli1::text, true);
  select acumulado, pode_descer into v_num, v_ok from public.cash_minha_carteira();
  v_ok := v_num = 40 and v_ok;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'a carteira mostra 40 juntados e libera a descida (gatilho 30)' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  perform public.cash_descer(40);
  select disponivel into v_num from public.cash_minha_carteira();
  v_ok := v_num = 40;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'desceu os 40 para gastar (' || v_num || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 14. 🔴 CONFIRMAR COBRANÇA DE OUTRO É GASTAR O SALDO DELE. Repare que não é a
  --     RLS que impede (a gaveta não tem policy nenhuma, de propósito): é a
  --     consulta dizer de quem é o dado. Este é o caso com CONFLITO -- os dois
  --     clientes existem e têm cobrança, então trocar o dono daria outro
  --     resultado.
  perform set_config('request.jwt.claim.sub', u_loj1::text, true);
  v_pag := public.cash_balcao_pedir_pagamento(v_cli1, 100, 40);

  perform set_config('request.jwt.claim.sub', u_cli2::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_cli2::text, 'phone', '5531977770000')::text, true);
  v_cli2 := public.cash_entrar();
  begin
    perform public.cash_confirmar(v_pag);
    v_ok := false;
  exception when others then
    v_ok := sqlerrm like '%cobranca_nao_encontrada%';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'outro cliente nao confirma a cobranca que nao e dele' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 15. E o dono dela confirma.
  perform set_config('request.jwt.claim.sub', u_cli1::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_cli1::text, 'phone', '5531988880000')::text, true);
  perform public.cash_confirmar(v_pag);
  select disponivel into v_num from public.cash_minha_carteira();
  v_ok := v_num = 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o dono confirma e os 40 saem da carteira dele (' || v_num || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 16. O EXTRATO DO CLIENTE É O DELE. O do outro não aparece.
  select count(*) into v_n from public.cash_meu_extrato(200);
  perform set_config('request.jwt.claim.sub', u_cli2::text, true);
  select count(*) into v_n2 from public.cash_meu_extrato(200);
  v_ok := v_n > 0 and v_n2 = 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o extrato do cliente dois esta vazio e o do um nao' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 17. 🔴 O LOJISTA PEDE O SAQUE, NÃO SACA. E pedir duas vezes o mesmo dinheiro
  --     não passa -- senão a plataforma paga duas vezes.
  perform set_config('request.jwt.claim.sub', u_loj1::text, true);
  v_ped := public.cash_balcao_pedir_saque(40);
  begin
    perform public.cash_balcao_pedir_saque(40);
    v_ok := false;
  exception when others then
    v_ok := sqlerrm like '%saldo_insuficiente%';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'pedir de novo o mesmo dinheiro ja pedido e recusado' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 18. NÃO EXISTE porta de saque direto para o lojista, nem de depósito. Isto é
  --     estrutural: uma função a mais com esse nome reabriria o buraco, e trava
  --     que mede o EFEITO não enxerga função que ainda não existe.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('cash_balcao_sacar', 'cash_balcao_depositar', 'cash_sacar', 'cash_depositar');
  v_ok := v_n = 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'nao existe saque nem deposito direto na fronteira (' || v_n || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 19. O lojista não alcança nada de administrador.
  begin
    perform public.cash_admin_painel();
    v_ok := false;
  exception when others then
    v_ok := sqlerrm like '%so_admin%';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o lojista nao abre o painel de administrador' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  begin
    perform public.cash_admin_depositar(v_loja1, 999999);
    v_ok := false;
  exception when others then
    v_ok := sqlerrm like '%so_admin%';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o lojista nao deposita credito para si mesmo' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 20. E QUEM PAGA EXECUTA: o administrador paga o pedido, o livro anda e o
  --     pedido fica 'pago' na MESMA transação -- as duas, ou nenhuma.
  perform set_config('teste.e_admin', 'on', true);
  perform public.cash_admin_pagar_saque(v_ped);
  -- Olha pela FRONTEIRA, não pela tabela: vestindo `authenticated` a gaveta
  -- recusa `cash.saques_pedidos` com `permission denied for schema cash` -- que
  -- é a regra 4 funcionando, e foi este teste que mostrou isso acontecendo.
  select s.situacao into v_txt from public.cash_admin_saques_pedidos() s where s.id = v_ped;
  v_ok := v_txt = 'pago';
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o administrador paga o pedido e ele fica pago (' || coalesce(v_txt,'?') || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  begin
    perform public.cash_admin_pagar_saque(v_ped);
    v_ok := false;
  exception when others then
    v_ok := sqlerrm like '%pedido_ja_resolvido%';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'pagar o mesmo pedido duas vezes e recusado' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 21. E DEPOIS DE TUDO, A CONTA FECHA. É a única medida que não se pode dar por
  --     boa por construção: dezenove operações atravessando sete papéis.
  select fecha into v_ok from public.cash_admin_painel();
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'a invariante fecha depois de tudo, vista pelo painel' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  execute 'reset role';

  r := r || E'\n' || case when v_falhas = 0 then 'tudo certo' else v_falhas || ' FALHOU' end;
  raise exception 'RESULTADO >>> %', r;
end $$;
