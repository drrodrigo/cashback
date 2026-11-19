-- ---------------------------------------------------------------------------
-- 0025 — A CARTEIRINHA DENTRO DO APLICATIVO (19/11)
--
-- Ele, 19/11: *"clicar na carteirinha ali também (...) Carteirinha, número tal, ela clica, aí a carteirinha aparece (...)
-- mostrar a carteirinha com o QR Code para fazer a transferência do troco"*.
--
-- Até aqui o /app mandava o cliente ao QR Bio para mostrar o QR. Agora a carteirinha aparece no próprio Troco Prime: o
-- cartão (nome, número, nível) e, num toque, o QR de 90 segundos que o balcão lê.
--
-- QUEM MANDA NA CARTEIRINHA CONTINUA SENDO O CLUBE. Estas duas são só a porta, do mesmo jeito que o QR Bio faz
-- (`qrbio_clube`, `qrbio_clube_token`): chamam as funções FECHADAS do Clube (`clube.carteirinha_de`,
-- `clube.emitir_token_de`) com o `auth.uid()` de quem está logado. Nada se copia; nenhum dado do Clube mora no `cash`.
-- O QR leva o mesmo endereço do Clube (`https://www.clubeprime.com.br/validar#<token>`), que o balcão já lê.
--
-- Os erros saem nos códigos que a tela já traduz: `precisa_entrar`, `precisa_ser_do_clube`, `carteirinha_inativa`.
-- ---------------------------------------------------------------------------

create or replace function public.cash_minha_carteirinha()
returns table(nome text, codigo_publico text, nivel text, prime_ate date, prime_em_dia boolean,
              membro_desde timestamptz, ativa boolean)
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
declare
  v jsonb;
begin
  if auth.uid() is null then raise exception 'precisa_entrar'; end if;
  v := clube.carteirinha_de(auth.uid());
  if v is null then raise exception 'precisa_ser_do_clube'; end if;
  return query
    select v->>'nome', v->>'codigo_publico', v->>'nivel', (v->>'prime_ate')::date,
           coalesce((v->>'prime_em_dia')::boolean, false), (v->>'membro_desde')::timestamptz,
           coalesce((v->>'ativa')::boolean, false);
end $$;

comment on function public.cash_minha_carteirinha() is
  'A carteirinha do Clube de quem está logado, para o Troco Prime mostrar (0025). Lê clube.carteirinha_de.';

create or replace function public.cash_qr_da_carteirinha()
returns table(token text, expira_em timestamptz)
language plpgsql security definer
set search_path to 'cash', 'public', 'pg_temp'
as $$
begin
  if auth.uid() is null then raise exception 'precisa_entrar'; end if;
  begin
    return query select t.token, t.expira_em from clube.emitir_token_de(auth.uid()) t;
  exception when others then
    -- O Clube fala em português na mensagem; a tela lê o código.
    if sqlerrm like '%inativa%' then raise exception 'carteirinha_inativa'; end if;
    raise exception 'precisa_ser_do_clube';
  end;
end $$;

comment on function public.cash_qr_da_carteirinha() is
  'O QR de 90 s da carteirinha de quem está logado (0025). Emite pelo clube.emitir_token_de; o balcão lê.';

-- As portas: a varredura de sempre sobre as `public.cash_*`, menos as de extensão (a `cash_dist` do btree_gist).
do $portas$
declare f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'cash\_%'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public, anon', f.assinatura);
    execute format('grant execute on function %s to authenticated, service_role', f.assinatura);
  end loop;
end $portas$;
