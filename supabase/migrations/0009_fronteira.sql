-- ---------------------------------------------------------------------------
-- Cash -- A FRONTEIRA. A camada curta de funções em `public`.
--
-- 🔴 ESTE ARQUIVO FOI REESCRITO EM 04/10, ANTES DE SER APLICADO, e o motivo é a
-- lição mais cara deste repositório: EU IA CONSTRUIR O QUE JÁ EXISTE.
--
-- A primeira versão inventava o cliente do cashback do zero: cadastro por
-- telefone, login por SMS (que custa por mensagem), carteira nova. Então o dono
-- disse de onde o cliente vem: *"no caso seria o usuário do Clube Prime. Lá
-- dentro do Clube Prime a gente vai criar um acesso ao cashback"* -- e depois
-- *"esse pessoal vai ser a nossa base, o pessoal que já vai estar podendo
-- habilitar o cashback"*.
--
-- Medido na produção antes de escrever uma linha (04/10):
--
-- | o que eu ia construir      | o que JÁ EXISTE no schema `clube`              |
-- |----------------------------|------------------------------------------------|
-- | cadastro de cliente        | `clube.perfis` -- **3.903 pessoas**, todas com login no `auth.users` |
-- | login por telefone com SMS | o login do Clube, que essas 3.903 já têm       |
-- | achar o cliente no balcão  | `clube.ler_carteirinha(parceiro, token)` -- QR com token de 90s, uso único |
-- | loja parceira              | `clube.parceiros` -- **42**, com `comissao_percentual` |
-- | o resgate como dado        | `clube.validacoes` -- já tem `valor_compra_centavos` e `economia_centavos` |
--
-- É o caso de 16/09 e de 01/10 pela terceira vez: *"não existe" era "existe e
-- ninguém acha"*. A diferença é que desta vez a medição veio antes da entrega --
-- e o que ela economizou não foi uma tela, foi **o custo de SMS por login** e um
-- cadastro paralelo de 3.903 pessoas que já estão cadastradas.
--
-- 🔴 E ELA CONSERTOU UM RISCO, NÃO SÓ POUPOU TRABALHO. A versão anterior lia o
-- telefone do login (`auth.jwt() ->> 'phone'`) para não deixar ninguém digitar o
-- número de outra pessoa e levar o saldo dela -- a conta fantasma do BipeChat.
-- A carteirinha é melhor que isso em dois aspectos: o token PROVA que a pessoa
-- está no balcão com o aplicativo na mão (90 segundos, uso único), e quem valida
-- tem que ser o dono ATIVO do parceiro. Não há campo nenhum onde digitar o
-- identificador de um terceiro.
--
-- O LOJISTA entra de dois jeitos, porque o cash serve aos dois mundos dele:
-- `clube.parceiros.dono_id = auth.uid()` (os 42 parceiros do Clube) ou
-- `public.lojas.owner_id = auth.uid()` (as lojas do Catálogo). A fronteira
-- resolve NA HORA, a cada chamada: guardar o dono copiado aqui deixaria quem
-- vendeu a loja operando o balcão dela.
--
-- A gaveta `cash` continua fechada: nem `anon` nem `authenticated` têm `usage`
-- nela. Esta lista curta é a fronteira de verdade -- no dia de separar o produto,
-- é ela que vira chamada de API.
--
-- ⚠️ O QUE ESTE ARQUIVO NÃO FAZ, DE PROPÓSITO: não escreve em `clube.validacoes`.
-- O Clube é outro produto, e preencher o `valor_compra_centavos` dele daqui
-- mudaria o relatório dele sem ninguém ter pedido. O cash guarda o seu próprio
-- elo (`cash.lancamentos.clube_validacao_id`) e deixa a pergunta registrada: o
-- cashback deve também completar a ficha de validação do Clube, para os
-- relatórios de lá continuarem inteiros? É decisão dele.
-- ---------------------------------------------------------------------------

-- --- o que faltava de tabela ---------------------------------------------------

-- O ELO COM O CLUBE. `uuid` solto, sem `references clube.perfis`: a regra 2 vale
-- para o vizinho como vale para `public` -- rebite atravessando schema é o que
-- torna `pg_dump --schema=cash` impossível no dia de separar.
alter table cash.clientes add column if not exists clube_membro_id uuid;
create unique index if not exists clientes_clube_idx on cash.clientes (clube_membro_id)
  where clube_membro_id is not null;

