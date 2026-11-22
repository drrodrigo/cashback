-- O CADASTRO DA LOJA (0028, 22/11/2026).
--
-- Ele: *"Ela vai fazer um cadastro com a gente (...) E aí a gente vai vincular (...) ou o Troco Prime ou a loja do
-- catálogo ou a loja do QR."*
--
-- O que este teste mede, e por quê:
--   1. o pedido recusa o que não serve (sem login, CPF/CNPJ com dígito errado, WhatsApp curto, regras passando de 100%),
--      e pedir de novo CORRIGE o pedido aberto, não abre outro;
--   2. só o administrador lista e aprova;
--   3. 🔴 administrador da casa que NÃO é do Clube não aprova, e NADA fica pela metade (nem loja, nem parceiro): o Clube
--      só deixa a administração dele cadastrar parceiro;
--   4. 🔴 A VOLTA QUE IMPORTA: aprovada, a loja vira parceira ATIVA do Clube com quem pediu como dono, o balcão dela abre,
--      e LÊ A CARTEIRINHA de um cliente (o furo de 19/11: loja vinculada não lia);
--   5. quem pediu sem perfil no Clube vira dono pelo e-mail;
--   6. parceiro do Clube com o mesmo nome e OUTRO dono: recusa, sem mexer no dono de ninguém;
--   7. o vínculo com o Catálogo Online;
--   8. recusar, com o motivo que a loja vê; e quem já é lojista não pede de novo.
-- Roda com: bash scripts/banco-de-mentira.sh --testes

do $$
declare
  r text := E'\n';
  v_falhas int := 0;
  v_ok boolean;
  v_txt text;
  v_n int;
  v_n2 int;
  v_ped uuid;
  v_ped2 uuid;
  v_loja uuid;
  v_token text;
  a record;
  cat uuid;
  u_admin   uuid := 'e1111111-1111-1111-1111-111111111111';  -- administrador da casa E do Clube
  u_so_casa uuid := 'e2222222-2222-2222-2222-222222222222';  -- administrador da casa, NÃO do Clube
  u_loja1   uuid := 'e3333333-3333-3333-3333-333333333333';  -- sócio do Clube que quer ser loja
  u_loja2   uuid := 'e4444444-4444-4444-4444-444444444444';  -- tem login, mas não tem perfil no Clube
  u_loja3   uuid := 'e5555555-5555-5555-5555-555555555555';  -- dono de loja no Catálogo
  u_loja4   uuid := 'e6666666-6666-6666-6666-666666666666';
  u_outro   uuid := 'e7777777-7777-7777-7777-777777777777';  -- dono de um parceiro que já existe no Clube
  u_cli     uuid := 'e8888888-8888-8888-8888-888888888888';  -- cliente do Clube com carteirinha
