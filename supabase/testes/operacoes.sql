-- As regras do dinheiro, medidas no banco.
--
-- O motor do cash existe em DOIS lugares: `cash/src/nucleo/livro.ts` (29 testes,
-- rápido e barato) e as funções `cash.*` desta gaveta. Quem manda é o banco --
-- regra de dinheiro no navegador é sugestão --, então o banco precisa da prova
-- dele. Estes casos são os mesmos do motor de TypeScript, mais os três que só
-- existem aqui (lote vencido não gastável, trava de linha, apagar em vez de zerar).
--
-- Roda com: bash scripts/banco-de-mentira.sh --testes

do $$
declare
  r text := E'\n';
  v_falhas int := 0;
  v_ok boolean;

  v_loja uuid;
  v_loja2 uuid;
  v_cli uuid;
  v_cli2 uuid;
  v_lanc uuid;
  v_lanc2 uuid;
  v_pag uuid;
  v_saque jsonb;
  v_n int;
  v_num numeric;
  v_data date;
  v_erro text;
begin
  -- --- bancada ---------------------------------------------------------------
  insert into cash.lojas (nome, cashback_percentual) values ('Loja Teste', 10) returning id into v_loja;
  insert into cash.lojas (nome, cashback_percentual) values ('Outra Loja', 5)  returning id into v_loja2;
  v_cli  := cash.achar_ou_criar_cliente('31999990000', 'Cliente Um');
  v_cli2 := cash.achar_ou_criar_cliente('31999991111', 'Cliente Dois');

  -- 1. CASHBACK NÃO NASCE DO NADA. Sem crédito depositado, a loja não consegue
  --    dar cashback nenhum -- é isto que mata a fraude da loja de fachada.
  begin
    perform cash.dar_cashback(v_loja, v_cli, 100);
    v_ok := false;
  exception when others then
    v_ok := sqlerrm like '%saldo_insuficiente%';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'cashback sem credito e recusado' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 2. O depósito é a única porta de entrada, e ele mexe na custódia no mesmo
  --    lançamento: o cash existente passa a ser igual ao dinheiro parado.
  v_lanc := cash.depositar(v_loja, 1000);
  v_ok := cash.cash_existente() = 1000 and cash.custodia() = 1000
          and cash.saldo(cash.conta_credito(v_loja)) = 1000;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'deposito de 1000 vira 1000 de credito com lastro' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 3. O cashback MOVE, não cria: o que entra no cliente sai do crédito da loja,
  --    e o total do sistema não muda nem um centavo.
  perform cash.dar_cashback(v_loja, v_cli, 200);
  v_ok := cash.saldo(cash.conta_credito(v_loja)) = 980
          and cash.saldo(cash.conta_acumulo(v_cli)) = 20
          and cash.cash_existente() = 1000 and cash.custodia() = 1000;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'cashback de 10% em 200 move 20 do credito para o cliente' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 4. Compra NA LOJA rende o dobro da compra pela internet. É a regra que faz o
  --    programa trazer gente para a rua, que é o produto.
  perform cash.dar_cashback(v_loja, v_cli2, 200, true);
  v_ok := cash.saldo(cash.conta_acumulo(v_cli2)) = 40;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'a mesma compra presencial rende o dobro (40 contra 20)' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 5. IDEMPOTÊNCIA. O balcão tem sinal ruim e o vendedor toca duas vezes: a
  --    mesma chave devolve o mesmo lançamento e não dá cashback de novo.
  v_lanc  := cash.dar_cashback(v_loja, v_cli, 50, false, false, 'balcao-abc');
  v_lanc2 := cash.dar_cashback(v_loja, v_cli, 50, false, false, 'balcao-abc');
  v_ok := v_lanc = v_lanc2 and cash.saldo(cash.conta_acumulo(v_cli)) = 25;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'a mesma chave duas vezes vira um lancamento so' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 6. O GATILHO. Abaixo dele não dá para descer para gastar -- é o que faz a
  --    pessoa voltar para juntar em vez de resgatar trocado.
  begin
    perform cash.descer_para_gastar(v_cli, 10);
    v_ok := false;
  exception when others then
    v_ok := sqlerrm like '%gatilho_nao_alcancado%';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'com 25 juntados o gatilho de 30 recusa a descida' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 7. Alcançado o gatilho, ela desce QUANTO QUISER -- quem desce 30 e deixa o
  --    resto guardado não corre risco nenhum com o resto. E o que desceu passa a
  --    ter prazo: o relógio começa aqui.
  perform cash.dar_cashback(v_loja, v_cli, 100);  -- +10 => 35
  perform cash.descer_para_gastar(v_cli, 30);
  v_data := cash.vence_em_disponivel(v_cli);
  v_ok := cash.saldo(cash.conta_disponivel(v_cli)) = 30
          and cash.saldo(cash.conta_acumulo(v_cli)) = 5
          and v_data = current_date + 30;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'desceu 30, sobrou 5 guardado, e o prazo de 30 dias apareceu' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 8. ACEITAÇÃO INCONDICIONAL: não existe compra mínima nem teto por compra.
  --    Pagar uma compra INTEIRA com cash é permitido, de propósito.
  v_pag := cash.pedir_pagamento(v_loja, v_cli, 30, 30);
  perform cash.confirmar_pagamento(v_pag);
  v_ok := cash.saldo(cash.conta_disponivel(v_cli)) = 0
          and cash.saldo(cash.conta_recebido(v_loja)) = 30
          and cash.cash_existente() = 1000 and cash.custodia() = 1000;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'compra de 30 paga 100% em cash e o cash vai para a loja' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 9. O único limite é a própria compra: ninguém paga 60 numa compra de 50.
  perform cash.dar_cashback(v_loja, v_cli, 1000);  -- +100 no acumulo
  perform cash.descer_para_gastar(v_cli, 100);
  begin
    perform cash.pedir_pagamento(v_loja, v_cli, 50, 60);
    v_ok := false;
  exception when others then
    v_ok := sqlerrm like '%cash_passa_da_compra%';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'pagar 60 de cash numa compra de 50 e recusado' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 10. O RESTRITO DA LOJA SAI PRIMEIRO. O contrário deixaria o saldo restrito
  --     preso para sempre -- ele só vale ali, então gastar o livre antes condena
  --     o cliente a um crédito que nunca consegue usar.
  perform cash.dar_cashback(v_loja, v_cli, 300, false, true);  -- 30 restrito nesta loja
  v_pag := cash.pedir_pagamento(v_loja, v_cli, 100, 40);
  perform cash.confirmar_pagamento(v_pag);
  v_ok := cash.saldo(cash.conta_restrita(v_cli, v_loja)) = 0
          and cash.saldo(cash.conta_disponivel(v_cli)) = 90;  -- 100 - (40-30)
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o restrito da loja e consumido antes do livre' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 11. O restrito de OUTRA loja não serve aqui. Se servisse, "restrito" não
  --     queria dizer nada.
  perform cash.depositar(v_loja2, 500);
  perform cash.dar_cashback(v_loja2, v_cli, 400, false, true);  -- 20 restrito na loja 2
  v_num := cash.pode_usar_na_loja(v_cli, v_loja);
  v_ok := v_num = 90;  -- o livre, sem o restrito da outra loja
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o restrito da outra loja nao conta aqui (' || v_num || ' e nao 110)' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 12. A TAXA DO SAQUE NÃO É LUCRO ESCONDIDO: ela continua existindo como cash,
  --     no fundo de promoção. Só o líquido sai da custódia -- e a conta fecha.
  -- A loja recebeu 30 + 40 = 70 de clientes nos passos 8 e 10.
  v_saque := cash.sacar(v_loja, 60);
  v_ok := (v_saque->>'taxa')::numeric = 3
          and (v_saque->>'recebe_em_reais')::numeric = 57
          and cash.saldo(cash.conta_promocional()) = 3
          and cash.saldo(cash.conta_recebido(v_loja)) = 10
          and cash.cash_existente() = cash.custodia();
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'saque de 60: 57 em reais, 3 de taxa no fundo, conta fechada' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 13. Reciclar é DE GRAÇA: é o que mantém o cash girando na rede em vez de
  --     virar saque. Mesmo valor de um lado para o outro, sem taxa nenhuma.
  v_num := cash.saldo(cash.conta_credito(v_loja));
  perform cash.reciclar(v_loja, 10);
  v_ok := cash.saldo(cash.conta_credito(v_loja)) = v_num + 10;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'reciclar 10 devolve 10 ao credito, sem taxa' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 14. A loja não saca o que não recebeu de cliente. O crédito que ela
  --     depositou não é lucro dela -- é cashback a distribuir.
  begin
    perform cash.sacar(v_loja, 100000);
    v_ok := false;
  exception when others then
    v_ok := sqlerrm like '%saldo_insuficiente%';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'a loja nao saca mais do que recebeu de clientes' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 15. LOTE VENCIDO NÃO É GASTÁVEL, mesmo que a varredura ainda não tenha
  --     passado. Esta é a que só existe no banco: no navegador o relógio anda
  --     num botão e o vencimento acontece junto; aqui o dia passa sozinho.
  insert into cash.lotes (conta, valor, emissor, vence_em)
  values (cash.conta_disponivel(v_cli2), 999, v_loja::text, current_date - 1);
  v_ok := cash.saldo(cash.conta_disponivel(v_cli2)) = 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'lote vencido ontem nao entra no saldo gastavel' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 16. E a conferência CONTINUA somando ele, porque o lastro dele continua em
  --     custódia: o dinheiro não desapareceu, só não é de ninguém até ser
  --     arquivado. (Aqui ele está 999 acima, de propósito, porque a linha foi
  --     posta à mão sem depósito atrás -- é o que o passo seguinte limpa.)
  v_ok := cash.cash_existente() - cash.custodia() = 999;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'a conferencia soma o lote vencido (diferenca de 999)' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  delete from cash.lotes where conta = cash.conta_disponivel(v_cli2) and valor = 999;

  -- 17. A VARREDURA arquiva o que morreu no fundo de promoção -- decisão do
  --     dono: o que vence fica com a plataforma e volta como campanha. O lastro
  --     não se move, então a conta segue fechando.
  insert into cash.lotes (conta, valor, emissor, vence_em)
  values (cash.conta_acumulo(v_cli2), 7, v_loja::text, current_date - 1);
  insert into cash.movimentos_de_caixa (lancamento_id, valor_em_reais)
  values (cash.registrar(null, 'deposito', 'externo:banco', cash.conta_acumulo(v_cli2), 7, 'bancada'), 7);
  v_num := cash.saldo(cash.conta_promocional());
  v_n := cash.vencer_lotes();
  v_ok := v_n = 1 and cash.saldo(cash.conta_promocional()) = v_num + 7
          and cash.cash_existente() = cash.custodia();
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'a varredura move o vencido para o fundo e a conta fecha' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 18. Brinde da rede SAI DO FUNDO, não do nada. Acima do fundo é recusado --
  --     se a plataforma emitisse cash sem dinheiro atrás, o saque viraria
  --     promessa e o modelo inteiro cairia.
  begin
    perform cash.distribuir_promocao(v_cli, cash.saldo(cash.conta_promocional()) + 1);
    v_ok := false;
  exception when others then
    v_ok := sqlerrm like '%fundo_insuficiente%';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'brinde acima do fundo e recusado' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  perform cash.distribuir_promocao(v_cli, 5);
  v_ok := cash.cash_existente() = cash.custodia();
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'brinde dentro do fundo mantem a conta fechada' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 19. NENHUM LOTE DE ZERO OU NEGATIVO. Lote zerado é dinheiro invisível
  --     ocupando conta: ninguém soma, ninguém vê, e ele volta a aparecer no dia
  --     em que alguém mudar a consulta.
  select count(*) into v_n from cash.lotes where valor <= 0;
  v_ok := v_n = 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'nenhum lote com valor zero ou negativo (achados: ' || v_n || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 20. A SOMA DAS PARTES É O TODO. Depois de dezenove operações, a soma de
  --     todas as contas tem que ser o cash existente -- nenhum centavo ficou
  --     numa conta que ninguém lê.
  select coalesce(sum(valor), 0) into v_num from cash.lotes;
  v_ok := v_num = cash.cash_existente() and cash.cash_existente() = cash.custodia();
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'a invariante fecha no fim de tudo (' || cash.cash_existente()
         || ' de cash para ' || cash.custodia() || ' em custodia)' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 21. A TRAVA DA INVARIANTE TRAVA. Desequilibra de propósito e exige que a
  --     próxima operação aborte -- trava que não trava é pior que trava nenhuma.
  insert into cash.lotes (conta, valor, emissor) values ('teste:furo', 1, 'teste');
  begin
    perform cash.conferir_invariante();
    v_ok := false;
  exception when others then
    v_ok := sqlerrm like '%invariante_quebrada%';
  end;
  delete from cash.lotes where conta = 'teste:furo';
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'a trava da invariante aborta com 1 de cash sem lastro' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 22. Telefone é a chave do balcão: o mesmo número duas vezes é o MESMO
  --     cliente, e o nome que já existe não é sobrescrito pelo que o vendedor
  --     digitou com pressa.
  v_cli := cash.achar_ou_criar_cliente('31 99999-0000', 'Nome Errado');
  select nome into v_erro from cash.clientes where id = v_cli;
  v_ok := v_erro = 'Cliente Um';
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o mesmo telefone (com ou sem pontuacao) e o mesmo cliente' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 23. 🔴 A COBRANÇA CONFIRMADA FICA GUARDADA, CARIMBADA. Ela é o acordo entre
  --     as duas partes ("compra de 80, 20 em cash"); apagar o acordo no instante
  --     em que ele é cumprido deixa o livro sem a prova do que foi combinado
  --     ANTES de mover. O lançamento diz o que moveu; só a cobrança diz o que as
  --     duas partes acertaram.
  perform cash.dar_cashback(v_loja, v_cli, 500);
  perform cash.descer_para_gastar(v_cli, 50);
  v_pag := cash.pedir_pagamento(v_loja, v_cli, 80, 20);
  -- O saldo ANTES, para medir o efeito de cada toque em vez de copiar um número
  -- do código: o disponível aqui depende de vinte operações acima.
  v_num := cash.saldo(cash.conta_disponivel(v_cli));
  perform cash.confirmar_pagamento(v_pag, 'chave-da-23');
  select count(*) into v_n from cash.pagamentos_pendentes
   where id = v_pag and confirmado_em is not null;
  v_ok := v_n = 1 and cash.saldo(cash.conta_disponivel(v_cli)) = v_num - 20;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o primeiro toque debitou 20 e a cobranca ficou na tabela, carimbada' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 24. E CONFIRMAR A MESMA COBRANÇA DE NOVO É RECUSADO -- com uma chave de
  --     idempotência DIFERENTE, de propósito. Com a mesma chave o `ja_feito`
  --     devolveria o lançamento antigo e o caso passaria sem medir nada: seria
  --     teste verde provando a trava errada. É o caso COM CONFLITO.
  begin
    perform cash.confirmar_pagamento(v_pag, 'outra-chave-24');
    v_ok := false;
  exception when others then
    v_ok := sqlerrm like '%cobranca_nao_encontrada%';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'confirmar de novo (com OUTRA chave) e recusado: nao debita duas vezes' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 25. E O SALDO PROVA QUE O SEGUNDO TOQUE NÃO MOVEU DINHEIRO. Só o passo 24
  --     não bastava: a recusa poderia vir DEPOIS de debitar. O que fecha é o
  --     saldo continuar exatamente onde o passo 23 o deixou (-20, não -40).
  v_ok := cash.saldo(cash.conta_disponivel(v_cli)) = v_num - 20;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o segundo toque no confirmar nao tirou nada (debitou 20 no total)' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  r := r || E'\n' || case when v_falhas = 0 then 'tudo certo' else v_falhas || ' FALHOU' end;
  raise exception 'RESULTADO >>> %', r;
end $$;
