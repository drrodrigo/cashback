-- ---------------------------------------------------------------------------
-- Cash -- A FRONTEIRA. A camada curta de funções em `public`.
--
-- A gaveta `cash` é fechada: nem `anon` nem `authenticated` têm `usage` nela.
-- Então NADA de tela toca tabela do cash. Quem serve a tela é esta lista curta,
-- e ela é a fronteira de verdade: no dia de separar o produto, é ela que vira
-- chamada de API, e nenhuma tela precisa saber.
--
-- 🔴 A DECISÃO DE SEGURANÇA QUE ESTE ARQUIVO TOMA, e ela é a mais importante:
--
--     QUEM ENTRA COMO CLIENTE ENTRA PELO TELEFONE, e o telefone vem do LOGIN,
--     nunca de um campo digitado.
--
-- A tentação é `cash_entrar(telefone)`: a pessoa digita o número e pronto.
-- Isso é a CONTA FANTASMA do BipeChat outra vez, com outro nome -- lá a
-- migration 0001 deixava quem tivesse a chave digitar um telefone qualquer e
-- criar a conta daquela pessoa. Aqui seria pior, porque do outro lado do número
-- tem saldo: qualquer um logado reivindicaria a carteira de qualquer um.
--
-- Então `public.cash_entrar()` não recebe telefone nenhum. Ela LÊ o telefone de
-- dentro do próprio login (`auth.jwt() ->> 'phone'`), que só existe se a pessoa
-- provou o número recebendo um código. Quem entrou por e-mail não vira cliente
-- do cash -- recebe `precisa_entrar_por_telefone` e a tela explica.
--
-- Consequência prática, e é decisão do dono: o login do cliente no cash é por
-- TELEFONE COM CÓDIGO (SMS). Isso tem custo por mensagem. A alternativa segura
-- não existe: vincular carteira a número digitado é entregar saldo de terceiro.
--
-- O LOJISTA, ao contrário, não precisa de login novo: ele já tem o do Catálogo.
-- `cash.lojas.catalogo_loja_id` aponta para a loja dele (coluna uuid solta, sem
-- `references`, pela regra 2 da gaveta), e a fronteira resolve
-- `auth.uid()` -> `public.lojas.owner_id` -> `cash.lojas` NA HORA, a cada
-- chamada. Guardar o dono copiado aqui seria mais "separado" e estaria ERRADO:
-- loja que troca de dono no Catálogo deixaria o dono antigo operando o balcão.
-- Esta é a única leitura que o cash faz no vizinho, e é no lugar certo -- dentro
-- da fronteira, que é justamente o que vira API no dia de separar.
-- ---------------------------------------------------------------------------

-- --- o que faltava de tabela ---------------------------------------------------

-- O elo com o login. `uuid` solto, sem `references auth.users`: a regra 2 vale
-- para `auth` como vale para `public` -- rebite atravessando schema é o que torna
-- `pg_dump --schema=cash` impossível.
alter table cash.clientes add column if not exists auth_user_id uuid;
create unique index if not exists clientes_auth_idx on cash.clientes (auth_user_id)
  where auth_user_id is not null;

-- Uma loja do Catálogo não pode virar duas lojas no cash: seria crédito em dois
-- lugares e balcão escolhendo qual.
create unique index if not exists lojas_catalogo_unico_idx on cash.lojas (catalogo_loja_id)
  where catalogo_loja_id is not null;

-- O PEDIDO de saque, e por que ele existe em vez de o lojista sacar sozinho.
--
-- `cash.sacar` tira dinheiro da custódia -- quer dizer que ele REGISTRA que o
-- dinheiro saiu. Mas quem manda o Pix é gente. Se o lojista disparasse o saque
-- pela tela, o livro diria "saiu 950" num instante em que ninguém transferiu
-- nada: o livro passaria a mentir sobre dinheiro de verdade, que é o único erro
-- deste produto que não tem conserto barato.
--
-- Então o lojista PEDE, e quem executa é quem paga. É meia porta ao contrário:
-- em vez de um botão que promete, um pedido que alguém cumpre.
create table if not exists cash.saques_pedidos (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid not null references cash.lojas(id) on delete cascade,
  valor numeric(12,2) not null check (valor > 0),
  situacao text not null default 'pedido' check (situacao in ('pedido', 'pago', 'recusado')),
  pedido_em timestamptz not null default clock_timestamp(),
  resolvido_em timestamptz,
  lancamento_id uuid references cash.lancamentos(id),
  observacao text not null default ''
);

