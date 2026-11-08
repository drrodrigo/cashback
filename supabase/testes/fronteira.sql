-- A FRONTEIRA, medida VESTINDO cada papel.
--
-- Os testes de operação (operacoes.sql) rodam como superusuário: eles medem a
-- REGRA DO DINHEIRO. Este mede quem alcança o quê, e para isso troca de papel de
-- verdade (`set local role`) e troca o `auth.uid()` -- teste de permissão que roda
-- como superusuário não mede permissão nenhuma.
--
-- É a lição de 21/09: as telas de tema liam a tabela sem `eq('loja_id')`,
-- confiando na RLS, e a RLS filtrava -- menos para o ADMIN, que tinha uma policy
-- a mais. Os testes vestiam `anon`, dono e terceiro, nunca admin. A permissão que
-- ninguém veste é a que ninguém mede.
--
-- 🔴 E DESDE 04/10 ELE MEDE A CARTEIRINHA, que é a porta do balcão. Não existe
-- campo para digitar quem é o cliente, de propósito: o token prova que a pessoa
-- está ali com o aplicativo na mão. As quatro recusas do Clube (token usado, QR
-- que não é carteirinha, parceiro que não é dono, carteirinha inativa) são o que
-- protege o saldo de terceiro, então elas são medidas aqui, uma por uma.
--
-- Roda com: bash scripts/banco-de-mentira.sh --testes

do $$
declare
  r text := E'\n';
  v_falhas int := 0;
  v_ok boolean;
  v_ok2 boolean;
  v_n int;
  v_n2 int;
  v_num numeric;
  v_num2 numeric;
  v_txt text;
  v_cobranca_confirmada uuid;
  -- 🔴 O CLUBE PÕE O CÓDIGO DO ERRO NA *DICA* (`hint`) E A FRASE NA MENSAGEM; o
  -- cash faz o contrário. `sqlerrm` lê só a MENSAGEM, então um teste que confere
  -- apenas `sqlerrm` é CEGO para os códigos do Clube -- e foi exatamente isso que
  -- aconteceu aqui: dois passos ficaram vermelhos medindo a coisa errada. Vale
  -- para a tela também: quem for tratar erro do Clube tem que ler a dica.
  v_dica text;

  -- Gente. Dois lojistas do Clube, um lojista do Catálogo, dois membros, um de fora.
  u_parc1 uuid := '11111111-1111-1111-1111-111111111111';
  u_parc2 uuid := '22222222-2222-2222-2222-222222222222';
  u_cat   uuid := '33333333-3333-3333-3333-333333333333';
  u_mem1  uuid := '44444444-4444-4444-4444-444444444444';
  u_mem2  uuid := '55555555-5555-5555-5555-555555555555';
  u_fora  uuid := '66666666-6666-6666-6666-666666666666';

  p_clube1 uuid;
  p_clube2 uuid;
  cat_loja uuid;
  v_loja1 uuid;
  v_loja2 uuid;
  v_loja_cat uuid;
  v_cli1 uuid;
  v_cli2 uuid;
  v_token text;
  v_pag uuid;
  v_ped uuid;
  v_val uuid;
