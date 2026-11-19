-- ---------------------------------------------------------------------------
-- Troco Prime -- o troco vence SOZINHO, todo dia (19/11/2026).
--
-- Na produção: `cash_0021_vencer_todo_dia`.
--
-- A regra é dele, de 06/09 ("o relógio"): o que a pessoa liberou para gastar vale 30 dias; não gastou, perde, e o
-- que vence vai para o fundo de promoção da rede (não some). O motor sabe vencer desde 04/10 (`cash.vencer_lotes`),
-- mas só quando alguém apertava o botão do administrador -- e esquecer um dia quer dizer saldo vencido aparecendo
-- como disponível, que a pessoa tenta usar e o balcão recusa.
--
-- Roda 07:11 UTC = 04:11 em Brasília, de madrugada, depois da virada do dia (o motor compara com `current_date`).
-- `cron.schedule` com o mesmo nome substitui a rotina, então rodar esta migration de novo não duplica nada.
-- ---------------------------------------------------------------------------

do $migracao$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('troco-prime-vencer', '11 7 * * *', 'select cash.vencer_lotes()');
  end if;
end $migracao$;