create index if not exists saques_situacao_idx on cash.saques_pedidos (situacao, pedido_em);

alter table cash.saques_pedidos enable row level security;
grant all privileges on cash.saques_pedidos to service_role;

-- --- quem é quem (dentro da gaveta, inalcançável pela tela) ---------------------

-- A loja do usuário logado. Devolve nulo quando ele não é lojista de loja no
-- cash -- e a fronteira trata o nulo, nunca devolve dado de outra loja.
create or replace function cash.loja_do_usuario() returns uuid
language sql stable as $$
  select cl.id
    from cash.lojas cl
    join public.lojas pl on pl.id = cl.catalogo_loja_id
   where pl.owner_id = auth.uid()
     and cl.ativa
   limit 1;
$$;

create or replace function cash.cliente_do_usuario() returns uuid
language sql stable as $$
  select id from cash.clientes where auth_user_id = auth.uid();
$$;

-- --- a fronteira do LOJISTA (o balcão) -----------------------------------------

create or replace function public.cash_minha_loja()
returns table(loja_id uuid, nome text, cashback_percentual numeric,
              credito numeric, recebido numeric, saque_pedido numeric)
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare v_loja uuid := cash.loja_do_usuario();
begin
  if v_loja is null then return; end if;
  return query
    select l.id, l.nome, l.cashback_percentual,
           cash.saldo(cash.conta_credito(l.id)),
           cash.saldo(cash.conta_recebido(l.id)),
           coalesce((select sum(s.valor) from cash.saques_pedidos s
                      where s.loja_id = l.id and s.situacao = 'pedido'), 0)
      from cash.lojas l where l.id = v_loja;
end $$;

-- O balcão acha o cliente pelo telefone que ele acabou de dizer, e cria se não
-- existir. Cadastro que obriga o cliente a parar e preencher formulário no caixa
-- não acontece -- é o "dita seu CPF" do supermercado.
--
-- O QUE ELA DEVOLVE É DE PROPÓSITO CURTO: o nome e quanto dá para usar AQUI.
-- Não devolve extrato, não devolve saldo de outra loja, não devolve onde a
-- pessoa comprou. A Loja A vê os resgates DELA; o que o cliente gastou na Loja B
-- não é dela nunca.
create or replace function public.cash_balcao_cliente(p_telefone text, p_nome text default '')
returns table(cliente_id uuid, nome text, pode_usar_aqui numeric, acumulado numeric)
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare
  v_loja uuid := cash.loja_do_usuario();
  v_cli uuid;
begin
  if v_loja is null then raise exception 'nao_e_lojista'; end if;
  v_cli := cash.achar_ou_criar_cliente(p_telefone, p_nome);
  return query
    select c.id, c.nome,
           cash.pode_usar_na_loja(c.id, v_loja),
           cash.saldo(cash.conta_acumulo(c.id))
      from cash.clientes c where c.id = v_cli;
end $$;

create or replace function public.cash_balcao_dar_cashback(
  p_cliente uuid, p_valor_compra numeric,
  p_presencial boolean default true, p_restrito boolean default false,
  p_chave text default null
) returns uuid
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare v_loja uuid := cash.loja_do_usuario();
begin
  if v_loja is null then raise exception 'nao_e_lojista'; end if;
  return cash.dar_cashback(v_loja, p_cliente, p_valor_compra, p_presencial, p_restrito, p_chave);
end $$;

create or replace function public.cash_balcao_pedir_pagamento(
  p_cliente uuid, p_valor_compra numeric, p_valor_em_cash numeric
) returns uuid
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare v_loja uuid := cash.loja_do_usuario();
begin
  if v_loja is null then raise exception 'nao_e_lojista'; end if;
  return cash.pedir_pagamento(v_loja, p_cliente, p_valor_compra, p_valor_em_cash);
