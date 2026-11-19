-- ---------------------------------------------------------------------------
-- Cash -- as regras do cliente "por sócio", para o QR Bio abrir a conta (19/11/2026).
--
-- Na produção: `cash_0019_as_regras_por_socio` (os nomes 0017 e 0018 já existiam lá, de 08/11).
--
-- POR QUÊ. Ele decidiu em 19/11 que a porta do cliente é o QR Bio: a conta do Troco Prime aparece ao lado da
-- carteirinha do Clube, no painel e no app do QR Bio. Só que as funções do cliente (`public.cash_*`) achavam a
-- pessoa por `auth.uid()`, o login do Supabase do Clube, e o QR Bio tem login PRÓPRIO (a sessão em
-- `qrbio.sessoes`). O QR Bio já chega ao sócio do Clube para mostrar a carteirinha (`qrbio.conta_da_casa`, pelo
-- e-mail); faltava o motor aceitar "este sócio" em vez de "quem está logado".
--
-- COMO, sem copiar regra de dinheiro em dois lugares (a regra "mudou num, muda no outro" já mordeu aqui):
--   - cada regra do cliente passa a morar numa função INTERNA, da gaveta, que recebe o sócio: `cash.*_do_membro`;
--   - as `public.cash_*` de sempre viram uma linha: chamam a interna com `auth.uid()`. Mesma assinatura, mesmo
--     retorno, mesmas portas (o `create or replace` guarda os grants);
--   - a ponte do QR Bio (`public.qrbio_troco_*`, no `drrodrigo/qrbio.me`) chama as MESMAS internas com o sócio
--     da sessão do QR Bio.
--
-- O miolo de cada interna é o da função VIVA da produção em 19/11 (lida com `pg_get_functiondef`, não o arquivo:
-- regra 10), com `auth.uid()` trocado por `p_membro`. A gaveta continua fechada: as internas não abrem para
-- `anon` nem para `authenticated` (conferido com `has_function_privilege` no teste `por_socio.sql`).
-- ---------------------------------------------------------------------------

-- 1. A carteira (o saldo, o ciclo dos 30).
create or replace function cash.carteira_do_membro(p_membro uuid)
returns table(cliente_id uuid, nome text, e_do_clube boolean, aderiu boolean, acumulado numeric,
              disponivel numeric, vence_em date, gatilho numeric, falta_para_liberar numeric,
              pode_descer boolean, minimo_para_transferir numeric, pode_transferir_ate numeric)
language plpgsql
set search_path to 'cash', 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := p_membro;
  v_cli uuid := cash.cliente_do_membro(p_membro);
  v_gatilho numeric := cash.parametro_gatilho();
  v_do_clube boolean;
  v_acumulado numeric;
begin
  if v_uid is null then
    return query select null::uuid, ''::text, false, false, 0::numeric, 0::numeric,
                        null::date, v_gatilho, v_gatilho, false, v_gatilho, 0::numeric;
    return;
  end if;

  v_do_clube := exists (select 1 from clube.perfis p where p.id = v_uid);

  if v_cli is null then
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
end $function$;

-- 2. Ativar (o "um toque" que abre a conta, com saldo zero).
create or replace function cash.aderir_membro(p_membro uuid)
returns table(cliente_id uuid, nome text, saldo numeric, aderiu_em timestamp with time zone)
language plpgsql
set search_path to 'cash', 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := p_membro;
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
      using hint = 'A conta corrente de cash é do membro do Clube. Entre no Clube primeiro.';
  end if;

  insert into cash.clientes (clube_membro_id, nome, telefone, aderiu_em)
  values (v_uid, coalesce(v_nome, ''), v_tel, clock_timestamp())
  on conflict (clube_membro_id) where clube_membro_id is not null
  do update set
    aderiu_em = coalesce(cash.clientes.aderiu_em, excluded.aderiu_em),
    nome = case when cash.clientes.nome = '' then excluded.nome else cash.clientes.nome end,
    telefone = coalesce(cash.clientes.telefone, excluded.telefone)
  returning id into v_id;

  return query
    select c.id, c.nome, cash.saldo(cash.conta_acumulo(c.id)), c.aderiu_em
      from cash.clientes c where c.id = v_id;
end $function$;

-- 3. Liberar para gastar (descer do "juntado" para o "pode gastar").
create or replace function cash.descer_do_membro(p_membro uuid, p_valor numeric, p_chave text default null)
returns uuid
language plpgsql
set search_path to 'cash', 'public', 'pg_temp'
as $function$
declare v_cli uuid := cash.cliente_do_membro(p_membro);
begin
  if v_cli is null then raise exception 'precisa_entrar'; end if;
  return cash.descer_para_gastar(v_cli, p_valor, p_chave);
end $function$;