-- O TELEFONE DEIXA DE SER A CHAVE. Ele era `not null unique` porque era a
-- identidade; agora a identidade é o membro do Clube, e o telefone é só cópia
-- denormalizada (regra 3) para o balcão conferir com quem está falando. Dos
-- 3.903 membros, 6 não têm telefone -- com `not null` eles não entrariam.
alter table cash.clientes alter column telefone drop not null;
alter table cash.clientes drop constraint if exists clientes_telefone_key;
create unique index if not exists clientes_telefone_idx on cash.clientes (telefone)
  where telefone is not null and telefone <> '';

-- E QUEM LÊ O TELEFONE TEM QUE SABER DISSO. `on conflict (telefone)` não acha um
-- índice PARCIAL sozinho -- ele precisa do mesmo `where` para inferir o índice.
-- Trocar a restrição e não atualizar quem a usa é a lição de 12/09 (a coluna
-- criada sem atualizar o `minha_loja`), e aqui o plantio reprovou na hora: "there
-- is no unique or exclusion constraint matching the ON CONFLICT specification".
-- Trocar a chave e consertar quem a lê são a MESMA mudança, não duas.
create or replace function cash.achar_ou_criar_cliente(p_telefone text, p_nome text default '')
returns uuid
language plpgsql as $$
declare
  v_id uuid;
  v_tel text := regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g');
begin
  if length(v_tel) < 10 then
    raise exception 'telefone_invalido' using hint = 'Telefone precisa ter DDD e número.';
  end if;

  insert into cash.clientes (telefone, nome) values (v_tel, coalesce(p_nome, ''))
  on conflict (telefone) where telefone is not null and telefone <> ''
  do update
    -- DUPLICAR FAZ BARULHO, SUBSTITUIR NÃO: o `do update` só preenche o nome
    -- quando ele está vazio, nunca por cima do que já existe.
    set nome = case when cash.clientes.nome = '' then excluded.nome else cash.clientes.nome end
  returning id into v_id;

  return v_id;
end $$;

-- O ELO COM O PARCEIRO DO CLUBE, pelo mesmo motivo e com a mesma forma.
alter table cash.lojas add column if not exists clube_parceiro_id uuid;
create unique index if not exists lojas_clube_idx on cash.lojas (clube_parceiro_id)
  where clube_parceiro_id is not null;

-- Uma loja do Catálogo não pode virar duas lojas no cash: seria crédito em dois
-- lugares e balcão escolhendo qual.
create unique index if not exists lojas_catalogo_unico_idx on cash.lojas (catalogo_loja_id)
  where catalogo_loja_id is not null;

-- O elo com a leitura da carteirinha que originou o cashback. É o que deixa
-- responder "de onde veio este crédito" sem ler nada do Clube.
alter table cash.lancamentos add column if not exists clube_validacao_id uuid;
create index if not exists lancamentos_validacao_idx on cash.lancamentos (clube_validacao_id)
  where clube_validacao_id is not null;

-- O PEDIDO de saque, e por que ele existe em vez de o lojista sacar sozinho.
--
-- `cash.sacar` tira dinheiro da custódia -- quer dizer que ele REGISTRA que o
-- dinheiro saiu. Mas quem manda o Pix é gente. Se o lojista disparasse o saque
-- pela tela, o livro diria "saiu 950" num instante em que ninguém transferiu
-- nada: o livro passaria a mentir sobre dinheiro de verdade, que é o único erro
-- deste produto que não tem conserto barato.
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

create or replace function cash.loja_do_usuario() returns uuid
language sql stable as $$
  select cl.id from cash.lojas cl
    join clube.parceiros cp on cp.id = cl.clube_parceiro_id
   where cp.dono_id = auth.uid() and cp.ativo and cl.ativa
  union all
  select cl.id from cash.lojas cl
    join public.lojas pl on pl.id = cl.catalogo_loja_id
   where pl.owner_id = auth.uid() and cl.ativa
  limit 1;
$$;

create or replace function cash.cliente_do_usuario() returns uuid
language sql stable as $$
  select id from cash.clientes where clube_membro_id = auth.uid();