end $$;

-- As cobranças desta loja esperando o cliente confirmar. Sem isto o balcão fica
-- cego entre o "pedi" e o "confirmou", e vendedor cego toca o botão de novo.
create or replace function public.cash_balcao_pendentes()
returns table(id uuid, cliente_nome text, cliente_telefone text,
              valor_compra numeric, valor_em_cash numeric, criado_em timestamptz)
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare v_loja uuid := cash.loja_do_usuario();
begin
  if v_loja is null then return; end if;
  return query
    select p.id, c.nome, c.telefone, p.valor_compra, p.valor_em_cash, p.criado_em
      from cash.pagamentos_pendentes p
      join cash.clientes c on c.id = p.cliente_id
     where p.loja_id = v_loja
     order by p.criado_em desc;
end $$;

create or replace function public.cash_balcao_extrato(p_limite int default 50)
returns table(em timestamptz, tipo text, valor numeric, valor_compra numeric, descricao text)
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare v_loja uuid := cash.loja_do_usuario();
begin
  if v_loja is null then return; end if;
  return query
    select l.em, l.tipo::text, l.valor, l.valor_compra, l.descricao
      from cash.lancamentos l
     where l.conta_origem in (cash.conta_credito(v_loja), cash.conta_recebido(v_loja))
        or l.conta_destino in (cash.conta_credito(v_loja), cash.conta_recebido(v_loja))
     order by l.em desc
     limit greatest(1, least(p_limite, 200));
end $$;

create or replace function public.cash_balcao_reciclar(p_valor numeric, p_chave text default null)
returns uuid
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare v_loja uuid := cash.loja_do_usuario();
begin
  if v_loja is null then raise exception 'nao_e_lojista'; end if;
  return cash.reciclar(v_loja, p_valor, p_chave);
end $$;

-- PEDIR o saque, não sacar. Ver o comentário da tabela acima.
create or replace function public.cash_balcao_pedir_saque(p_valor numeric)
returns uuid
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare
  v_loja uuid := cash.loja_do_usuario();
  v_recebido numeric;
  v_pedido numeric;
  v_id uuid;
begin
  if v_loja is null then raise exception 'nao_e_lojista'; end if;
  if p_valor is null or p_valor <= 0 then raise exception 'valor_invalido'; end if;

  v_recebido := cash.saldo(cash.conta_recebido(v_loja));
  -- Conta o que já está pedido e não pago: senão a loja pede o mesmo dinheiro
  -- três vezes e a plataforma paga três vezes.
  select coalesce(sum(s.valor), 0) into v_pedido
    from cash.saques_pedidos s where s.loja_id = v_loja and s.situacao = 'pedido';

  if v_recebido - v_pedido + 0.005 < p_valor then
    raise exception 'saldo_insuficiente'
      using hint = format('A loja tem %s de clientes e %s já pedido.', v_recebido, v_pedido);
  end if;

  insert into cash.saques_pedidos (loja_id, valor) values (v_loja, round(p_valor, 2))
  returning id into v_id;
  return v_id;
end $$;

-- --- a fronteira do CLIENTE (a carteira) ---------------------------------------

-- Liga o login à carteira. NÃO recebe telefone: lê o do próprio login. Ver o
-- bloco vermelho do cabeçalho.
create or replace function public.cash_entrar()
returns uuid
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare
  v_tel text := regexp_replace(coalesce(auth.jwt() ->> 'phone', ''), '[^0-9]', '', 'g');
  v_uid uuid := auth.uid();
  v_cli uuid;
