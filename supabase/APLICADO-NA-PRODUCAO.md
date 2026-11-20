# O que está no ar, no banco, para o cash (08/11/2026)

Este arquivo existe porque **o repositório não prova a produção**. Ele diz quais migrations
subiram, com que nome, e como conferir — sem acreditar em arquivo nenhum.

## Como conferir (é a única leitura que vale)

Planta o banco de mentira com os arquivos do repositório e compara o **miolo** de cada função
(sem comentário, espaço colapsado) com a produção:

```sql
-- rode nos dois lados e compare as listas
select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')  ==>  '
       || md5(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'cash' or (n.nspname = 'public' and p.proname like 'cash\_%')
order by 1;
```

```bash
bash scripts/banco-de-mentira.sh --testes   # 81 passos
```

Em 08/11 as **56 funções** bateram (na terceira volta: as duas primeiras acharam defeito). Fora da lista ficam, de propósito:

| o que | por quê |
|---|---|
| `public.cash_dist(money, money)` | é do **Postgres** (operador do tipo `money`), não minha. Tem que continuar aberta ao `anon`. |
| ~~`cash._sonda_aspas()`, `cash._sonda_dois_reais()`~~ | apagadas em 19/11 (`cash_0022_faxina_das_sondas`). |

## As migrations, na ordem em que subiram

| nome na produção | arquivo | o que fez |
|---|---|---|
| `cash_0001_livro_razao` … `cash_0005_pedir_pagamento` | `0001`–`0005` | a gaveta, o motor de lotes, depósito, cashback, descida, cobrança (04/10) |
| `cash_0007_sacar` | `0007` | reciclar e sacar |
| `cash_0013_cobranca_confirmada_nao_se_apaga` | `0013` | coluna `confirmado_em` + índice parcial `pagamentos_abertos_idx` |
| `cash_0006_confirmar_pagamento` | `0006` | a confirmação **carimba** em vez de apagar |
| `cash_0008_achar_ou_criar_cliente` | dentro da `0009` | o cliente achado pelo telefone |
| `cash_0009a` … `cash_0009l` | `0009` | a fronteira: tabelas do elo com o Clube, `saques_pedidos`, quem é quem, as 27 funções `public.cash_*` e as portas |
| `cash_0011_minimo_para_transferir` | `0011` | o piso de 30 na transferência |
| `cash_0010_adesao_e_ciclo` | `0010` | a adesão por clique, o ciclo visível, cidade/UF e a busca |
| `cash_0012_minha_carteira` | `0012` | a tela sabe se a pessoa é do Clube |
| `cash_0016_devolve_o_conserto_que_eu_desfiz` + `cash_0017_as_portas_outra_vez` | `0016` | **conserto de um erro meu**: ver abaixo |
| `cash_0018_o_mapa_volta_a_agrupar_por_cidade` | `0010` | a terceira coisa que o mesmo erro derrubou: o mapa ordenava por cidade |
| `cash_0019_as_regras_por_socio` (19/11) | `0019` | as regras do cliente viram internas "por sócio" (`cash.*_do_membro`), fechadas; as 7 `public.cash_*` do cliente viram uma linha que chama a interna com `auth.uid()`. É a porta do QR Bio (`qrbio_troco_*`, no `drrodrigo/qrbio.me`). Antes de subir, o miolo vivo das 7 bateu com o copiado; depois, as 14 bateram com o arquivo (md5) e as portas ficaram como eram (públicas: `authenticated` sim, `anon` não; internas: só `service_role`) |
| `cash_0020a_o_elo_com_o_qrunico_e_a_busca` (19/11) | `0020` | `cash.lojas` ganha `qrunico_usuario_id` e `dono_email`; a busca do administrador no Catálogo e no QR Único; vincular empresa do QR Único |
| `cash_0020b_lojas_do_admin_e_o_balcao_do_qrunico` (19/11) | `0020` | a loja do Catálogo passa a vir com cidade/UF; `cash_admin_lojas()`; `cash.loja_do_usuario()` abre o balcão do QR Único para a conta com o mesmo e-mail **confirmado** |
| `cash_0020c_cidade_sem_espaco` (19/11) | `0020` | conserto achado na produção: o QR Único guarda `"Belo Horizonte "` e `"MG "`; a busca e o vínculo tiram o espaço (o mapa agrupa por cidade). Depois de subir, os 5 miolos bateram com o banco de mentira (md5) |
| `cash_0021_vencer_todo_dia` (19/11) | `0021` | a rotina `troco-prime-vencer` (`11 7 * * *` UTC = 04:11 em Brasília) roda `cash.vencer_lotes()` todo dia |
| `cash_0022_faxina_das_sondas` (19/11) | `0022` | apagou `cash._sonda_aspas()` e `cash._sonda_dois_reais()` (lixo de 04/10, 0 dependentes). Depois: 0 sondas, 30 `public.cash_*`, nenhuma aberta ao `anon`, a conta fecha |
| `cash_0023_troco_sem_dobro_e_desconto_no_caixa` (19/11) | `0023` | decisão dele: o troco é o % da loja, **sem dobro** (`multiplicador_presencial` 2 → 1; com 2, R$ 200 numa loja de 10% lançava 40 e o balcão dizia 20); `cash.lojas.desconto_no_caixa` (0 = só troco); `cash_admin_regras_da_loja`; `cash_minha_loja` e `cash_admin_lojas` recriadas com a coluna nova. Depois: os 3 miolos bateram com o banco de mentira (md5), nenhuma `public.cash_*` aberta ao `anon` |
| `cash_0024_lojas_da_rede_com_regras` (19/11) | `0024` | pedido do QR Bio: `public.cash_lojas_da_rede_com_regras(p_busca)`, as MESMAS colunas da `cash_lojas_da_rede` mais `desconto_no_caixa` (o "Onde usar" dele mostra "10% de desconto + 10% de troco"). A busca mora num lugar só: ela LÊ a irmã. Depois: miolo igual ao banco de mentira (md5 `904d31a0…`), `anon` não, `authenticated` sim, 0 `public.cash_*` abertas ao `anon` |
| `cash_0025_a_carteirinha_no_app` (19/11) | `0025` | pedido dele (*"clicar na carteirinha (...) aí a carteirinha aparece (...) com o QR Code"*): `public.cash_minha_carteirinha()` e `public.cash_qr_da_carteirinha()`, portas para as funções FECHADAS do Clube (`clube.carteirinha_de`, `clube.emitir_token_de`), como o QR Bio faz. Depois: os 2 miolos iguais ao banco de mentira (md5 `487ce5e8…` e `65ad9f61…`), `anon` não, `authenticated` sim, 0 `public.cash_*` abertas ao `anon` (34 no total); uma carteirinha de verdade lida no formato certo (bloco desfeito, sem emitir QR) |
| `cash_0027_recarga_por_pix` (19/11) | `0027` | pedido dele: a loja põe crédito por Pix (mínimo R$ 100, `cash.parametros.recarga_minima`), "no automático" (Mercado Pago). `cash.recargas` (RLS ligada, sem policy), `cash.e_servidor()`, `cash_pedir_recarga`, `cash_servidor_cobranca_da_recarga` e `cash_servidor_baixa_da_recarga` (só o servidor: o logado leva `so_servidor`, conferido na produção), `cash_minhas_recargas`, `cash_admin_recargas`, `cash_admin_confirmar_recarga`. Depois: os 7 miolos iguais ao banco de mentira (md5), 0 `public.cash_*` abertas ao `anon`. Funções de borda `troco-recarga` e `troco-pix-webhook` publicadas (v1, `verify_jwt: false`, com `../_troco/mercadopago.ts`); sondas `{ligado:true}`; aviso falso de pagamento → 502 sem crédito |

