-- ---------------------------------------------------------------------------
-- Troco Prime -- a faxina das duas sondas de diagnóstico de 04/10 (19/11/2026).
--
-- Na produção: `cash_0022_faxina_das_sondas`.
--
-- `cash._sonda_aspas()` e `cash._sonda_dois_reais()` foram criadas em 04/10 para achar por que a `apply_migration`
-- travava (a causa era o `drop` no começo do comando: regra 6). Ninguém as chama (0 dependentes, medido em 19/11).
-- O `drop` vai dentro de `execute`, num `do`, porque comando que COMEÇA com `drop` para e espera gente.
-- Autorizado por ele em 19/11: "você está autorizado a fazer tudo".
-- ---------------------------------------------------------------------------

do $migracao$
begin
  execute 'drop function if exists cash._sonda_aspas()';
  execute 'drop function if exists cash._sonda_dois_reais()';
end $migracao$;
