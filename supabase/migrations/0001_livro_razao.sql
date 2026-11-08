-- ---------------------------------------------------------------------------
-- Cash -- livro-razão. A gaveta.
--
-- NÃO APLICADO EM BANCO NENHUM (escrito em 14/09, refeito em 01/10 para as regras
-- da gaveta). Plantado e provado no Postgres de mentira:
--
--     bash scripts/banco-de-mentira.sh --testes
--
-- O QUE MUDOU DE 14/09 PARA CÁ, e é o motivo deste arquivo ter sido refeito: naquele
-- dia este cabeçalho dizia "esperando a decisão do projeto Supabase próprio (US$ 10/mês)".
-- Em 13/09 o dono já tinha juntado tudo num banco só, com uma gaveta (schema) por
-- produto. Então o cash não espera projeto novo nem mensalidade nova: ele espera UMA
-- migration, esta, aplicada no banco único -- e custa R$ 0,00.
--
-- A regra que o schema inteiro existe para proteger:
--
--     soma de todo o cash que existe  ==  dinheiro parado em custódia
--
-- Por isso não há coluna `saldo` em lugar nenhum: saldo é soma de lotes, e valor só se
-- move de conta para conta. Quem muda o total são duas operações, depósito e saque, que
-- mexem na custódia no mesmo lançamento.
-- ---------------------------------------------------------------------------

create schema if not exists cash;

-- --- REGRA 4 DA GAVETA: ela nasce FECHADA -----------------------------------
-- O `anon` não tem nem `usage`. Quem serve a tela, quando houver tela, é uma camada
-- curta de funções `security definer` publicadas em `public` (aqui começa com uma,
-- `public.cash_conferencia`). Essa lista curta é a fronteira de verdade: no dia de
-- separar, é ela que vira chamada de API, e nenhuma tela precisa saber.
revoke all on schema cash from public, anon, authenticated;

-- --- participantes -----------------------------------------------------------

create table cash.lojas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cashback_percentual numeric(5,2) not null check (cashback_percentual > 0 and cashback_percentual <= 100),
  -- REGRA 2 DA GAVETA: aponta para a loja do Catálogo sem `references`, porque chave
  -- estrangeira cruzando schema é o que torna `pg_dump --schema=cash` impossível. E vem
  -- com a cópia denormalizada do que a tela mostra ao lado, para a gaveta sair inteira
  -- sem precisar consultar o vizinho.
  catalogo_loja_id uuid,
  catalogo_loja_slug text,
  ativa boolean not null default true,
  criada_em timestamptz not null default now()
);

create index lojas_catalogo_idx on cash.lojas (catalogo_loja_id);

create table cash.clientes (
  id uuid primary key default gen_random_uuid(),
  -- Telefone é a chave do balcão: é por ele que o vendedor acha o cliente.
  telefone text not null unique,
  nome text not null default '',
  criado_em timestamptz not null default now()
);

-- --- o dinheiro ---------------------------------------------------------------

-- Conta é um nome, não uma tabela: 'loja:<id>:credito', 'cliente:<id>:acumulo',
-- 'plataforma:promocional'... Quem guarda valor é o lote.
create table cash.lotes (
  id uuid primary key default gen_random_uuid(),
  conta text not null,
  valor numeric(12,2) not null check (valor > 0),
  -- De quem era o dinheiro que pagou por este cash. Sem isto não há como mostrar ao
  -- lojista o que ele emitiu nem para onde foi o que venceu.
  emissor text not null,
  -- Data em que o lote morre. Nulo = não vence (crédito de lojista, recebido, fundo).
  vence_em date,
  criado_em timestamptz not null default now()
);

create index lotes_conta_idx on cash.lotes (conta);
create index lotes_vencimento_idx on cash.lotes (vence_em) where vence_em is not null;

create type cash.tipo_lancamento as enum (
  'deposito', 'cashback', 'liberacao', 'pagamento', 'saque', 'taxa', 'reciclagem', 'vencimento'
);

create table cash.lancamentos (
  id uuid primary key default gen_random_uuid(),
  -- Idempotência: o balcão tem sinal ruim e o vendedor toca duas vezes. A mesma chave
  -- nunca vira dois lançamentos.
  chave text unique,
  tipo cash.tipo_lancamento not null,
  conta_origem text not null,
  conta_destino text not null,
  valor numeric(12,2) not null check (valor > 0),
  -- Só em 'pagamento': o valor da compra declarado no balcão e confirmado pelo cliente.
  -- É deste campo que sai o painel do lojista inteiro.
  valor_compra numeric(12,2) check (valor_compra is null or valor_compra >= valor),
  descricao text not null,
  em timestamptz not null default now()
);

create index lancamentos_em_idx on cash.lancamentos (em desc);

-- Cobrança esperando o cliente confirmar na tela dele. Os dois números (compra e cash)
-- viram acordo entre as duas partes -- é isso que protege de débito errado e o que faz o
-- dado declarado valer como relatório.
create table cash.pagamentos_pendentes (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid not null references cash.lojas(id) on delete cascade,
  cliente_id uuid not null references cash.clientes(id) on delete cascade,
  valor_compra numeric(12,2) not null check (valor_compra > 0),
  valor_em_cash numeric(12,2) not null check (valor_em_cash > 0),
  criado_em timestamptz not null default now(),
  constraint cash_nao_passa_da_compra check (valor_em_cash <= valor_compra)
);

