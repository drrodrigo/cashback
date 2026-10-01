-- As regras da gaveta, medidas no banco em vez de lidas no arquivo.
--
-- Cada uma destas existe porque já falhou em algum produto do ecossistema, e nenhuma
-- aparece lendo o `.sql`: `revoke` escrito não prova porta fechada (são duas portas),
-- e grant que falta não dá erro -- dá silêncio, três dias depois, numa Edge Function.
--
-- Roda com: bash bipechat/scripts/banco-de-mentira.sh --raiz cash --testes

do $$
declare
  r text := E'\n';
  v_falhas int := 0;

  v_ok boolean;
  v_n int;
begin
  -- 1. A gaveta é fechada: o visitante não tem nem usage.
  v_ok := has_schema_privilege('anon', 'cash', 'usage') is false;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'anon nao tem usage no schema cash' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 2. E o logado também não -- quem serve a tela é a função em public, não a tabela.
  v_ok := has_schema_privilege('authenticated', 'cash', 'usage') is false;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'authenticated nao tem usage no schema cash' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 3. A porta da função: fechar são DUAS coisas (public e anon). Medir, não ler.
  v_ok := has_function_privilege('anon', 'public.cash_conferencia()', 'execute') is false;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'anon nao executa public.cash_conferencia()' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  v_ok := has_function_privilege('authenticated', 'public.cash_conferencia()', 'execute');
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'authenticated executa public.cash_conferencia()' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 4. A chave de serviço: gaveta nova nao herda nada. Foi isso que deixou o schema
  --    autobipe com ZERO grant em 19/09, e nenhum teste de RLS enxerga.
  v_ok := has_schema_privilege('service_role', 'cash', 'usage');
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'service_role tem usage no schema cash' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- `pg_tables`, e não `information_schema.tables`: ali o Postgres reordena o predicado
  -- e chega a chamar `has_table_privilege` com tabela de sistema que o filtro de schema
  -- deveria ter excluído -- a consulta estoura em `cash.pg_statistic` não existe.
  select count(*) into v_n
    from pg_tables t
   where t.schemaname = 'cash'
     and not has_table_privilege('service_role', format('%I.%I', t.schemaname, t.tablename), 'select');
  v_ok := v_n = 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'service_role le todas as tabelas (sem grant: ' || v_n || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 5. E os default privileges, senão a PRÓXIMA tabela nasce fora do alcance dele.
  select count(*) into v_n from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
   where n.nspname = 'cash' and array_to_string(d.defaclacl, ',') like '%service_role%';
  v_ok := v_n > 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'default privileges do service_role existem na gaveta' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 6. RLS ligada em tudo, e ZERO policy: ninguém lê tabela direto, nem por engano.
  select count(*) into v_n from pg_tables where schemaname = 'cash' and not rowsecurity;
  v_ok := v_n = 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'todas as tabelas com RLS ligada (sem: ' || v_n || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  select count(*) into v_n from pg_policies where schemaname = 'cash';
  v_ok := v_n = 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'nenhuma policy na gaveta (achadas: ' || v_n || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 7. Nenhum rebite atravessa a fronteira. É o que torna `pg_dump --schema=cash`
  --    possível no dia de separar -- e é a dívida que o BipeChat já tem.
  select count(*) into v_n
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace tn on tn.oid = t.relnamespace
    join pg_class f on f.oid = c.confrelid
    join pg_namespace fn on fn.oid = f.relnamespace
   where c.contype = 'f' and tn.nspname = 'cash' and fn.nspname <> 'cash';
  v_ok := v_n = 0;
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'nenhuma chave estrangeira sai da gaveta (achadas: ' || v_n || ')' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 8. A conferência responde, e no banco vazio ela fecha: zero cash para zero custódia.
  select fecha into v_ok from public.cash_conferencia();
  r := r || case when v_ok then '[ok]     ' else '[FALHOU] ' end
         || 'public.cash_conferencia() fecha no banco vazio' || E'\n';
  if v_ok is not true then v_falhas := v_falhas + 1; end if;

  -- 9. E ela ACUSA quando não fecha -- trava que não trava é pior que trava nenhuma,
  --    então aqui a gente desequilibra de propósito e exige o vermelho.
  insert into cash.lotes (conta, valor, emissor) values ('teste:desequilibrio', 10, 'teste');
  select fecha into v_ok from public.cash_conferencia();
  r := r || case when v_ok is false then '[ok]     ' else '[FALHOU] ' end
         || 'a conferencia acusa 10 de cash sem lastro' || E'\n';
  if v_ok is not false then v_falhas := v_falhas + 1; end if;
  delete from cash.lotes where conta = 'teste:desequilibrio';

  r := r || E'\n' || case when v_falhas = 0 then 'tudo certo' else v_falhas || ' FALHOU' end;
  raise exception 'RESULTADO >>> %', r;
end $$;
