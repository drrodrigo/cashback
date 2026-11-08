-- ---------------------------------------------------------------------------
-- Cash -- devolve dois consertos que EU desfiz (08/11).
--
-- Aplicada na produção como `cash_0016_devolve_o_conserto_que_eu_desfiz` e
-- `cash_0017_as_portas_outra_vez`.
--
-- 🔴 É A REGRA 10 DO BANCO EM CARNE VIVA: "create or replace numa migration
-- aplicada fora de ordem desfaz conserto novo". Eu apliquei a 0010 (a adesão) e
-- DEPOIS apliquei a 0009 (a fronteira), que é anterior -- e as duas definem as
-- mesmas duas funções. O Postgres não reclama de nada: a última a subir ganha.
-- Ganhou a velha, e o plantio ficaria verde dos dois lados.
--
-- O que voltou para trás, medido com `pg_get_functiondef` na produção, não lendo
-- arquivo (é a própria regra 10: o repositório não prova a produção):
--
-- 1. `cash_balcao_ler_carteirinha` perdeu a guarda `membro_nao_ativou`. Com a
--    `cash.cliente_do_membro` sendo só leitura desde a 0010, quem não ativou
--    passou a devolver LISTA VAZIA para o balcão -- o vendedor via "nada" onde
--    tem que ver "ativa aí, é um toque no aplicativo". Tela que não sabe a
--    diferença entre "não ativou" e "deu erro" mostra a coisa errada para
--    alguém, e aqui a coisa errada acontece na frente do cliente, no caixa.
--
-- 2. `cash_admin_ligar_parceiro` perdeu a cópia de `cidade` e `uf`. Sem elas o
--    mapa e a busca por cidade nascem vazios: bloco morto, sem ninguém perceber
--    -- a mesma lição do bloco condicionado a uma coluna que nenhuma loja tem.
--
-- COMO EU ACHEI, para a próxima: eu não achei lendo o que escrevi. Achei
-- comparando a função VIVA com o arquivo, uma por uma, que é a única leitura que
-- vale depois de aplicar coisa fora de ordem.
-- ---------------------------------------------------------------------------

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

  select p.nome, p.cidade, p.uf into v_p
    from clube.parceiros p where p.id = p_clube_parceiro_id;
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

-- Função recriada é função NOVA para o Postgres: ela nasce aberta a PUBLIC e com
-- a linha do `anon` que o `alter default privileges` do Supabase planta. Por isso
-- a varredura roda sobre TODAS as `public.cash_*`, não só sobre as duas de agora.
do $portas$
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
end $portas$;