-- Dinheiro de verdade que entrou e saiu. A soma desta tabela é a custódia, e é com ela
-- que a soma dos lotes tem que bater.
create table cash.movimentos_de_caixa (
  id uuid primary key default gen_random_uuid(),
  lancamento_id uuid not null references cash.lancamentos(id),
  -- Positivo em depósito, negativo em saque.
  valor_em_reais numeric(12,2) not null check (valor_em_reais <> 0),
  em timestamptz not null default now()
);

-- --- parâmetros ---------------------------------------------------------------
-- Uma linha só. Todos são botão, não regra escrita no código: o prazo para gastar é o
-- motor do produto e o dono vai querer mexer nele (30, 60, 90) depois de ver rodando.
-- Mudar o parâmetro NÃO mexe em lote já emitido -- quem viu "vence dia 20" vence dia 20.
create table cash.parametros (
  id boolean primary key default true check (id),
  gatilho numeric(12,2) not null default 30,
  prazo_gasto_dias integer not null default 30,
  prazo_acumulo_dias integer not null default 365,
  prazo_restrito_dias integer not null default 30,
  taxa_saque_percentual numeric(5,2) not null default 5,
  multiplicador_presencial numeric(4,2) not null default 2
);

insert into cash.parametros (id) values (true);

-- --- a conferência ------------------------------------------------------------
-- Roda todo dia. Se as duas colunas se separarem, alguém sacaria dinheiro que não
-- existe: o certo é travar o saque e avisar, nunca seguir servindo saldo bonito.
create view cash.conferencia as
select
  (select coalesce(sum(valor), 0) from cash.lotes) as cash_existente,
  (select coalesce(sum(valor_em_reais), 0) from cash.movimentos_de_caixa) as dinheiro_em_custodia,
  (select coalesce(sum(valor), 0) from cash.lotes)
    - (select coalesce(sum(valor_em_reais), 0) from cash.movimentos_de_caixa) as diferenca;

-- --- RLS: ligada, e sem policy nenhuma ----------------------------------------
-- Nenhum cliente lê tabela direto, nem por engano. Isso pesa mais aqui do que em
-- qualquer outro produto do ecossistema: o extrato diz onde a pessoa comprou, quanto e
-- quando, atravessando lojas. A Loja A vê os resgates DELA; o que aquele cliente comprou
-- na Loja B não é dela nunca.

alter table cash.lojas enable row level security;
alter table cash.clientes enable row level security;
alter table cash.lotes enable row level security;
alter table cash.lancamentos enable row level security;
alter table cash.pagamentos_pendentes enable row level security;
alter table cash.movimentos_de_caixa enable row level security;
alter table cash.parametros enable row level security;

-- --- GAVETA NOVA NÃO HERDA NADA, nem a chave de serviço ------------------------
-- Em `public` isto vem de graça (o Supabase tem um `alter default privileges` que dá
-- tudo ao `service_role` lá). Fora de `public`, não vem -- e o schema `autobipe` ficou
-- com ZERO grant para o `service_role` quando mudou de casa, em 19/09: as Edge Functions
-- simplesmente não liam, e nenhum teste pegou, porque teste de RLS veste `anon` e
-- `authenticated`, nunca `service_role` (pular RLS não é pular GRANT).
--
-- Os *default privileges* vão junto de propósito: sem eles, a primeira tabela criada
-- depois desta migration já nasce fora do alcance de quem escreve por trás.

grant usage on schema cash to service_role;
grant all privileges on all tables    in schema cash to service_role;
grant all privileges on all sequences in schema cash to service_role;
grant execute        on all functions in schema cash to service_role;
alter default privileges in schema cash grant all privileges on tables    to service_role;
alter default privileges in schema cash grant all privileges on sequences to service_role;
alter default privileges in schema cash grant execute        on functions to service_role;

-- --- a fronteira: a primeira função da camada curta em `public` -----------------
-- A conferência é o que a tela de administração precisa ver sem enxergar lançamento de
-- ninguém: dois números e um veredito. Serve de semente do padrão -- toda tela futura
-- entra por uma função assim, e é essa lista que vira API no dia de separar.
create or replace function public.cash_conferencia()
returns table(cash_existente numeric, dinheiro_em_custodia numeric, diferenca numeric, fecha boolean)
language sql
security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
  select c.cash_existente, c.dinheiro_em_custodia, c.diferenca, abs(c.diferenca) < 0.005
    from cash.conferencia c;
$$;

-- FECHAR A PORTA SÃO DUAS COISAS, e cada uma sozinha deixa a outra aberta: o Postgres dá
-- EXECUTE a PUBLIC em toda função nova, e o Supabase tem um `alter default privileges`
-- que dá uma linha explícita para `anon`. Conferir com `has_function_privilege`, nunca
-- lendo o `revoke` no arquivo.
revoke all on function public.cash_conferencia() from public, anon;
grant execute on function public.cash_conferencia() to authenticated, service_role;

-- --- storage, para quando houver arquivo ---------------------------------------
-- NÃO cria balde nenhum, e está anotado por quê: `storage.buckets` e `storage.objects`
-- NÃO moram em schema -- são do projeto inteiro, de todos os produtos juntos. Um
-- `insert ... on conflict do nothing` num balde com nome genérico acha o balde do
-- vizinho e segue em silêncio, e a policy criada logo abaixo passa a valer sobre os
-- arquivos DELE. Quando o cash precisar guardar arquivo, o balde e a policy levam o nome
-- do produto na frente: `cash-comprovantes`, `cash_plataforma_select_publico`.
