-- ---------------------------------------------------------------------------
-- Cash -- a cobrança confirmada fica guardada (coluna nova, 08/11).
--
-- Aplicada na produção como `cash_0013_cobranca_confirmada_nao_se_apaga`. Ela é
-- um arquivo separado, e não uma linha a mais no `0001`, porque o `0001` JÁ ESTÁ
-- NA PRODUÇÃO desde 04/10: mexer no `create table` dele faria o repositório
-- contar uma história que não aconteceu. Migration nova para mudança nova.
--
-- O PORQUÊ está no comentário da `cash.confirmar_pagamento` (0006): o livro
-- guarda o que foi movido, e só a cobrança guarda o que as duas partes
-- combinaram antes de mover.
-- ---------------------------------------------------------------------------

alter table cash.pagamentos_pendentes
  add column if not exists confirmado_em timestamptz;

-- O índice é PARCIAL, com o mesmo `where` de quem lê: o balcão e a tela do
-- cliente só perguntam pelas ABERTAS, e essa lista não cresce com o histórico.
create index if not exists pagamentos_abertos_idx
  on cash.pagamentos_pendentes (loja_id, criado_em)
  where confirmado_em is null;