$$;

-- Acha ou cria o cliente do cash a partir do membro do Clube, COPIANDO nome e
-- telefone (regra 3: o dado de referência se copia, não se lê do vizinho -- assim
-- a gaveta sai inteira no dia de separar).
create or replace function cash.cliente_do_membro(p_membro uuid) returns uuid
language plpgsql as $$
declare
  v_id uuid;
  v_nome text;
  v_tel text;
begin
  select id into v_id from cash.clientes where clube_membro_id = p_membro;
  if v_id is not null then return v_id; end if;

  select nome, nullif(regexp_replace(coalesce(telefone,''), '[^0-9]', '', 'g'), '')
    into v_nome, v_tel
    from clube.perfis where id = p_membro;
  if not found then raise exception 'nao_e_do_clube'; end if;

  insert into cash.clientes (clube_membro_id, nome, telefone)
  values (p_membro, coalesce(v_nome, ''), v_tel)
  returning id into v_id;
  return v_id;
end $$;

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

-- 🔴 A PORTA DO BALCÃO: LER A CARTEIRINHA. Não existe campo para digitar quem é o
-- cliente, e isso não é economia de tela -- é o que impede o vendedor (ou
-- qualquer um com a tela aberta) de creditar ou debitar a conta de um terceiro.
-- O token prova que a pessoa está ali com o aplicativo na mão: 32 caracteres hex,
-- 90 segundos, uso único, e o parceiro tem que ser o dono ATIVO.
--
-- Repare que ela DELEGA ao Clube (`clube.ler_carteirinha`) em vez de copiar as
-- quatro recusas dele. Copiar regra de autorização é garantir que uma das cópias
-- fique velha -- e a que fica velha é sempre a que ninguém lembra que existe.
create or replace function public.cash_balcao_ler_carteirinha(p_token text)
returns table(cliente_id uuid, nome text, pode_usar_aqui numeric, acumulado numeric,
              validacao_id uuid, nivel text)
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare
  v_loja uuid := cash.loja_do_usuario();
  v_parceiro uuid;
  v_leitura record;
  v_membro uuid;
  v_cli uuid;
begin
  if v_loja is null then raise exception 'nao_e_lojista'; end if;

  select l.clube_parceiro_id into v_parceiro from cash.lojas l where l.id = v_loja;
  if v_parceiro is null then
    raise exception 'loja_sem_carteirinha'
      using hint = 'Esta loja do cash não está ligada a um parceiro do Clube.';
  end if;

  -- Quem autoriza é o Clube. Se o token venceu, já foi usado, não é QR de
  -- carteirinha, ou quem está lendo não é o dono ativo, ele levanta o erro dele.
  select * into v_leitura from clube.ler_carteirinha(v_parceiro, p_token);

  select v.membro_id into v_membro from clube.validacoes v where v.id = v_leitura.validacao_id;
  v_cli := cash.cliente_do_membro(v_membro);

  return query
    select v_cli, c.nome,
           cash.pode_usar_na_loja(v_cli, v_loja),
           cash.saldo(cash.conta_acumulo(v_cli)),
           v_leitura.validacao_id,
           v_leitura.nivel
      from cash.clientes c where c.id = v_cli;
end $$;

-- O CASHBACK NO LUGAR DO DESCONTO. É a frase dele, inteira: *"em vez de aplicar o
-- desconto no preço, ele vai acrescentar esse valor do desconto no saldo do
-- usuário"*. O `p_validacao` é a leitura da carteirinha que acabou de acontecer --
-- é ele que amarra o crédito ao atendimento, e é por ele que se responde depois
-- "de onde veio este saldo".
create or replace function public.cash_balcao_dar_cashback(
  p_cliente uuid, p_valor_compra numeric,
  p_presencial boolean default true, p_restrito boolean default false,
  p_chave text default null, p_validacao uuid default null
) returns uuid
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare
  v_loja uuid := cash.loja_do_usuario();
  v_id uuid;