begin
  if v_uid is null then raise exception 'precisa_entrar'; end if;
  if length(v_tel) < 10 then
    raise exception 'precisa_entrar_por_telefone'
      using hint = 'A carteira é ligada ao número que recebeu o código. Entre pelo telefone.';
  end if;

  -- O telefone do Brasil chega no login com o 55 na frente; o cadastro do balcão
  -- é digitado sem. Sem tirar o 55 aqui, a MESMA pessoa viraria dois clientes --
  -- um com saldo, outro vazio, e ela veria a carteira vazia sem entender.
  if length(v_tel) > 11 and left(v_tel, 2) = '55' then v_tel := substr(v_tel, 3); end if;

  select id into v_cli from cash.clientes where telefone = v_tel;
  if v_cli is null then
    v_cli := cash.achar_ou_criar_cliente(v_tel, '');
  end if;

  update cash.clientes set auth_user_id = v_uid
   where id = v_cli and (auth_user_id is null or auth_user_id = v_uid);

  if not exists (select 1 from cash.clientes where id = v_cli and auth_user_id = v_uid) then
    -- Já tem outro login amarrado neste número. Não rouba: recusa e deixa para
    -- gente resolver -- é dinheiro de alguém do outro lado.
    raise exception 'telefone_de_outra_conta';
  end if;

  return v_cli;
end $$;

create or replace function public.cash_minha_carteira()
returns table(cliente_id uuid, nome text, acumulado numeric, disponivel numeric,
              vence_em date, gatilho numeric, pode_descer boolean)
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare
  v_cli uuid := cash.cliente_do_usuario();
  v_gatilho numeric;
begin
  if v_cli is null then return; end if;
  v_gatilho := cash.parametro_gatilho();
  return query
    select c.id, c.nome,
           cash.saldo(cash.conta_acumulo(c.id)),
           cash.saldo(cash.conta_disponivel(c.id)),
           cash.vence_em_disponivel(c.id),
           v_gatilho,
           cash.saldo(cash.conta_acumulo(c.id)) >= v_gatilho
      from cash.clientes c where c.id = v_cli;
end $$;

-- O terceiro saldo: o que só vale numa loja. A tela TEM que mostrar isso
-- separado e com o nome da loja -- saldo que a pessoa acha que é livre e não é
-- vira briga no caixa.
create or replace function public.cash_meus_restritos()
returns table(loja_id uuid, loja_nome text, valor numeric, vence_em date)
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare v_cli uuid := cash.cliente_do_usuario();
begin
  if v_cli is null then return; end if;
  return query
    select l.id, l.nome,
           cash.saldo(cash.conta_restrita(v_cli, l.id)),
           (select min(lo.vence_em) from cash.lotes lo
             where lo.conta = cash.conta_restrita(v_cli, l.id)
               and lo.vence_em is not null and lo.vence_em >= current_date)
      from cash.lojas l
     where cash.saldo(cash.conta_restrita(v_cli, l.id)) > 0
     order by l.nome;
end $$;

create or replace function public.cash_descer(p_valor numeric, p_chave text default null)
returns uuid
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare v_cli uuid := cash.cliente_do_usuario();
begin
  if v_cli is null then raise exception 'precisa_entrar'; end if;
  return cash.descer_para_gastar(v_cli, p_valor, p_chave);
end $$;

create or replace function public.cash_minhas_cobrancas()
returns table(id uuid, loja_nome text, valor_compra numeric, valor_em_cash numeric,
              criado_em timestamptz)
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare v_cli uuid := cash.cliente_do_usuario();
begin
  if v_cli is null then return; end if;
  return query
    select p.id, l.nome, p.valor_compra, p.valor_em_cash, p.criado_em
      from cash.pagamentos_pendentes p
      join cash.lojas l on l.id = p.loja_id
     where p.cliente_id = v_cli
     order by p.criado_em desc;
end $$;

create or replace function public.cash_confirmar(p_pagamento uuid, p_chave text default null)
returns uuid
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare v_cli uuid := cash.cliente_do_usuario();
begin
  if v_cli is null then raise exception 'precisa_entrar'; end if;
  -- A CONSULTA DIZ DE QUEM É O DADO. Confirmar cobrança de outro cliente seria
  -- gastar o saldo dele -- e não é a RLS que impede isso aqui (a gaveta não tem
  -- policy nenhuma, de propósito): é este `and cliente_id`.
  if not exists (select 1 from cash.pagamentos_pendentes
                  where id = p_pagamento and cliente_id = v_cli) then
    raise exception 'cobranca_nao_encontrada';
  end if;
  return cash.confirmar_pagamento(p_pagamento, p_chave);
