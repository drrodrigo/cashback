-- ---------------------------------------------------------------------------
-- Cash -- A ADESÃO e O CICLO. A parte do usuário, do jeito que ele descreveu.
--
-- As quatro coisas que esta migration muda, todas ditadas por ele em 04/10:
--
-- 1. 🔴 A CONTA NASCE DE UM CLIQUE DELE, não de uma venda.
--    *"a gente vai instalar lá dentro uma opção de ativar. (...) ele vai clicar
--    lá e vai aderir ao cashback. Aí a gente vai pegar os dados dele, que já
--    está pronto, já está tudo cadastrado, e aí ele vai abrir lá uma sessão de
--    conta corrente. E aí o saldo dele é zero."*
--
--    Antes desta migration a carteira era criada por dentro, na primeira vez que
--    alguém encostasse nela -- inclusive no balcão. Isso é CONTA FANTASMA COM
--    DINHEIRO: a pessoa passaria a ter saldo num produto em que nunca entrou, e
--    descobriria depois. Agora existe `aderiu_em`, e ela só é marcada por
--    `public.cash_aderir()`, que é o botão dele.
--
--    Consequência no balcão, e ela é honesta: ler a carteirinha de quem não
--    ativou devolve `membro_nao_ativou` em vez de criar conta calada. É um toque
--    no aplicativo dele e pronto -- e é melhor o vendedor dizer "ativa aí" do
--    que a pessoa ganhar uma conta que não pediu.
--
-- 2. 🔴 O CICLO DE 30 TEM QUE APARECER NA TELA.
--    *"a princípio 30 reais seria um saldo para gastar. Então ele só vai poder
--    gastar na hora que ele acumular 30 reais. Seria tipo um real por dia. (...)
--    Toda vez que ele transferir para gastar, inicia um novo ciclo de 30."*
--
--    O motor já cobrava o gatilho; o que faltava era a carteira DIZER quanto
--    falta. Prazo e meta que a pessoa não vê não apressam ninguém, e apressar é
--    o produto inteiro. Agora `cash_minha_carteira` devolve
--    `falta_para_liberar`.
--
--    O ciclo não precisou de código novo: quem desce 30 de 35 fica com 5
--    juntados e tem que chegar aos 30 outra vez. É o ciclo dele, por construção.
--
-- 3. O MAPA E A BUSCA, que são como ela descobre onde gastar.
--    *"ele vai ter um mapa lá, ele vai poder ver quais as lojas que tem
--    cashback. (...) a gente vai dar para ele uma pesquisa para ele saber onde
--    comprar."*
--
--    `cash.lojas` passa a guardar `cidade` e `uf` COPIADOS do parceiro (regra 3
--    da gaveta: o dado de referência se copia, não se lê do vizinho), e
--    `cash_lojas_da_rede` ganha busca por nome e por cidade.
--
-- 4. ⚠️ O QUE ESTA MIGRATION NÃO FAZ, E É DECISÃO DELE EM ABERTO:
--    *"eles vão poder aderir ao sistema e oferecer o cashback, tanto para o
--    produto ou um cashback geral. Aí tem que decidir ainda com o lojista."*
--
--    Cashback POR PRODUTO não foi modelado, de propósito -- ele disse que ainda
--    vai decidir com o lojista. Modelar antes seria inventar a regra dele, e é o
--    erro do tema de calçados: a tela prometeria um filtro que o cadastro não
--    sabe responder. O que existe hoje é o percentual da LOJA (cashback geral),
--    que é o caminho que ele já descreveu inteiro.
-- ---------------------------------------------------------------------------

-- --- 1. a adesão ---------------------------------------------------------------

alter table cash.clientes add column if not exists aderiu_em timestamptz;

-- Só lê. NÃO cria mais nada: criar conta é ato dele, não efeito de alguém
-- encostar na carteira. A função antiga fazia as duas coisas, e era aí que a
-- conta fantasma nascia.
create or replace function cash.cliente_do_membro(p_membro uuid) returns uuid
language sql stable as $$
  select id from cash.clientes where clube_membro_id = p_membro;
$$;