-- 4. As cobranças que a loja pediu e esperam o "sim" do cliente.
create or replace function cash.cobrancas_do_membro(p_membro uuid)
returns table(id uuid, loja_nome text, valor_compra numeric, valor_em_cash numeric, criado_em timestamp with time zone)
language plpgsql
set search_path to 'cash', 'public', 'pg_temp'
as $function$
declare v_cli uuid := cash.cliente_do_membro(p_membro);
begin
  if v_cli is null then return; end if;
  return query
    select p.id, l.nome, p.valor_compra, p.valor_em_cash, p.criado_em
      from cash.pagamentos_pendentes p
      join cash.lojas l on l.id = p.loja_id
     where p.cliente_id = v_cli and p.confirmado_em is null
     order by p.criado_em desc;
end $function$;

-- 5. O "sim" do cliente a uma cobrança (só a cobrança DELE).
create or replace function cash.confirmar_do_membro(p_membro uuid, p_pagamento uuid, p_chave text default null)
returns uuid
language plpgsql
set search_path to 'cash', 'public', 'pg_temp'
as $function$
declare v_cli uuid := cash.cliente_do_membro(p_membro);
begin
  if v_cli is null then raise exception 'precisa_entrar'; end if;
  if not exists (select 1 from cash.pagamentos_pendentes
                  where id = p_pagamento and cliente_id = v_cli and confirmado_em is null) then
    raise exception 'cobranca_nao_encontrada';
  end if;
  return cash.confirmar_pagamento(p_pagamento, p_chave);
end $function$;

-- 6. O extrato.
create or replace function cash.extrato_do_membro(p_membro uuid, p_limite integer default 50)
returns table(em timestamp with time zone, tipo text, valor numeric, valor_compra numeric, descricao text)
language plpgsql
set search_path to 'cash', 'public', 'pg_temp'
as $function$
declare v_cli uuid := cash.cliente_do_membro(p_membro);
begin
  if v_cli is null then return; end if;
  return query
    select l.em, l.tipo::text, l.valor, l.valor_compra, l.descricao
      from cash.lancamentos l
     where l.conta_origem like 'cliente:' || v_cli::text || '%'
        or l.conta_destino like 'cliente:' || v_cli::text || '%'
     order by l.em desc
     limit greatest(1, least(p_limite, 200));
end $function$;

-- 7. O que só vale numa loja (o "terceiro saldo").
create or replace function cash.restritos_do_membro(p_membro uuid)
returns table(loja_id uuid, loja_nome text, valor numeric, vence_em date)
language plpgsql
set search_path to 'cash', 'public', 'pg_temp'
as $function$
declare v_cli uuid := cash.cliente_do_membro(p_membro);
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
end $function$;

-- As de sempre, agora uma linha cada (mesma assinatura e retorno: o `create or replace` guarda as portas).
create or replace function public.cash_minha_carteira()
returns table(cliente_id uuid, nome text, e_do_clube boolean, aderiu boolean, acumulado numeric,
              disponivel numeric, vence_em date, gatilho numeric, falta_para_liberar numeric,
              pode_descer boolean, minimo_para_transferir numeric, pode_transferir_ate numeric)
language sql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $function$ select * from cash.carteira_do_membro(auth.uid()) $function$;

create or replace function public.cash_aderir()
returns table(cliente_id uuid, nome text, saldo numeric, aderiu_em timestamp with time zone)
language sql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $function$ select * from cash.aderir_membro(auth.uid()) $function$;

create or replace function public.cash_descer(p_valor numeric, p_chave text default null)
returns uuid
language sql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $function$ select cash.descer_do_membro(auth.uid(), p_valor, p_chave) $function$;

create or replace function public.cash_minhas_cobrancas()
returns table(id uuid, loja_nome text, valor_compra numeric, valor_em_cash numeric, criado_em timestamp with time zone)
language sql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $function$ select * from cash.cobrancas_do_membro(auth.uid()) $function$;

create or replace function public.cash_confirmar(p_pagamento uuid, p_chave text default null)
returns uuid
language sql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $function$ select cash.confirmar_do_membro(auth.uid(), p_pagamento, p_chave) $function$;

create or replace function public.cash_meu_extrato(p_limite integer default 50)
returns table(em timestamp with time zone, tipo text, valor numeric, valor_compra numeric, descricao text)
language sql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $function$ select * from cash.extrato_do_membro(auth.uid(), p_limite) $function$;

create or replace function public.cash_meus_restritos()
returns table(loja_id uuid, loja_nome text, valor numeric, vence_em date)
language sql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $function$ select * from cash.restritos_do_membro(auth.uid()) $function$;

-- As internas: a gaveta é fechada (as duas portas, `public` e `anon`, e também `authenticated`).
do $portas$
declare f text;
begin
  foreach f in array array[
    'cash.carteira_do_membro(uuid)', 'cash.aderir_membro(uuid)', 'cash.descer_do_membro(uuid, numeric, text)',
    'cash.cobrancas_do_membro(uuid)', 'cash.confirmar_do_membro(uuid, uuid, text)',
    'cash.extrato_do_membro(uuid, integer)', 'cash.restritos_do_membro(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $portas$;