end $$;

create or replace function public.cash_meu_extrato(p_limite int default 50)
returns table(em timestamptz, tipo text, valor numeric, valor_compra numeric, descricao text)
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare v_cli uuid := cash.cliente_do_usuario();
begin
  if v_cli is null then return; end if;
  return query
    select l.em, l.tipo::text, l.valor, l.valor_compra, l.descricao
      from cash.lancamentos l
     where l.conta_origem like 'cliente:' || v_cli::text || '%'
        or l.conta_destino like 'cliente:' || v_cli::text || '%'
     order by l.em desc
     limit greatest(1, least(p_limite, 200));
end $$;

-- O mapa de onde gastar. Aceitação é incondicional, então toda loja ativa da
-- rede serve -- a lista existe para a pessoa SABER disso.
create or replace function public.cash_lojas_da_rede()
returns table(loja_id uuid, nome text, cashback_percentual numeric, catalogo_slug text)
language sql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
  select l.id, l.nome, l.cashback_percentual, l.catalogo_loja_slug
    from cash.lojas l where l.ativa order by l.nome;
$$;

-- --- a fronteira do ADMINISTRADOR ----------------------------------------------
-- `public.e_admin()` é a do Catálogo, e ela já recusa quem está bloqueado (a
-- 0259 fechou a janela de uma hora do token que ainda valia). Função nova que
-- decide "quem é admin" tem que passar por ela, nunca conferir `role` por fora.

create or replace function public.cash_admin_cadastrar_loja(
  p_catalogo_loja_id uuid, p_cashback_percentual numeric
) returns uuid
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare
  v_id uuid;
  v_nome text;
  v_slug text;
begin
  if not public.e_admin() then raise exception 'so_admin'; end if;

  select nome, slug into v_nome, v_slug from public.lojas where id = p_catalogo_loja_id;
  if v_nome is null then raise exception 'loja_do_catalogo_nao_encontrada'; end if;

  -- REGRA 3 DA GAVETA: o dado de referência se COPIA, não se lê do vizinho. O
  -- nome e o slug ficam aqui para a gaveta sair inteira no dia de separar.
  insert into cash.lojas (nome, cashback_percentual, catalogo_loja_id, catalogo_loja_slug)
  values (v_nome, p_cashback_percentual, p_catalogo_loja_id, v_slug)
  on conflict (catalogo_loja_id) where catalogo_loja_id is not null
  do update set cashback_percentual = excluded.cashback_percentual,
                nome = excluded.nome,
                catalogo_loja_slug = excluded.catalogo_loja_slug,
                ativa = true
  returning id into v_id;
  return v_id;
end $$;

-- O depósito é da plataforma, não do lojista -- ver o comentário da
-- `cash.depositar`. Quem diz "o dinheiro entrou" é quem recebeu.
create or replace function public.cash_admin_depositar(
  p_loja uuid, p_valor numeric, p_chave text default null
) returns uuid
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
begin
  if not public.e_admin() then raise exception 'so_admin'; end if;
  return cash.depositar(p_loja, p_valor, p_chave);
end $$;

create or replace function public.cash_admin_saques_pedidos()
returns table(id uuid, loja_id uuid, loja_nome text, valor numeric,
              situacao text, pedido_em timestamptz)
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
begin
  if not public.e_admin() then raise exception 'so_admin'; end if;
  return query
    select s.id, s.loja_id, l.nome, s.valor, s.situacao, s.pedido_em
      from cash.saques_pedidos s join cash.lojas l on l.id = s.loja_id
     order by (s.situacao = 'pedido') desc, s.pedido_em desc;
end $$;

-- Marca o pedido como pago E move o livro, na mesma transação. As duas, ou
-- nenhuma: um livro que diz "pago" sem o lançamento é o furo que a conferência
-- acusaria amanhã sem ninguém saber de onde veio.
create or replace function public.cash_admin_pagar_saque(p_pedido uuid, p_chave text default null)
returns jsonb
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare
  v_ped record;
  v_res jsonb;