-- O BOTÃO. Abre a conta corrente do membro do Clube, com saldo zero, copiando o
-- nome e o telefone que já estão cadastrados (regra 3).
--
-- Idempotente de propósito: tocar duas vezes no "ativar" não cria duas contas
-- nem reinicia a data de adesão -- é a mesma disciplina da chave de idempotência
-- do balcão, e aqui o dedo tremido é ainda mais provável, porque é celular.
create or replace function public.cash_aderir()
returns table(cliente_id uuid, nome text, saldo numeric, aderiu_em timestamptz)
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_nome text;
  v_tel text;
begin
  if v_uid is null then raise exception 'precisa_entrar'; end if;

  select p.nome, nullif(regexp_replace(coalesce(p.telefone,''), '[^0-9]', '', 'g'), '')
    into v_nome, v_tel
    from clube.perfis p where p.id = v_uid;
  if not found then
    raise exception 'precisa_ser_do_clube'
      using hint = 'A conta de cashback é do membro do Clube. Entre no Clube primeiro.';
  end if;

  insert into cash.clientes (clube_membro_id, nome, telefone, aderiu_em)
  values (v_uid, coalesce(v_nome, ''), v_tel, clock_timestamp())
  on conflict (clube_membro_id) where clube_membro_id is not null
  do update set
    -- A data da PRIMEIRA adesão não se mexe, e o nome só se preenche quando está
    -- vazio: substituir calado é a lição de 20/09.
    aderiu_em = coalesce(cash.clientes.aderiu_em, excluded.aderiu_em),
    nome = case when cash.clientes.nome = '' then excluded.nome else cash.clientes.nome end,
    telefone = coalesce(cash.clientes.telefone, excluded.telefone)
  returning id into v_id;

  return query
    select c.id, c.nome, cash.saldo(cash.conta_acumulo(c.id)), c.aderiu_em
      from cash.clientes c where c.id = v_id;
end $$;

-- `cash_entrar` continua existindo e passa a ser só LEITURA: ela responde "esta
-- pessoa já tem conta?" sem criar nada. Quem cria é o botão acima.
create or replace function public.cash_entrar()
returns uuid
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'precisa_entrar'; end if;
  return cash.cliente_do_membro(v_uid);
end $$;

-- --- 2. o ciclo visível --------------------------------------------------------

-- 🔴 MUDAR AS COLUNAS DE SAÍDA EXIGE `drop` ANTES: `create or replace` recusa com
-- "cannot change return type of existing function". E o `drop` leva os GRANTS
-- embora -- a função volta aberta a PUBLIC e fechada para o logado. É por isso
-- que o bloco de portas no fim deste arquivo roda sobre TODAS as `public.cash_*`
-- e não só sobre as novas: função recriada é função nova para o Postgres.
drop function if exists public.cash_minha_carteira();

-- A carteira agora diz TRÊS coisas que a tela precisa para se desenhar sozinha:
-- se a pessoa aderiu (para mostrar o botão de ativar ou o saldo), quanto falta
-- para liberar (o ciclo), e o prazo do que já está liberado.
create or replace function public.cash_minha_carteira()
returns table(cliente_id uuid, nome text, aderiu boolean, acumulado numeric,
              disponivel numeric, vence_em date, gatilho numeric,
              falta_para_liberar numeric, pode_descer boolean)
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare
  v_cli uuid := cash.cliente_do_usuario();
  v_gatilho numeric := cash.parametro_gatilho();
  v_acumulado numeric;
begin
  -- QUEM NÃO ADERIU RECEBE UMA LINHA, não vazio. Devolver vazio obrigaria a tela
  -- a adivinhar entre "não aderiu" e "deu erro" -- e tela que adivinha mostra a
  -- coisa errada para alguém. Com a linha, ela sabe desenhar o botão de ativar.
  if v_cli is null then
    return query select null::uuid, ''::text, false, 0::numeric, 0::numeric,
                        null::date, v_gatilho, v_gatilho, false;
    return;
  end if;

  v_acumulado := cash.saldo(cash.conta_acumulo(v_cli));
  return query
    select c.id, c.nome, c.aderiu_em is not null,
           v_acumulado,
           cash.saldo(cash.conta_disponivel(c.id)),
           cash.vence_em_disponivel(c.id),
           v_gatilho,
           greatest(0, round(v_gatilho - v_acumulado, 2)),
           v_acumulado >= v_gatilho
      from cash.clientes c where c.id = v_cli;