begin
  if v_loja is null then raise exception 'nao_e_lojista'; end if;
  v_id := cash.dar_cashback(v_loja, p_cliente, p_valor_compra, p_presencial, p_restrito, p_chave);
  if p_validacao is not null then
    update cash.lancamentos set clube_validacao_id = p_validacao where id = v_id;
  end if;
  return v_id;
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
returns table(id uuid, cliente_nome text, valor_compra numeric, valor_em_cash numeric,
              criado_em timestamptz)
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare v_loja uuid := cash.loja_do_usuario();
begin
  if v_loja is null then return; end if;
  return query
    select p.id, c.nome, p.valor_compra, p.valor_em_cash, p.criado_em
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

-- --- a fronteira do CLIENTE (a carteira, dentro do Clube) -----------------------

-- Liga a carteira ao login. NÃO recebe identificador nenhum: quem está logado é
-- quem é. Para existir carteira, a pessoa precisa ser membro do Clube -- é a base
-- que o dono escolheu, e ela já tem 3.903 pessoas com login.
create or replace function public.cash_entrar()
returns uuid
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
begin
  if auth.uid() is null then raise exception 'precisa_entrar'; end if;
  if not exists (select 1 from clube.perfis where id = auth.uid()) then
    raise exception 'precisa_ser_do_clube'
      using hint = 'A carteira de cash é do membro do Clube. Entre no Clube primeiro.';
  end if;
  return cash.cliente_do_membro(auth.uid());
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

-- O terceiro saldo: o que só vale numa loja. A tela TEM que mostrar isso separado
-- e com o nome da loja -- saldo que a pessoa acha que é livre e não é vira briga
-- no caixa.
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

-- O MAPA DE ONDE GASTAR. Aceitação é incondicional, então toda loja ativa da rede
-- serve -- esta lista existe para a pessoa SABER disso. É o "mapa de lojas
-- parceiras" que ele pediu desde a primeira conversa.
create or replace function public.cash_lojas_da_rede()
returns table(loja_id uuid, nome text, cashback_percentual numeric,
              catalogo_slug text, clube_parceiro_id uuid)
language sql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
  select l.id, l.nome, l.cashback_percentual, l.catalogo_loja_slug, l.clube_parceiro_id
    from cash.lojas l where l.ativa order by l.nome;
$$;

-- --- a fronteira do ADMINISTRADOR ----------------------------------------------
-- `public.e_admin()` é a do Catálogo, e ela já recusa quem está bloqueado (a 0259
-- fechou a janela de uma hora do token que ainda valia). Função nova que decide
-- "quem é admin" tem que passar por ela, nunca conferir `role` por fora.

-- Põe um PARCEIRO DO CLUBE no cashback, copiando o nome (regra 3).
create or replace function public.cash_admin_ligar_parceiro(
  p_clube_parceiro_id uuid, p_cashback_percentual numeric
) returns uuid
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare
  v_id uuid;
  v_nome text;
begin
  if not public.e_admin() then raise exception 'so_admin'; end if;

  select nome into v_nome from clube.parceiros where id = p_clube_parceiro_id;
  if v_nome is null then raise exception 'parceiro_nao_encontrado'; end if;

  insert into cash.lojas (nome, cashback_percentual, clube_parceiro_id)
  values (v_nome, p_cashback_percentual, p_clube_parceiro_id)
  on conflict (clube_parceiro_id) where clube_parceiro_id is not null
  do update set cashback_percentual = excluded.cashback_percentual,
                nome = excluded.nome, ativa = true
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.cash_admin_ligar_loja_do_catalogo(
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

  insert into cash.lojas (nome, cashback_percentual, catalogo_loja_id, catalogo_loja_slug)
  values (v_nome, p_cashback_percentual, p_catalogo_loja_id, v_slug)
  on conflict (catalogo_loja_id) where catalogo_loja_id is not null
  do update set cashback_percentual = excluded.cashback_percentual,
                nome = excluded.nome, catalogo_loja_slug = excluded.catalogo_loja_slug,
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
-- Postgres só reclama QUANDO A FUNÇÃO RODA -- o `create or replace` passa liso, o
-- plantio fica verde, e o erro aparece na primeira chamada de verdade ("column
-- reference \"loja_id\" is ambiguous"). Aconteceu em três funções deste arquivo,
-- achado pelo `fronteira.sql`.
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

revoke all on function cash.loja_do_usuario() from public, anon;
revoke all on function cash.cliente_do_usuario() from public, anon;
revoke all on function cash.cliente_do_membro(uuid) from public, anon;
