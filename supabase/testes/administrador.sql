-- O ADMINISTRADOR vincula o lojista pelo nome, do Catálogo ou do QR Único (0020), e o troco vence sozinho (0021).
--
-- Mede VESTINDO os papéis, como o `fronteira.sql`: quem não é administrador toma `so_admin` em tudo, e o balcão da
-- loja do QR Único só abre para a conta com o MESMO e-mail CONFIRMADO. O caso que interessa é o do conflito: uma
-- conta com o e-mail do lojista, mas NÃO confirmado, não pode operar o balcão (é ela que daria troco com o dinheiro
-- que o lojista depositou).
--
-- Roda com: bash scripts/banco-de-mentira.sh --testes

do $$
declare
  r text := E'\n';
  v_falhas int := 0;
  v_ok boolean;
  v_n int;
  v_txt text;
  v_txt2 text;
  v_num numeric;
  v_loja_qr uuid;
  v_loja_qr2 uuid;
  v_loja_cat uuid;
  v_uid uuid;

  u_dono_cat uuid := 'a1111111-1111-1111-1111-111111111111';
  u_qr       uuid := 'a2222222-2222-2222-2222-222222222222';  -- a conta do Supabase do dono da ótica (confirmada)
  u_falso    uuid := 'a3333333-3333-3333-3333-333333333333';  -- outra conta com o mesmo e-mail, NÃO confirmada
  u_qualquer uuid := 'a4444444-4444-4444-4444-444444444444';

  cat_acai uuid;
  qr_otica uuid;
  qr_otica_removida uuid;