begin
  -- --- bancada, como superusuário ---------------------------------------------

  -- O Clube: dois parceiros com dono, dois membros com carteirinha.
  insert into clube.parceiros (nome, dono_id, ativo, cidade, uf)
  values ('Parceiro Um', u_parc1, true, 'Lagoa Santa', 'MG') returning id into p_clube1;
  insert into clube.parceiros (nome, dono_id, ativo, cidade, uf)
  values ('Parceiro Dois', u_parc2, true, 'Belo Horizonte', 'MG') returning id into p_clube2;
  insert into clube.perfis (id, nome, telefone) values (u_mem1, 'Ana do Clube', '(31) 98888-0000');
  insert into clube.perfis (id, nome, telefone) values (u_mem2, 'Bruno do Clube', '31977770000');
  insert into clube.carteirinhas (membro_id, codigo_publico) values (u_mem1, 'ABC1234567');
  insert into clube.carteirinhas (membro_id, codigo_publico) values (u_mem2, 'DEF7654321');

  -- O Catálogo: uma loja com dono.
  insert into public.lojas (owner_id, nome, slug) values (u_cat, 'Loja do Catalogo', 'lojacat') returning id into cat_loja;

  -- Vestindo ADMIN para ligar as três no cashback -- é o caminho de verdade, e
  -- mede as funções de administrador de carona.
  perform set_config('teste.e_admin', 'on', true);
  v_loja1    := public.cash_admin_ligar_parceiro(p_clube1, 10);
  v_loja2    := public.cash_admin_ligar_parceiro(p_clube2, 5);
  v_loja_cat := public.cash_admin_ligar_loja_do_catalogo(cat_loja, 8);
  perform public.cash_admin_depositar(v_loja1, 1000);
  perform public.cash_admin_depositar(v_loja2, 500);
  perform public.cash_admin_depositar(v_loja_cat, 500);
  perform set_config('teste.e_admin', 'off', true);

  -- 1. A PORTA DO VISITANTE. Nenhuma função da fronteira é alcançável por `anon`
  --    -- medido com `has_function_privilege`, nunca lendo o `revoke`: fechar são
  --    DUAS coisas (de `public` e de `anon`), e cada uma sozinha deixa a outra
  --    aberta.
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

  -- 3 e 4. CADA LOJISTA VÊ A LOJA DELE, pelos DOIS caminhos (parceiro do Clube e
  --        loja do Catálogo). Este é o caso com CONFLITO: se a função ignorasse o
  --        dono, os três veriam a mesma loja e um teste de um lado só não veria.
  perform set_config('request.jwt.claim.sub', u_parc1::text, true);
  select nome into v_txt from public.cash_minha_loja();
  v_ok := v_txt = 'Parceiro Um';
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o dono do Parceiro Um ve a loja dele (' || coalesce(v_txt,'nada') || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  perform set_config('request.jwt.claim.sub', u_parc2::text, true);
  select nome into v_txt from public.cash_minha_loja();
  v_ok := v_txt = 'Parceiro Dois';
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o dono do Parceiro Dois ve a DELE (' || coalesce(v_txt,'nada') || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  perform set_config('request.jwt.claim.sub', u_cat::text, true);
  select nome into v_txt from public.cash_minha_loja();
  v_ok := v_txt = 'Loja do Catalogo';
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'a lojista do Catalogo entra com o login que ela ja tem' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 5. Quem não tem loja recebe VAZIO -- não a de outro -- e não opera balcão.
  perform set_config('request.jwt.claim.sub', u_fora::text, true);
  select count(*) into v_n from public.cash_minha_loja();
  v_ok := v_n = 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'quem nao tem loja recebe vazio (linhas: ' || v_n || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  begin
    perform public.cash_balcao_dar_cashback(gen_random_uuid(), 100);
    v_ok := false;
  exception when others then v_ok := sqlerrm like '%nao_e_lojista%';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'quem nao tem loja nao da cashback' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 6. 🔴 A PORTA DO BALCÃO É A CARTEIRINHA. O membro emite o token no aplicativo
  --    dele; o parceiro lê. Repare o que isto faz de graça: o cliente do cash
  --    NASCE do membro do Clube, com nome e telefone COPIADOS (regra 3) -- não há
  --    cadastro nenhum a preencher no caixa.
  -- 🔴 PRIMEIRO O CASO DE QUEM NÃO ATIVOU, que vem de graça porque ninguém
  --    aderiu ainda. A conta NASCE DE UM CLIQUE DELE, não de uma venda: creditar
  --    numa conta que ninguém abriu é conta fantasma COM DINHEIRO -- a pessoa
  --    passaria a ter saldo num produto em que nunca entrou.
  perform set_config('request.jwt.claim.sub', u_mem1::text, true);
  v_token := clube.emitir_token_carteirinha();
  perform set_config('request.jwt.claim.sub', u_parc1::text, true);
  begin
    perform * from public.cash_balcao_ler_carteirinha(v_token);
    v_ok := false;
  exception when others then v_ok := sqlerrm like '%membro_nao_ativou%';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o balcao recusa quem ainda nao ativou o cashback' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- E a carteira de quem não ativou devolve UMA LINHA dizendo isso, não vazio --
  -- é o que deixa a tela desenhar o botão "ativar" em vez de adivinhar entre
  -- "não aderiu" e "deu erro".
  perform set_config('request.jwt.claim.sub', u_mem1::text, true);
  select aderiu, falta_para_liberar into v_ok, v_num from public.cash_minha_carteira();
  v_ok := v_ok is false and v_num = 30;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'quem nao ativou ve aderiu=false e faltam 30 (' || coalesce(v_num,-1) || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 🔴 O BOTÃO DE ATIVAR. Saldo zero, nome e telefone copiados do Clube.
  select cliente_id, nome, saldo into v_cli1, v_txt, v_num from public.cash_aderir();
  v_ok := v_cli1 is not null and v_txt = 'Ana do Clube' and v_num = 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'ativar abre a conta com saldo zero e o nome do Clube (' || coalesce(v_txt,'nada') || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- Tocar duas vezes no "ativar" não cria segunda conta nem reinicia a adesão.
  -- É celular: o dedo tremido é mais provável aqui que no balcão.
  select cliente_id into v_cli2 from public.cash_aderir();
  select count(*) into v_n from public.cash_minha_carteira() where aderiu;
  v_ok := v_cli2 = v_cli1 and v_n = 1;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'ativar duas vezes e a mesma conta' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  perform set_config('request.jwt.claim.sub', u_mem1::text, true);
  v_token := clube.emitir_token_carteirinha();

  perform set_config('request.jwt.claim.sub', u_parc1::text, true);
  select cliente_id, nome, validacao_id into v_cli1, v_txt, v_val
    from public.cash_balcao_ler_carteirinha(v_token);
  v_ok := v_cli1 is not null and v_txt = 'Ana do Clube';
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o balcao le a carteirinha e acha o membro (' || coalesce(v_txt,'nada') || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 7. 🔴 TOKEN SERVE UMA VEZ. Sem isto, quem guardasse o QR de um print leria a
  --    carteirinha daquela pessoa quantas vezes quisesse.
  begin
    perform * from public.cash_balcao_ler_carteirinha(v_token);
    v_ok := false;
  exception when others then
    get stacked diagnostics v_dica = pg_exception_hint;
    v_ok := coalesce(v_dica,'') like '%token_expirado%';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o mesmo token nao serve duas vezes' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 8. 🔴 QR DE OUTRA COISA É RECUSADO CEDO. A câmera lê qualquer QR do mundo.
  begin
    perform * from public.cash_balcao_ler_carteirinha('https://exemplo.com/qualquer');
    v_ok := false;
  exception when others then
    get stacked diagnostics v_dica = pg_exception_hint;
    v_ok := coalesce(v_dica,'') like '%qr_invalido%';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'QR que nao e carteirinha e recusado' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 9. 🔴 A LEITURA CAI NO PARCEIRO DE QUEM ESTÁ LENDO, nunca no do vizinho. O
  --    parceiro NÃO é parâmetro da fronteira: ele vem da loja de quem chamou. Se
  --    fosse parâmetro, qualquer lojista creditaria venda na conta de outro -- e
  --    é esse o caso com conflito, porque aqui existem dois parceiros ativos.
  perform set_config('request.jwt.claim.sub', u_mem1::text, true);
  v_token := clube.emitir_token_carteirinha();
  perform set_config('request.jwt.claim.sub', u_parc2::text, true);
  perform * from public.cash_balcao_ler_carteirinha(v_token);

  select count(*) into v_n  from clube.validacoes v where v.parceiro_id = p_clube2;
  select count(*) into v_n2 from clube.validacoes v where v.parceiro_id = p_clube1;
  v_ok := v_n = 1 and v_n2 = 1;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'a leitura do Parceiro Dois cai nele, e a do Um continua no Um ('
         || v_n || ' e ' || v_n2 || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 10. 🔴 LOJA DO CATÁLOGO NÃO TEM CARTEIRINHA, E A PORTA DIZ ISSO. Meia porta é
  --     pior que porta nenhuma: um botão de ler QR numa loja sem Clube abriria a
  --     câmera para não acontecer nada.
  perform set_config('request.jwt.claim.sub', u_cat::text, true);
  begin
    perform * from public.cash_balcao_ler_carteirinha('00000000000000000000000000000000');
    v_ok := false;
  exception when others then v_ok := sqlerrm like '%loja_sem_carteirinha%';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'loja sem parceiro do Clube avisa em vez de abrir a camera' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 11. O CASHBACK NO LUGAR DO DESCONTO, amarrado ao atendimento. 10% de 200 na
  --     loja (dobro) = 40, e o lançamento guarda de qual leitura ele veio.
  perform set_config('request.jwt.claim.sub', u_parc1::text, true);
  perform public.cash_balcao_dar_cashback(v_cli1, 200, true, false, null, v_val);
  -- (a conferência do elo com a validação é medida no fim, depois do `reset role`:
  --  vestindo o logado a gaveta recusa a tabela, de propósito)

  -- 12. 🔴 A CARTEIRA É DO MEMBRO DO CLUBE, e quem não é do Clube não tem
  --     carteira. Não existe campo onde digitar de quem é a conta -- quem está
  --     logado é quem é. Isto é a conta fantasma do BipeChat fechada por
  --     construção.
  perform set_config('request.jwt.claim.sub', u_mem1::text, true);
  v_ok := public.cash_entrar() = v_cli1;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o membro do Clube cai na conta que ele mesmo abriu' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  select acumulado, pode_descer, falta_para_liberar
    into v_num, v_ok, v_n2 from public.cash_minha_carteira();
  v_ok := v_num = 40 and v_ok and v_n2 = 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'com 40 juntados nao falta nada e a descida libera' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 🔴 E A TELA SABE DISSO ANTES DE DESENHAR O BOTÃO. Sem `e_do_clube`, a
  --    carteira devolvia `aderiu = false` tanto para quem é do Clube e não
  --    ativou quanto para quem não é do Clube -- e o botão "Ativar" apareceria
  --    para as duas, existindo só para falhar numa delas. Porta pintada na
  --    parede. Este é o caso com CONFLITO: os dois estados existem aqui.
  perform set_config('request.jwt.claim.sub', u_fora::text, true);
  select e_do_clube, aderiu into v_ok, v_ok2 from public.cash_minha_carteira();
  v_ok := v_ok is false and v_ok2 is false;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'quem nao e do Clube ve e_do_clube=false (e o botao nao aparece)' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  perform set_config('request.jwt.claim.sub', u_mem1::text, true);
  select e_do_clube, aderiu into v_ok, v_ok2 from public.cash_minha_carteira();
  v_ok := v_ok and v_ok2;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o membro que ativou ve e_do_clube=true e aderiu=true' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  perform set_config('request.jwt.claim.sub', u_fora::text, true);
  begin
    perform * from public.cash_aderir();
    v_ok := false;
  exception when others then v_ok := sqlerrm like '%precisa_ser_do_clube%';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'quem nao e do Clube nao consegue ativar o cashback' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 13. O cliente desce e paga. 🔴 E CONFIRMAR COBRANÇA DE OUTRO É GASTAR O SALDO
  --     DELE: este caso tem CONFLITO de propósito -- os dois membros existem e o
  --     segundo tem carteira, então trocar o dono daria outro resultado.
  -- 🔴 O PISO DA TRANSFERÊNCIA. Ter 40 juntados não deixa descer 10: quem desce
  --    de 10 em 10 nunca junta, e a regra dos 30 deixa de pressionar. A frase
  --    dele é "criar a VONTADE de juntar" -- o número existe para ela querer
  --    achar a próxima loja da rede, não para travar o resgate.
  perform set_config('request.jwt.claim.sub', u_mem1::text, true);
  begin
    perform public.cash_descer(10);
    v_ok := false;
  exception when others then v_ok := sqlerrm like '%abaixo_do_minimo%';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'com 40 juntados nao da para transferir 10 (minimo e 30)' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- E a tela DIZ o mínimo e o teto, em vez de a pessoa descobrir pelo erro.
  select minimo_para_transferir, pode_transferir_ate into v_num, v_num2
    from public.cash_minha_carteira();
  v_ok := v_num = 30 and v_num2 = 40;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'a carteira diz minimo 30 e teto 40 (' || coalesce(v_num,-1) || ' e ' || coalesce(v_num2,-1) || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- Acima do mínimo é livre: juntar não tem teto, então ela desce o que juntou.
  perform public.cash_descer(40);

  perform set_config('request.jwt.claim.sub', u_parc1::text, true);
  v_pag := public.cash_balcao_pedir_pagamento(v_cli1, 100, 40);

  -- O membro dois ATIVA a conta dele também: sem isso ele não tem carteira, o
  -- erro viria por outro motivo (`precisa_entrar`) e o caso mediria a coisa
  -- errada -- dois caminhos dando o mesmo vermelho por razões diferentes é o
  -- caminho feliz com outro nome.
  perform set_config('request.jwt.claim.sub', u_mem2::text, true);
  select cliente_id into v_cli2 from public.cash_aderir();

  -- 🔴 O CICLO MEDIDO COM CONFLITO. Os dois casos que eu tinha davam `falta = 0`
  -- (quem já juntou os 30) e `falta = 30` (quem não aderiu, que vem de um ramo
  -- com o valor fixo). Falsifiquei pondo `falta` em ZERO sempre e a trava ficou
  -- VERDE: nenhum dos dois distinguia o cálculo. Quem distingue é alguém que
  -- ADERIU e tem saldo abaixo do gatilho -- aqui, o membro dois, com conta aberta
  -- e zero juntado. Entrada em que os dois caminhos dão o mesmo resultado não
  -- mede caminho nenhum; é o caminho feliz com outro nome.
  select aderiu, falta_para_liberar into v_ok, v_num from public.cash_minha_carteira();
  v_ok := v_ok and v_num = 30;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'quem ADERIU e tem zero juntado ve faltar 30 (' || coalesce(v_num,-1) || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  begin
    perform public.cash_confirmar(v_pag);
    v_ok := false;
  exception when others then v_ok := sqlerrm like '%cobranca_nao_encontrada%';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'outro membro nao confirma a cobranca que nao e dele' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  perform set_config('request.jwt.claim.sub', u_mem1::text, true);
  perform public.cash_confirmar(v_pag);
  select disponivel into v_num from public.cash_minha_carteira();
  v_ok := v_num = 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o dono confirma e os 40 saem da carteira dele (' || v_num || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 🔴 A COBRANÇA CONFIRMADA SAI DAS DUAS LISTAS E CONTINUA NA TABELA. São três
  -- medidas, não uma: a tela do cliente, a tela do balcão, e a prova guardada.
  -- Medir só uma delas deixaria passar o caso em que a lista some porque a linha
  -- foi APAGADA -- que é exatamente o que esta mudança deixou de fazer.
  -- A terceira medida (a linha continua na tabela) NÃO cabe aqui: ler
  -- `cash.pagamentos_pendentes` vestindo `authenticated` dá "permission denied
  -- for schema cash", e isso é a gaveta FUNCIONANDO. Ela vai no fim, depois do
  -- `reset role`, guardada em `v_cobranca_guardada`.
  select count(*) into v_n from public.cash_minhas_cobrancas();
  perform set_config('request.jwt.claim.sub', u_parc1::text, true);
  select count(*) into v_n2 from public.cash_balcao_pendentes();
  v_cobranca_confirmada := v_pag;
  -- Volta a vestir o membro um: o caso seguinte (o extrato) conta com ele, e
  -- teste que deixa o papel trocado quebra o de baixo por um motivo que não é o
  -- dele -- vermelho em caso que ninguém mexeu.
  perform set_config('request.jwt.claim.sub', u_mem1::text, true);
  v_ok := v_n = 0 and v_n2 = 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'confirmada: sai da tela do cliente (' || v_n || ') e do balcao ('
         || v_n2 || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 14. O EXTRATO DIZ ONDE A PESSOA COMPROU, quanto e quando. O de um não é do
  --     outro, nem o de uma loja é da outra.
  select count(*) into v_n from public.cash_meu_extrato(200);
  perform set_config('request.jwt.claim.sub', u_mem2::text, true);
  select count(*) into v_n2 from public.cash_meu_extrato(200);
  v_ok := v_n > 0 and v_n2 = 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o extrato do membro dois esta vazio e o do um nao' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  perform set_config('request.jwt.claim.sub', u_parc2::text, true);
  select count(*) into v_n from public.cash_balcao_extrato(200)
   where descricao like '%Parceiro Um%';
  v_ok := v_n = 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o extrato do Parceiro Dois nao mostra lancamento do Um (' || v_n || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 15. 🔴 O LOJISTA PEDE O SAQUE, NÃO SACA. E pedir duas vezes o mesmo dinheiro
  --     não passa -- senão a plataforma paga duas vezes.
  perform set_config('request.jwt.claim.sub', u_parc1::text, true);
  v_ped := public.cash_balcao_pedir_saque(40);
  begin
    perform public.cash_balcao_pedir_saque(40);
    v_ok := false;
  exception when others then v_ok := sqlerrm like '%saldo_insuficiente%';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'pedir de novo o mesmo dinheiro ja pedido e recusado' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 16. NÃO EXISTE porta de saque nem de depósito direto. Estrutural: uma função
  --     a mais com esse nome reabriria o buraco, e trava que mede o EFEITO não
  --     enxerga função que ainda não existe.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('cash_balcao_sacar','cash_balcao_depositar','cash_sacar','cash_depositar');
  v_ok := v_n = 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'nao existe saque nem deposito direto na fronteira (' || v_n || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 17. O lojista não alcança nada de administrador -- nem o painel, nem crédito
  --     para si mesmo (que seria cash sem lastro).
  begin
    perform public.cash_admin_painel();
    v_ok := false;
  exception when others then v_ok := sqlerrm like '%so_admin%';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o lojista nao abre o painel de administrador' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  begin
    perform public.cash_admin_depositar(v_loja1, 999999);
    v_ok := false;
  exception when others then v_ok := sqlerrm like '%so_admin%';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o lojista nao deposita credito para si mesmo' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 18. E QUEM PAGA EXECUTA: o administrador paga o pedido, o livro anda e o
  --     pedido fica 'pago' na MESMA transação -- as duas, ou nenhuma.
  perform set_config('teste.e_admin', 'on', true);
  perform public.cash_admin_pagar_saque(v_ped);
  -- Olha pela FRONTEIRA, não pela tabela: vestindo `authenticated` a gaveta
  -- recusa `cash.saques_pedidos` com `permission denied for schema cash` -- que é
  -- a regra 4 funcionando.
  select s.situacao into v_txt from public.cash_admin_saques_pedidos() s where s.id = v_ped;
  v_ok := v_txt = 'pago';
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o administrador paga o pedido e ele fica pago (' || coalesce(v_txt,'?') || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  begin
    perform public.cash_admin_pagar_saque(v_ped);
    v_ok := false;
  exception when others then v_ok := sqlerrm like '%pedido_ja_resolvido%';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'pagar o mesmo pedido duas vezes e recusado' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 19. O MAPA DE ONDE GASTAR mostra as três lojas da rede -- é o que faz a
  --     pessoa saber que o saldo dela vale em algum lugar.
  select count(*) into v_n from public.cash_lojas_da_rede();
  v_ok := v_n = 3;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o mapa da rede mostra as 3 lojas ligadas (' || v_n || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 19b. A BUSCA, que e como ela acha onde gastar. Pedaco do nome e pedaco da
  --      cidade, sem diferenciar maiuscula.
  select count(*) into v_n from public.cash_lojas_da_rede('parceiro');
  select count(*) into v_n2 from public.cash_lojas_da_rede('LAGOA');
  v_ok := v_n = 2 and v_n2 = 1;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'a busca acha por nome (' || v_n || ') e por cidade (' || v_n2 || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 20. E DEPOIS DE TUDO, A CONTA FECHA. É a única medida que não se pode dar por
  --     boa por construção: vinte operações atravessando sete papéis.
  select fecha into v_ok from public.cash_admin_painel();
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'a invariante fecha depois de tudo, vista pelo painel' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  execute 'reset role';

  -- 21. A CÓPIA DO DADO DE REFERÊNCIA (regra 3): o nome e o telefone do membro
  --     ficam DENTRO da gaveta do cash, não lidos do Clube a cada tela. É isso que
  --     deixa `pg_dump --schema=cash` sair inteiro no dia de separar. Medido aqui,
  --     e não lá em cima, porque vestindo `authenticated` a gaveta recusa a tabela
  --     -- de propósito.
  -- 22. O CASHBACK FICA AMARRADO À LEITURA DA CARTEIRINHA. É por este elo que se
  --     responde depois "de onde veio este saldo" sem ler nada do Clube.
  select count(*) into v_n from cash.lancamentos where clube_validacao_id = v_val;
  v_ok := v_n = 1;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o cashback fica amarrado a leitura da carteirinha (' || v_n || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 🔴 A BUSCA IGNORA O ACENTO, nos DOIS lados. Ele dita por voz e o aplicativo
  -- transcreve "sao joao" tanto quanto "São João"; `ilike` sozinho resolve a
  -- maiúscula e não o acento, e quem digita "jose" conclui que a loja não está
  -- na rede. Mexo na cidade DEPOIS das contagens acima para não mover nenhuma.
  update cash.lojas set cidade = 'São João del Rei' where id = v_loja2;
  select count(*) into v_n  from public.cash_lojas_da_rede('sao joao');
  select count(*) into v_n2 from public.cash_lojas_da_rede('São JOÃO');
  v_ok := v_n = 1 and v_n2 = 1;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'a busca acha a cidade com acento digitando sem (' || v_n
         || ') e com (' || v_n2 || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- E o caso que FALSIFICA o de cima: se a busca fosse ignorada, tudo acharia
  -- tudo. Um pedaço que não existe em loja nenhuma tem que dar zero.
  select count(*) into v_n from public.cash_lojas_da_rede('zzqx');
  v_ok := v_n = 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'busca que nao casa com nada devolve zero (' || v_n || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 🔴 E A COBRANÇA CONFIRMADA CONTINUA NA TABELA, carimbada. Sem esta medida, o
  -- caso de cima passaria igual se a linha tivesse sido APAGADA -- que é
  -- exatamente o que esta mudança deixou de fazer. Lista vazia não prova nada
  -- sobre o motivo de estar vazia.
  select count(*) into v_n from cash.pagamentos_pendentes
   where id = v_cobranca_confirmada and confirmado_em is not null;
  v_ok := v_n = 1;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'a cobranca confirmada ficou guardada, com o carimbo (' || v_n || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  select telefone into v_txt from cash.clientes where id = v_cli1;
  v_ok := v_txt = '31988880000';
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o telefone veio copiado do Clube, so com numeros (' || coalesce(v_txt,'nulo') || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  r := r || E'\n' || case when v_falhas = 0 then 'tudo certo' else v_falhas || ' FALHOU' end;
  raise exception 'RESULTADO >>> %', r;
end $$;