end $$;

-- --- 3. o mapa e a busca -------------------------------------------------------

alter table cash.lojas add column if not exists cidade text;
alter table cash.lojas add column if not exists uf char(2);

-- A antiga não tinha argumento. Deixar as duas faria `cash_lojas_da_rede()`
-- ficar AMBÍGUA (a nova tem valor padrão), e o erro só apareceria na chamada.
drop function if exists public.cash_lojas_da_rede();

create or replace function public.cash_lojas_da_rede(p_busca text default null)
returns table(loja_id uuid, nome text, cashback_percentual numeric,
              cidade text, uf char(2), catalogo_slug text, clube_parceiro_id uuid)
language sql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
  select l.id, l.nome, l.cashback_percentual, l.cidade, l.uf,
         l.catalogo_loja_slug, l.clube_parceiro_id
    from cash.lojas l
   where l.ativa
     and (
       coalesce(btrim(p_busca), '') = ''
       -- `unaccent` não está instalado neste banco, então a busca compara sem
       -- diferenciar maiúscula (`ilike`) e aceita pedaço do nome ou da cidade.
       -- Quem digita "joal" acha "Joalheria"; quem digita "lagoa" acha a cidade.
       or l.nome ilike '%' || btrim(p_busca) || '%'
       or coalesce(l.cidade, '') ilike '%' || btrim(p_busca) || '%'
     )
   order by l.cidade nulls last, l.nome;
$$;

create or replace function public.cash_admin_ligar_parceiro(
  p_clube_parceiro_id uuid, p_cashback_percentual numeric
) returns uuid
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare
  v_id uuid;
  v_p record;
begin
  if not public.e_admin() then raise exception 'so_admin'; end if;

  select nome, cidade, uf into v_p from clube.parceiros where id = p_clube_parceiro_id;
  if v_p.nome is null then raise exception 'parceiro_nao_encontrado'; end if;

  -- Cidade e UF vêm COPIADAS (regra 3): é o que o mapa e a busca leem, e é o que
  -- faz a gaveta sair inteira no dia de separar.
  insert into cash.lojas (nome, cashback_percentual, clube_parceiro_id, cidade, uf)
  values (v_p.nome, p_cashback_percentual, p_clube_parceiro_id, v_p.cidade, v_p.uf)
  on conflict (clube_parceiro_id) where clube_parceiro_id is not null
  do update set cashback_percentual = excluded.cashback_percentual,
                nome = excluded.nome, cidade = excluded.cidade, uf = excluded.uf,
                ativa = true
  returning id into v_id;
  return v_id;
end $$;

-- --- o balcão, agora exigindo a adesão -----------------------------------------

-- Lê a carteirinha E exige que o membro tenha ativado o cashback. Repare que a
-- leitura do Clube acontece ANTES: o token é consumido de qualquer forma, porque
-- a validação do Clube é um atendimento que aconteceu -- o que não acontece é o
-- crédito numa conta que ninguém abriu.
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

  -- Quem autoriza é o Clube. Token vencido, já usado, QR que não é carteirinha,
  -- ou quem lê não é o dono ativo: ele levanta o erro dele.
  select * into v_leitura from clube.ler_carteirinha(v_parceiro, p_token);

  select v.membro_id into v_membro from clube.validacoes v where v.id = v_leitura.validacao_id;

  v_cli := cash.cliente_do_membro(v_membro);
  if v_cli is null then
    raise exception 'membro_nao_ativou'
      using hint = 'Este membro ainda não ativou o cashback. É um toque no aplicativo dele.';
  end if;

  return query
    select v_cli, c.nome,
           cash.pode_usar_na_loja(v_cli, v_loja),
           cash.saldo(cash.conta_acumulo(v_cli)),
           v_leitura.validacao_id,
           v_leitura.nivel
      from cash.clientes c where c.id = v_cli;
end $$;

-- --- as portas, outra vez ------------------------------------------------------
-- Função NOVA em `public` nasce aberta a PUBLIC (o Postgres) e com uma linha
-- explícita para `anon` (o `alter default privileges` do Supabase). Fechar são
-- duas coisas, e cada uma sozinha deixa a outra aberta.

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

revoke all on function cash.cliente_do_membro(uuid) from public, anon;
