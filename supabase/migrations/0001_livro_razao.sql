-- ---------------------------------------------------------------------------
-- Cash -- livro-razão. Schema inicial.
--
-- ESTE ARQUIVO NÃO FOI APLICADO EM BANCO NENHUM (14/09/2026).
--
-- Ele existe versionado e por aplicar de propósito, no mesmo arranjo do Banco da
-- Hora e da Rede de Parceiros: produto novo não entra no banco do Catálogo nem
-- para "adiantar". Enquanto não houver projeto Supabase próprio (US$ 10/mês), o
-- cash roda em modo demonstração, guardando no navegador -- e o motor que move o
-- dinheiro (`cash/src/nucleo/livro.ts`) é o mesmo dos dois lados.
--
-- Quando o projeto existir: aplicar PRIMEIRO numa branch do Supabase, conferir, e
-- só então promover. Foi um grant esquecido aplicado direto em produção que
-- derrubou o acesso público a todas as lojas do Catálogo em 30/08.
--
-- A regra que o schema inteiro existe para proteger:
--
--     soma de todo o cash que existe  ==  dinheiro parado em custódia
--
-- Por isso não há coluna `saldo` em lugar nenhum: saldo é soma de lotes, e valor
-- só se move de conta para conta. Quem muda o total são duas operações só,
-- depósito e saque, que mexem na custódia no mesmo lançamento.
-- ---------------------------------------------------------------------------

create schema if not exists cash;

-- --- participantes -----------------------------------------------------------

create table cash.lojas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  -- Quanto por cento da compra ela devolve. Presencial multiplica isto (ver parametros).
  cashback_percentual numeric(5,2) not null check (cashback_percentual > 0 and cashback_percentual <= 100),
  -- Vínculo OPCIONAL com a loja do Catálogo: a padaria da esquina entra na rede
  -- sem nunca ter montado catálogo. Amarrar os dois faria o mapa nascer vazio.
  catalogo_loja_id uuid,
  ativa boolean not null default true,
  criada_em timestamptz not null default now()
);

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
  -- De quem era o dinheiro que pagou por este cash. Sem isto não há como mostrar
  -- ao lojista o que ele emitiu nem para onde foi o que venceu.
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
  -- Idempotência: o balcão tem sinal ruim e o vendedor toca duas vezes. A mesma
  -- chave nunca vira dois lançamentos.
  chave text unique,
  tipo cash.tipo_lancamento not null,
  conta_origem text not null,
  conta_destino text not null,
  valor numeric(12,2) not null check (valor > 0),
  -- Só em 'pagamento': o valor da compra declarado no balcão e confirmado pelo
  -- cliente. É deste campo que sai o painel do lojista inteiro.
  valor_compra numeric(12,2) check (valor_compra is null or valor_compra >= valor),
  descricao text not null,
  em timestamptz not null default now()
);

create index lancamentos_em_idx on cash.lancamentos (em desc);

-- Cobrança esperando o cliente confirmar na tela dele. Os dois números (compra e
-- cash) viram acordo entre as duas partes -- é isso que protege de débito errado
-- e o que faz o dado declarado valer como relatório.
create table cash.pagamentos_pendentes (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid not null references cash.lojas(id) on delete cascade,
  cliente_id uuid not null references cash.clientes(id) on delete cascade,
  valor_compra numeric(12,2) not null check (valor_compra > 0),
  valor_em_cash numeric(12,2) not null check (valor_em_cash > 0),
  criado_em timestamptz not null default now(),
  constraint cash_nao_passa_da_compra check (valor_em_cash <= valor_compra)
);

-- Dinheiro de verdade que entrou e saiu. A soma desta tabela é a custódia, e é
-- com ela que a soma dos lotes tem que bater.
create table cash.movimentos_de_caixa (
  id uuid primary key default gen_random_uuid(),
  lancamento_id uuid not null references cash.lancamentos(id),
  -- Positivo em depósito, negativo em saque.
  valor_em_reais numeric(12,2) not null check (valor_em_reais <> 0),
  em timestamptz not null default now()
);

-- --- parâmetros ---------------------------------------------------------------
-- Uma linha só. Todos são botão, não regra escrita no código: o prazo para gastar
-- é o motor do produto e o dono vai querer mexer nele (30, 60, 90) depois de ver
-- rodando. Mudar o parâmetro NÃO mexe em lote já emitido -- quem viu "vence dia
-- 20" vence dia 20.
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

-- --- acesso -------------------------------------------------------------------
-- RLS ligado e ZERO policy, de propósito: nenhum cliente lê tabela direto, nem por
-- engano. Todo acesso entra por função `security definer` que confere quem é quem
-- -- mesmo padrão do schema `msg` do BipeChat.
--
-- Isso importa mais aqui do que em qualquer outro produto do ecossistema: o
-- extrato diz onde a pessoa comprou, quanto e quando, atravessando lojas. A Loja A
-- vê os resgates DELA; o que aquele cliente comprou na Loja B não é dela nunca.

alter table cash.lojas enable row level security;
alter table cash.clientes enable row level security;
alter table cash.lotes enable row level security;
alter table cash.lancamentos enable row level security;
alter table cash.pagamentos_pendentes enable row level security;
alter table cash.movimentos_de_caixa enable row level security;
alter table cash.parametros enable row level security;

revoke all on all tables in schema cash from anon, authenticated;
revoke all on schema cash from anon, authenticated;