begin
  -- --- bancada ---------------------------------------------------------------------------------------------------
  insert into auth.users (id, email, email_confirmed_at) values
    (u_admin, 'admin@casa.com', now()), (u_so_casa, 'funcionario@casa.com', now()), (u_loja1, 'otica@nova.com', now()),
    (u_loja2, 'semperfil@loja.com', now()), (u_loja3, 'padaria@bairro.com', now()), (u_loja4, 'sorvete@loja.com', now()),
    (u_outro, 'outro@dono.com', now()), (u_cli, 'cliente@clube.com', now())
  on conflict (id) do nothing;
  insert into clube.perfis (id, nome, papel) values
    (u_admin, 'Admin', 'admin'), (u_so_casa, 'Funcionário', 'membro'), (u_loja1, 'Dono da Ótica', 'membro'),
    (u_loja3, 'Dono da Padaria', 'membro'), (u_loja4, 'Dono do Sorvete', 'membro'), (u_outro, 'Outro Dono', 'membro'),
    (u_cli, 'Cliente do Clube', 'membro');
  insert into clube.carteirinhas (membro_id, codigo_publico) values (u_cli, 'CLI0000001');
  insert into clube.parceiros (nome, slug, dono_id, ativo) values ('Sorveteria Gelada', 'sorveteria-gelada', u_outro, true);
  insert into public.lojas (owner_id, nome, slug) values (u_loja3, 'Padaria do Bairro', 'padariadobairro') returning id into cat;

  -- Este teste roda como dono do banco: ele CONFERE o resultado lendo as tabelas (a gaveta fechada recusaria o logado).
  -- Quem é quem vem do `auth.uid()` (o `request.jwt.claim.sub`), e as portas são medidas no passo 9.

  -- 1. As recusas do pedido, e pedir de novo corrige o aberto.
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.cash_pedir_para_ser_loja('Ótica Nova', '52998224725', '31988887777', 'Lagoa Santa', 'MG', 10, 5); v_ok := false;
  exception when others then v_ok := sqlerrm = 'precisa_entrar';
  end;
  perform set_config('request.jwt.claim.sub', u_loja1::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_loja1, 'email', 'otica@nova.com', 'role', 'authenticated')::text, true);
  begin
    perform public.cash_pedir_para_ser_loja('Ótica Nova', '52998224724', '31988887777', 'Lagoa Santa', 'MG', 10, 5); v_ok := false;
  exception when others then v_ok := v_ok and sqlerrm = 'documento_invalido';
  end;
  begin
    perform public.cash_pedir_para_ser_loja('Ótica Nova', '11111111111', '31988887777', 'Lagoa Santa', 'MG', 10, 5); v_ok := false;
  exception when others then v_ok := v_ok and sqlerrm = 'documento_invalido';
  end;
  begin
    perform public.cash_pedir_para_ser_loja('Ótica Nova', '52998224725', '8888', 'Lagoa Santa', 'MG', 10, 5); v_ok := false;
  exception when others then v_ok := v_ok and sqlerrm = 'whatsapp_invalido';
  end;
  begin
    perform public.cash_pedir_para_ser_loja('Ótica Nova', '52998224725', '31988887777', 'Lagoa Santa', 'MG', 60, 50); v_ok := false;
  exception when others then v_ok := v_ok and sqlerrm = 'regras_passam_de_100';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'o pedido recusa sem login, CPF errado, CPF repetido, WhatsApp curto e regras acima de 100%' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  v_ped := public.cash_pedir_para_ser_loja('Otica Nova', '529.982.247-25', '(31) 98888-7777', 'Lagoa Santa', 'mg', 10, 0);
  v_ped2 := public.cash_pedir_para_ser_loja('Ótica Nova', '52998224725', '31988887777', 'Lagoa Santa', 'MG', 10, 5);
  select count(*) into v_n from cash.pedidos_de_loja where pedido_por = u_loja1;
  select situacao into v_txt from public.cash_meu_pedido_de_loja();
  v_ok := v_ped = v_ped2 and v_n = 1 and v_txt = 'pedido';
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'pedir de novo corrige o pedido aberto (1 pedido, situacao ' || coalesce(v_txt,'?') || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 2. Só o administrador.
  begin
    perform * from public.cash_admin_pedidos_de_loja(); v_ok := false;
  exception when others then v_ok := sqlerrm = 'so_admin';
  end;
  begin
    perform public.cash_admin_aprovar_loja(v_ped, 'troco'); v_ok := false;
  exception when others then v_ok := v_ok and sqlerrm = 'so_admin';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'quem nao e administrador nao lista nem aprova' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 3. 🔴 Administrador da casa que não é do Clube: não aprova, e nada fica pela metade.
  perform set_config('request.jwt.claim.sub', u_so_casa::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_so_casa, 'role', 'authenticated')::text, true);
  perform set_config('teste.e_admin', 'on', true);
  begin
    perform public.cash_admin_aprovar_loja(v_ped, 'troco'); v_txt := 'aprovou';
  exception when others then
    get stacked diagnostics v_txt = pg_exception_hint;
  end;
  select count(*) into v_n from cash.lojas where nome = 'Ótica Nova';
  select count(*) into v_n2 from clube.parceiros where nome = 'Ótica Nova';
  v_ok := v_txt = 'nao_e_admin' and v_n = 0 and v_n2 = 0
          and (select situacao from cash.pedidos_de_loja where id = v_ped) = 'pedido';
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'administrador que nao e do Clube nao aprova, e nada fica pela metade (' || coalesce(v_txt,'?') || ', lojas ' || v_n || ', parceiros ' || v_n2 || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 4. 🔴 A volta que importa: aprova só no Troco Prime; vira parceira ativa do Clube; o balcão abre E LÊ A CARTEIRINHA.
  perform set_config('request.jwt.claim.sub', u_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.cash_admin_pedidos_de_loja() where situacao = 'pedido';
  v_loja := public.cash_admin_aprovar_loja(v_ped, 'troco');
  select cp.ativo and cp.dono_id = u_loja1 and l.desconto_no_caixa = 5 and l.cashback_percentual = 10
    into v_ok
    from cash.lojas l join clube.parceiros cp on cp.id = l.clube_parceiro_id where l.id = v_loja;
  select titulo into v_txt from clube.beneficios b join cash.lojas l on l.clube_parceiro_id = b.parceiro_id where l.id = v_loja;
  v_ok := coalesce(v_ok, false) and v_n = 1 and v_txt = '5% de desconto + 10% de troco';
  perform set_config('teste.e_admin', 'off', true);
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'aprovada: parceira ATIVA do Clube, dono quem pediu, beneficio "' || coalesce(v_txt,'?') || '"' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  perform set_config('request.jwt.claim.sub', u_cli::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_cli, 'role', 'authenticated')::text, true);
  perform public.cash_aderir();
  v_token := clube.emitir_token_carteirinha();
  perform set_config('request.jwt.claim.sub', u_loja1::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_loja1, 'role', 'authenticated')::text, true);
  select nome into v_txt from public.cash_minha_loja();
  v_ok := v_txt = 'Ótica Nova';
  select nome into v_txt from public.cash_balcao_ler_carteirinha(v_token);
  v_ok := v_ok and v_txt = 'Cliente do Clube';
  select situacao into v_txt from public.cash_meu_pedido_de_loja();
  v_ok := v_ok and v_txt = 'aprovado';
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'o balcao da loja aprovada abre e LE A CARTEIRINHA do cliente' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 5. Sem perfil no Clube: dono pelo e-mail.
  perform set_config('request.jwt.claim.sub', u_loja2::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_loja2, 'email', 'semperfil@loja.com', 'role', 'authenticated')::text, true);
  v_ped := public.cash_pedir_para_ser_loja('Loja Sem Perfil', '11.222.333/0001-81', '31977776666', 'Belo Horizonte', 'MG', 12, 0);
  perform set_config('request.jwt.claim.sub', u_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  perform set_config('teste.e_admin', 'on', true);
  v_loja := public.cash_admin_aprovar_loja(v_ped, 'troco');
  perform set_config('teste.e_admin', 'off', true);
  select cp.dono_id = u_loja2 and cp.ativo into v_ok from cash.lojas l join clube.parceiros cp on cp.id = l.clube_parceiro_id where l.id = v_loja;
  perform set_config('request.jwt.claim.sub', u_loja2::text, true);
  select nome into v_txt from public.cash_minha_loja();
  v_ok := coalesce(v_ok, false) and v_txt = 'Loja Sem Perfil';
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'quem nao tem perfil no Clube vira dono pelo e-mail, e o balcao abre' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 6. Parceiro do Clube com o mesmo nome e outro dono: recusa, e o dono continua o dele.
  perform set_config('request.jwt.claim.sub', u_loja4::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_loja4, 'email', 'sorvete@loja.com', 'role', 'authenticated')::text, true);
  v_ped := public.cash_pedir_para_ser_loja('Sorveteria Gelada', '52998224725', '31966665555', 'Lagoa Santa', 'MG', 10, 0);
  perform set_config('request.jwt.claim.sub', u_admin::text, true);
  perform set_config('teste.e_admin', 'on', true);
  begin
    perform public.cash_admin_aprovar_loja(v_ped, 'troco'); v_txt := 'aprovou';
  exception when others then v_txt := sqlerrm;
  end;
  perform set_config('teste.e_admin', 'off', true);
  select count(*) into v_n from cash.lojas where nome = 'Sorveteria Gelada';
  v_ok := v_txt = 'loja_do_clube_tem_outro_dono' and v_n = 0
          and (select dono_id from clube.parceiros where slug = 'sorveteria-gelada') = u_outro;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'parceiro do Clube com outro dono: recusa e nao mexe no dono (' || v_txt || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 7. O vínculo com o Catálogo Online.
  perform set_config('request.jwt.claim.sub', u_loja3::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_loja3, 'email', 'padaria@bairro.com', 'role', 'authenticated')::text, true);
  v_ped := public.cash_pedir_para_ser_loja('Padaria do Bairro', '52998224725', '31955554444', 'Lagoa Santa', 'MG', 8, 0);
  perform set_config('request.jwt.claim.sub', u_admin::text, true);
  perform set_config('teste.e_admin', 'on', true);
  v_loja := public.cash_admin_aprovar_loja(v_ped, 'catalogo', cat);
  perform set_config('teste.e_admin', 'off', true);
  select l.catalogo_loja_id = cat and l.cashback_percentual = 8 and cp.dono_id = u_loja3 into v_ok
    from cash.lojas l join clube.parceiros cp on cp.id = l.clube_parceiro_id where l.id = v_loja;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'aprovada ligada a loja do Catalogo, com 8% e parceira do Clube' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 8. Recusar, com motivo; e quem já é lojista não pede de novo.
  perform set_config('request.jwt.claim.sub', u_outro::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_outro, 'role', 'authenticated')::text, true);
  v_ped := public.cash_pedir_para_ser_loja('Loja Que Nao Vai', '52998224725', '31944443333', 'Contagem', 'MG', 10, 0);
  perform set_config('request.jwt.claim.sub', u_admin::text, true);
  perform set_config('teste.e_admin', 'on', true);
  perform public.cash_admin_recusar_loja(v_ped, 'Faltou o comprovante');
  begin
    perform public.cash_admin_recusar_loja(v_ped, 'de novo'); v_ok := false;
  exception when others then v_ok := sqlerrm = 'pedido_de_loja_nao_encontrado';
  end;
  perform set_config('teste.e_admin', 'off', true);
  perform set_config('request.jwt.claim.sub', u_outro::text, true);
  select * into a from public.cash_meu_pedido_de_loja();
  v_ok := v_ok and a.situacao = 'recusado' and a.motivo = 'Faltou o comprovante';
  perform set_config('request.jwt.claim.sub', u_loja1::text, true);
  begin
    perform public.cash_pedir_para_ser_loja('Outra', '52998224725', '31988887777', 'Lagoa Santa', 'MG', 10, 0); v_ok := false;
  exception when others then v_ok := v_ok and sqlerrm = 'ja_e_lojista';
  end;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'recusa com o motivo que a loja ve; quem ja e lojista nao pede de novo' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 9. As portas.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('cash_pedir_para_ser_loja', 'cash_meu_pedido_de_loja', 'cash_admin_pedidos_de_loja',
                       'cash_admin_aprovar_loja', 'cash_admin_recusar_loja')
     and not has_function_privilege('anon', p.oid, 'execute');
  v_ok := v_n = 5 and not has_function_privilege('authenticated', 'cash.garantir_parceiro_do_clube(uuid, uuid, text, text)', 'execute');
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end || 'as 5 do cadastro fechadas ao anon; a que cria o parceiro, fechada ao logado' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  r := r || E'\n' || case when v_falhas = 0 then 'tudo certo' else v_falhas || ' FALHOU' end;
  raise exception 'RESULTADO >>> %', r;
end $$;