begin
  -- --- bancada, como superusuário ---------------------------------------------
  insert into public.lojas (owner_id, nome, slug, endereco_cidade, endereco_uf, clube_desconto_percentual)
  values (u_dono_cat, 'Açaí da Praça', 'acaidapraca', 'Lagoa Santa', 'MG', 10) returning id into cat_acai;
  insert into public.lojas (owner_id, nome, slug, excluida_em) values (u_qualquer, 'Açaí Velho', 'acaivelho', now());
  insert into public.lojas (owner_id, nome, slug, loja_teste) values (u_qualquer, 'Açaí Teste', 'acaiteste', true);

  insert into qrunico.users (name, nickname, email, is_company) values ('Ótica Visão', 'oticavisao', 'Dono@Otica.com', true)
    returning id into qr_otica;
  -- Com o espaço no fim, como a produção guarda (medido em 19/11): o vínculo tem que copiar SEM ele.
  insert into qrunico.qr_card (user_id, city, uf) values (qr_otica, 'Belo Horizonte ', 'mg ');
  insert into qrunico.users (name, nickname, email, is_company, is_removed)
    values ('Ótica Antiga', 'oticaantiga', 'antiga@otica.com', true, true) returning id into qr_otica_removida;
  insert into qrunico.users (name, nickname, email, is_company) values ('Ótica Pessoa Física', 'pf', 'pf@otica.com', false);

  insert into auth.users (id, email, email_confirmed_at) values (u_qr, 'dono@otica.com', now());
  insert into auth.users (id, email, email_confirmed_at) values (u_falso, 'DONO@otica.com', null);

  -- 1. Quem não é administrador não alcança nada disto.
  perform set_config('teste.e_admin', 'off', true);
  begin perform public.cash_admin_buscar_lojistas('otica'); v_ok := false;
  exception when others then v_ok := sqlerrm like '%so_admin%'; end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'quem nao e admin nao busca lojista' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  begin perform public.cash_admin_vincular_qrunico(qr_otica, 10); v_ok := false;
  exception when others then v_ok := sqlerrm like '%so_admin%'; end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'quem nao e admin nao vincula lojista do QR Unico' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  begin perform public.cash_admin_lojas(); v_ok := false;
  exception when others then v_ok := sqlerrm like '%so_admin%'; end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'quem nao e admin nao ve o dinheiro das lojas' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 2. As portas, medidas (nunca lidas no arquivo): fechadas ao anon, abertas ao logado.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('cash_admin_buscar_lojistas', 'cash_admin_vincular_qrunico', 'cash_admin_lojas',
                       'cash_admin_ligar_loja_do_catalogo')
     and not has_function_privilege('anon', p.oid, 'execute')
     and has_function_privilege('authenticated', p.oid, 'execute');
  v_ok := v_n = 4;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'as 4 funcoes do administrador: fechadas ao anon, abertas ao logado (' || v_n || ' de 4)' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  perform set_config('teste.e_admin', 'on', true);

  -- 3. A busca acha no Catálogo sem acento, e deixa de fora loja apagada e loja de teste.
  select count(*) into v_n from public.cash_admin_buscar_lojistas('acai') b where b.origem = 'catalogo';
  select b.nome, b.cidade into v_txt, v_txt2 from public.cash_admin_buscar_lojistas('ACAI') b where b.origem = 'catalogo';
  v_ok := v_n = 1 and v_txt = 'Açaí da Praça' and v_txt2 = 'Lagoa Santa';
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'a busca "acai" acha so a loja viva do Catalogo, com a cidade (' || v_n || ', ' || coalesce(v_txt,'nada') || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  select b.desconto_do_clube into v_num from public.cash_admin_buscar_lojistas('acai') b where b.origem = 'catalogo';
  v_ok := v_num = 10;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'a busca traz o desconto do Clube da loja, para sugerir o percentual (' || coalesce(v_num::text,'nulo') || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 4. E acha no QR Único só a empresa ativa (nem a removida, nem a pessoa física), com a cidade do cartão.
  select count(*) into v_n from public.cash_admin_buscar_lojistas('otica') b where b.origem = 'qrunico';
  select b.cidade into v_txt from public.cash_admin_buscar_lojistas('otica') b where b.origem = 'qrunico';
  v_ok := v_n = 1 and v_txt = 'Belo Horizonte';
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'a busca "otica" acha so a empresa ativa do QR Unico, com a cidade (' || v_n || ', ' || coalesce(v_txt,'nada') || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 5. Duas letras não buscam.
  select count(*) into v_n from public.cash_admin_buscar_lojistas('ot');
  v_ok := v_n = 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'busca com menos de 3 letras volta vazia (' || v_n || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 6. Vincular a empresa do QR Único copia nome, cidade, UF e o e-mail EM MINÚSCULAS.
  v_loja_qr := public.cash_admin_vincular_qrunico(qr_otica, 10);
  select l.dono_email, l.cidade || '/' || l.uf into v_txt, v_txt2 from cash.lojas l where l.id = v_loja_qr;
  v_ok := v_txt = 'dono@otica.com' and v_txt2 = 'Belo Horizonte/MG';
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'vincular o QR Unico copia e-mail em minusculas e cidade/UF (' || coalesce(v_txt,'nulo') || ', ' || coalesce(v_txt2,'nulo') || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 7. Vincular de novo muda o percentual e NÃO duplica a loja.
  v_loja_qr2 := public.cash_admin_vincular_qrunico(qr_otica, 15);
  select count(*) into v_n from cash.lojas where qrunico_usuario_id = qr_otica;
  select cashback_percentual into v_num from cash.lojas where id = v_loja_qr;
  v_ok := v_loja_qr2 = v_loja_qr and v_n = 1 and v_num = 15;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'vincular de novo atualiza o percentual sem duplicar (' || v_n || ' loja, ' || v_num || '%)' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  select count(*) into v_n from public.cash_admin_buscar_lojistas('otica') b where b.vinculada and b.cashback_percentual = 15;
  v_ok := v_n = 1;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'a busca mostra que a otica ja esta vinculada, com 15%' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 8. A empresa removida do QR Único não se vincula.
  begin perform public.cash_admin_vincular_qrunico(qr_otica_removida, 10); v_ok := false;
  exception when others then v_ok := sqlerrm like '%empresa_do_qrunico_nao_encontrada%'; end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'empresa removida do QR Unico nao se vincula' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 9. A loja do Catálogo agora vem com cidade e UF (antes nascia fora do mapa).
  v_loja_cat := public.cash_admin_ligar_loja_do_catalogo(cat_acai, 10);
  select l.cidade || '/' || l.uf into v_txt from cash.lojas l where l.id = v_loja_cat;
  v_ok := v_txt = 'Lagoa Santa/MG';
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'a loja do Catalogo nasce com cidade e UF (' || coalesce(v_txt,'nulo') || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 10. O dinheiro de cada loja, e de onde ela veio.
  perform public.cash_admin_depositar(v_loja_qr, 300);
  select a.credito, a.origem into v_num, v_txt from public.cash_admin_lojas() a where a.loja_id = v_loja_qr;
  v_ok := v_num = 300 and v_txt = 'qrunico';
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'a lista das lojas mostra o credito depositado e a origem (' || coalesce(v_num::text,'nulo') || ', ' || coalesce(v_txt,'nulo') || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;
  perform set_config('teste.e_admin', 'off', true);

  -- 11. 🔴 O BALCÃO DA LOJA DO QR ÚNICO. Vestindo o logado de verdade.
  execute 'set local role authenticated';

  perform set_config('request.jwt.claim.sub', u_qr::text, true);
  select m.loja_id into v_uid from public.cash_minha_loja() m;
  v_ok := v_uid = v_loja_qr;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'o dono da otica (mesmo e-mail, confirmado) abre o balcao da loja dele' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  perform set_config('request.jwt.claim.sub', u_falso::text, true);
  select count(*) into v_n from public.cash_minha_loja();
  v_ok := v_n = 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'conta com o mesmo e-mail NAO confirmado nao abre o balcao (' || v_n || ' loja)' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  perform set_config('request.jwt.claim.sub', u_qualquer::text, true);
  select count(*) into v_n from public.cash_minha_loja();
  v_ok := v_n = 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'um logado qualquer nao abre balcao nenhum (' || v_n || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- E o dono do Catálogo continua abrindo o dele (o caminho antigo não pode ter quebrado).
  perform set_config('request.jwt.claim.sub', u_dono_cat::text, true);
  select m.loja_id into v_uid from public.cash_minha_loja() m;
  v_ok := v_uid = v_loja_cat;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'o dono da loja do Catalogo continua abrindo o balcao dele' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;
  execute 'reset role';

  -- 12. O vencimento diário está agendado (0021).
  select count(*) into v_n from cron.job where jobname = 'troco-prime-vencer' and command like '%cash.vencer_lotes()%';
  v_ok := v_n >= 1;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'o vencimento do troco esta agendado todo dia (' || v_n || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  r := r || E'\n' || case when v_falhas = 0 then 'tudo certo' else v_falhas || ' FALHOU' end;
  raise exception 'RESULTADO >>> %', r;
end $$;