## 🔴 As três lições que esta aplicação custou

**1. `apply_migration` com `drop` PARA E ESPERA GENTE**, e estoura em 60 s. Foi o que matou a
`confirmar_pagamento` sete vezes em 04/10, e eu culpei o tamanho do envio — errado, um comando
de 50 bytes falhava igual. `delete` faz o mesmo. Dois consertos saíram disso, os dois melhores
que o plano original: a cobrança **carimba** em vez de apagar (e fica como prova do acordo), e
o telefone só perdeu o `not null` — a restrição `unique` ficou, porque `unique` no Postgres
aceita quantos `NULL` quiser. `drop` dentro de `execute`, num `do $migracao$`, passa; o que a
ferramenta recusa é comando que **começa** com `drop`.

**2. Aplicar a 0009 DEPOIS da 0010 desfez conserto novo** (a regra 10). As duas definem as
mesmas funções, o Postgres não reclama, e a última a subir ganha — ganhou a velha. Voltaram
para trás a guarda `membro_nao_ativou` do balcão (quem não ativou virou **lista vazia** em vez
de "ativa aí") e a cópia de cidade/UF (mapa e busca nascendo vazios). A `0016` devolve as duas.

**3. O teste do repositório não acharia isso, e não achou.** Ele planta os arquivos na ordem,
então o banco de mentira sempre teve a versão boa. Quem achou foi a comparação
`pg_get_functiondef` da produção contra o banco de mentira, função por função — a tabela no
começo deste arquivo. Depois de aplicar coisa fora de ordem, é a única leitura que vale.

**4. E a busca sem acento rachou o par banco/navegador.** Pôr o `translate` no banco deixou o
filtro do navegador (`filtrarLojas`, a segunda camada que responde enquanto ela digita) com a
regra ANTIGA: o banco devolvia a loja de "São João" para quem digitou "sao joao", e o
navegador tirava ela da lista de novo. O comentário da própria função já avisava do risco
("se divergirem, a lista pula na mão dela") e eu mexi em um lado só. Mudança em regra
duplicada é mudança nos DOIS lados, na mesma entrega — está medido em
`cash/src/carteira/tela.test.ts` ("a busca ignora o acento, nos dois lados").

## O que falta neste banco

- ~~Apagar as duas sondas~~: **apagadas em 19/11** (`cash_0022_faxina_das_sondas`).
- **Zero loja, zero cliente, zero movimento.** A gaveta está de pé e vazia: nada do que subiu
  encostou em dado de ninguém.