begin
  if not public.e_admin() then raise exception 'so_admin'; end if;

  select * into v_ped from cash.saques_pedidos where id = p_pedido for update;
  if not found then raise exception 'pedido_nao_encontrado'; end if;
  if v_ped.situacao <> 'pedido' then raise exception 'pedido_ja_resolvido'; end if;

  v_res := cash.sacar(v_ped.loja_id, v_ped.valor, coalesce(p_chave, 'saque:' || p_pedido::text));

  update cash.saques_pedidos
     set situacao = 'pago', resolvido_em = clock_timestamp(),
         lancamento_id = (v_res ->> 'lancamento_id')::uuid
   where id = p_pedido;

  return v_res;
end $$;

create or replace function public.cash_admin_recusar_saque(p_pedido uuid, p_motivo text default '')
returns void
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
begin
  if not public.e_admin() then raise exception 'so_admin'; end if;
  update cash.saques_pedidos
     set situacao = 'recusado', resolvido_em = clock_timestamp(), observacao = coalesce(p_motivo, '')
   where id = p_pedido and situacao = 'pedido';
  if not found then raise exception 'pedido_nao_encontrado'; end if;
end $$;

create or replace function public.cash_admin_vencer()
returns int
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
begin
  if not public.e_admin() then raise exception 'so_admin'; end if;
  return cash.vencer_lotes();
end $$;

create or replace function public.cash_admin_distribuir(
  p_cliente uuid, p_valor numeric, p_chave text default null
) returns uuid
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
begin
  if not public.e_admin() then raise exception 'so_admin'; end if;
  return cash.distribuir_promocao(p_cliente, p_valor, p_chave);
end $$;

create or replace function public.cash_admin_painel()
returns table(cash_existente numeric, dinheiro_em_custodia numeric, diferenca numeric,
              fecha boolean, fundo_de_promocao numeric, lojas int, clientes int,
              saques_a_pagar numeric)
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
begin
  if not public.e_admin() then raise exception 'so_admin'; end if;
  return query
    select c.cash_existente, c.dinheiro_em_custodia, c.diferenca,
           abs(c.diferenca) < 0.005,
           cash.saldo(cash.conta_promocional()),
           (select count(*)::int from cash.lojas l2 where l2.ativa),
           (select count(*)::int from cash.clientes c2),
           coalesce((select sum(s.valor) from cash.saques_pedidos s where s.situacao = 'pedido'), 0)
      from cash.conferencia c;
end $$;

-- 🔴 NOME DE COLUNA DE SAÍDA IGUAL A NOME DE COLUNA DE TABELA É AMBÍGUO, e o
-- Postgres só reclama QUANDO A FUNÇÃO RODA -- o `create or replace` passa liso,
-- o plantio fica verde, e o erro aparece na primeira chamada de verdade
-- ("column reference \"loja_id\" is ambiguous"). Aconteceu em três funções
-- deste arquivo, achado pelo `fronteira.sql`.
--
-- Por isso toda consulta aqui qualifica a coluna com o apelido da tabela, SEM
-- exceção -- e por isso o `fronteira.sql` CHAMA todas as funções da fronteira em
-- vez de só conferir que elas existem. Trava que lê o catálogo do banco não
-- enxerga este defeito; só executar enxerga.

-- --- AS PORTAS. Fechar são DUAS coisas, e cada uma sozinha deixa a outra aberta:
-- o Postgres dá EXECUTE a PUBLIC em toda função nova, e o Supabase tem um
-- `alter default privileges` que dá uma linha explícita para `anon`. Conferir com
-- `has_function_privilege`, nunca lendo o `revoke` no arquivo.

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

-- E as duas de dentro da gaveta, que a tela não alcança de jeito nenhum (sem
-- `usage` no schema), mas que o `revoke` fecha de qualquer forma -- cinto e
-- suspensório custam uma linha.
revoke all on function cash.loja_do_usuario() from public, anon;
revoke all on function cash.cliente_do_usuario() from public, anon;
