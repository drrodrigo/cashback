-- ---------------------------------------------------------------------------
-- Cash -- a carteira diz se a conta é do Clube.
--
-- 🔴 ACHADO DESENHANDO A TELA, e é o motivo desta migration existir.
--
-- `cash.cliente_do_usuario()` devolve nulo em DOIS casos diferentes:
--
--   1. a pessoa é membro do Clube e ainda não ativou o cashback;
--   2. a pessoa está logada mas NÃO é membro do Clube.
--
-- A carteira devolvia `aderiu = false` nos dois, então a tela não tinha como
-- distinguir -- e eu ia desenhar o botão "Ativar cashback" para todo mundo. Para
-- as ~1.180 contas que não são do Clube, aquele botão existiria só para falhar
-- (`precisa_ser_do_clube`).
--
-- É a PORTA PINTADA NA PAREDE de 21/09: o botão está lá, com rótulo, na posição
-- certa, e clicar não leva a nada. Com `e_do_clube`, a tela mostra o botão a quem
-- ele serve e, a quem não serve, mostra o caminho de entrar no Clube -- que é a
-- resposta útil, não um erro.
--
-- Vale a regra que isto repete: QUANDO UM NULO SIGNIFICA DUAS COISAS, quem lê
-- tem que adivinhar -- e quem adivinha mostra a coisa errada para alguém.
-- ---------------------------------------------------------------------------

drop function if exists public.cash_minha_carteira();

create or replace function public.cash_minha_carteira()
returns table(cliente_id uuid, nome text, e_do_clube boolean, aderiu boolean,
              acumulado numeric, disponivel numeric, vence_em date, gatilho numeric,
              falta_para_liberar numeric, pode_descer boolean,
              minimo_para_transferir numeric, pode_transferir_ate numeric)
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_cli uuid := cash.cliente_do_usuario();
  v_gatilho numeric := cash.parametro_gatilho();
  v_do_clube boolean;
  v_acumulado numeric;
begin
  if v_uid is null then
    -- Nem logada. A tela desenha a porta de entrar, e não uma carteira vazia que
    -- parece saldo zero.
    return query select null::uuid, ''::text, false, false, 0::numeric, 0::numeric,
                        null::date, v_gatilho, v_gatilho, false, v_gatilho, 0::numeric;
    return;
  end if;

  v_do_clube := exists (select 1 from clube.perfis p where p.id = v_uid);

  if v_cli is null then
    -- Logada, sem conta de cashback. `e_do_clube` é o que decide se a tela
    -- mostra "Ativar" ou "entre no Clube primeiro".
    return query select null::uuid, ''::text, v_do_clube, false, 0::numeric, 0::numeric,
                        null::date, v_gatilho, v_gatilho, false, v_gatilho, 0::numeric;
    return;
  end if;

  v_acumulado := cash.saldo(cash.conta_acumulo(v_cli));
  return query
    select c.id, c.nome, v_do_clube, c.aderiu_em is not null,
           v_acumulado,
           cash.saldo(cash.conta_disponivel(c.id)),
           cash.vence_em_disponivel(c.id),
           v_gatilho,
           greatest(0, round(v_gatilho - v_acumulado, 2)),
           v_acumulado >= v_gatilho,
           v_gatilho,
           case when v_acumulado >= v_gatilho then v_acumulado else 0 end
      from cash.clientes c where c.id = v_cli;
end $$;

-- O `drop` acima levou os grants embora: função recriada é função nova para o
-- Postgres, e nasce aberta a PUBLIC e fechada para o logado.
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
