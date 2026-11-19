# CLAUDE.md — Troco Prime

> **Este repositório nasceu em 08/11/2026**, por `git subtree split` da pasta `cash/` do
> [`drrodrigo/catologoonline`](https://github.com/drrodrigo/catologoonline), guardando os 10
> commits de história. O motivo foi dele: *"eu quero separado do catálogo pq tá aumentando meu
> custo que toda vez que atualiza um atualiza o outro e eu pago mais caro"*.
>
> **Em 19/11 virou `drrodrigo/trocoprime`** (antes `drrodrigo/cashback`; o GitHub redireciona o nome antigo), a pedido
> dele: *"troca o cashback para ele e vamos começar a vida nova"*. O projeto da Vercel virou `trocoprime`, e o site é
> **trocoprime.com.br**. Os nomes internos do banco (`cash.*`, `public.cash_*`) ficam como estão.

## 🔴 Quem cuida (19/11, à noite)

**A conversa própria do Troco Prime** (a que nasceu como "Resumo decisões Troco Prime"), a pedido dele: *"pode usar o
repositório cashback nesta conversa"*. Ela cuida deste repositório, da gaveta `cash` (`cash.*` e `public.cash_*`), do
balcão, dos lojistas e do domínio.

**A conversa do QR Bio** (`drrodrigo/qrbio`) cuida do perfil e da carteirinha do Clube Prime, e **mostra** o saldo do Troco
Prime ao lado da carteirinha, pela fronteira `public.cash_*`. Ela não muda `cash.*` nem `public.cash_*`: quando precisar de
função nova, pede para a conversa do Troco Prime. (Antes, ainda em 19/11, a ordem tinha sido o contrário: *"você vai ser o
Troco Prime"*, dito à conversa do QR Bio. A de agora é a que vale.)

**O que o Troco Prime é, na voz dele (19/11):** *"O Troco Prime, ele é uma composição do Clube Prime. Ele é um gerenciamento
do desconto do Clube Prime. Então, a pessoa, para ter o Troco Prime, ela tem que fazer parte do Clube Prime. E o perfil, a
carteirinha do Clube Prime, é gerida pelo QR Bio."* E: *"uma conta corrente (...) adicionar e subtrair saldo (...) funcionando
como se fosse um Pix"* — entre o cliente e a loja; o saldo **não** passa de uma pessoa para outra (é o que mantém isto como
programa de fidelidade). O mapa dos produtos: `drrodrigo/qrbio`, `docs/O-CAMINHO.md`.

### 🔴 O contrato com o QR Bio (no ar desde 19/11; conferido no banco vivo em 19/11)

O QR Bio tem login próprio, então a ponte dele (`public.qrbio_troco*`, no `drrodrigo/qrbio.me` #26) **não** usa as
`public.cash_*` do cliente (que acham a pessoa por `auth.uid()`). Ela acha o sócio pelo e-mail e chama, por dentro:

- as 7 internas "por sócio" da migration `0019`, só `service_role`: `cash.carteira_do_membro(uuid)`,
  `cash.aderir_membro(uuid)`, `cash.descer_do_membro(uuid, numeric, text)`, `cash.cobrancas_do_membro(uuid)`,
  `cash.confirmar_do_membro(uuid, uuid, text)`, `cash.extrato_do_membro(uuid, integer)`, `cash.restritos_do_membro(uuid)`;
- `public.cash_lojas_da_rede(p_busca text)` (`loja_id, nome, cashback_percentual, cidade, uf, catalogo_slug`).

**Os códigos de erro que a ponte lê pelo texto** (`sqlerrm`): `precisa_ser_do_clube`, `gatilho_nao_alcancado`,
`abaixo_do_minimo`, `saldo_insuficiente`, `valor_invalido`, `precisa_entrar`, `cobranca_nao_encontrada`,
`cash_passa_da_compra`. A chave de idempotência que ela manda começa com `qrbio:`.

**Mudar nome, assinatura, coluna devolvida ou código de erro de qualquer um desses = avisar a conversa do QR Bio ANTES**
(`send_message`), para a ponte mudar junto. E a regra do cliente agora **mora na interna**: as 7 `public.cash_*` do cliente
são uma linha que chama a interna com `auth.uid()`. Arquivo velho que der `create or replace` numa delas põe a regra de volta
em dois lugares (a regra 7, abaixo) — mude a interna.

## O que é

Cashback com moeda própria: em vez de dar desconto, a loja devolve **cash**, que o cliente
gasta em qualquer loja da rede. Desconto sai do caixa hoje; cash só é pago quando o cliente
volta.

O cliente **é o membro do Clube Prime** — não existe cadastro novo, nem login novo. A conta
corrente dele nasce de um clique ("ativar"), com saldo zero, e o cashback é um **módulo dentro
do Clube**: palavras dele, *"estão juntos, mas estão separados"*.

**A regra do ciclo, na voz dele:** *"toda vez que ele tirar R$ 30 ele tem que botar R$ 30 (...)
ele tem que juntar, criar a vontade de juntar os 30. Quando ele estiver com 20, ele fala: falta
só 10, vou gastar na loja que tem cashback."* Juntar não tem teto; a transferência tem piso (o
gatilho, hoje 30); e o que foi transferido se gasta em **qualquer** loja parceira, não só na que
deu o crédito.

## O estado, e como conferir (não acredite neste arquivo)

O banco está **no ar** desde 08/11: a gaveta `cash` e as funções da fronteira (30 em 19/11)
(`public.cash_*`). O que exatamente subiu, o nome de cada migration na produção e **o SQL da
conferência** estão em [`supabase/APLICADO-NA-PRODUCAO.md`](supabase/APLICADO-NA-PRODUCAO.md).

🔴 **A conferência que vale é comparar o MIOLO de cada função do repositório com a função
VIVA** (md5 sem comentário, espaço colapsado). Em 08/11 ela achou três consertos que tinham
voltado atrás — e o teste do repositório estava **verde** nos três, porque ele planta os
arquivos na ordem e a produção não tinha a mesma ordem.

## Comandos

```bash
npm install                 # na 1a vez precisa de --legacy-peer-deps (ver vitest.config.ts)
npm test                    # 148 testes (o motor, as telas -- carteira, balcão, administrador -- e a trava do nome)
npm run build               # com as VITE_*; sem elas o `assets/dados-*.js` sai com 2,8 kB
                            # em vez de 219 kB (olhe ESSE arquivo, não o index-*.js)
npm run dev

bash scripts/banco-de-mentira.sh --testes   # 124 passos num Postgres descartável, de graça
```

## O banco é COMPARTILHADO, e isso tem regras

O cashback usa o mesmo projeto Supabase de todos os produtos da casa (`ymszgqpgxtprkqxjhtwb`),
numa **gaveta própria**: o schema `cash`. Quebrar uma destas transforma "separar um dia" numa
migração de dado de gente:

1. **A gaveta é fechada.** Nem `anon` nem `authenticated` têm `usage` em `cash`. Quem serve a
   tela é a lista curta de funções `security definer` em `public` (`public.cash_*`) — a
   fronteira. No dia de separar o produto, é ela que vira chamada de API.
2. **Nenhuma chave estrangeira atravessa schema.** O elo com o Clube e com o Catálogo é `uuid`
   solto, com índice, mais a **cópia** do que a tela mostra (nome, cidade, UF, telefone).
3. **Dado de referência se copia**, não se lê do vizinho.
4. **Fechar função é `from public, anon`, as duas**, e se confere com
   `has_function_privilege('anon', '...', 'execute')` = `false` — nunca lendo o arquivo.
5. **Migration primeiro no banco de mentira**, de graça. Destrutivo (`drop`, `delete` sem
   `where`) só com confirmação dele no chat.
6. 🔴 **`apply_migration` com `drop` PARA E ESPERA GENTE**, e estoura em 60 s. O que ela recusa
   é comando que **começa** com `drop`: dentro de um `execute`, passa. Foi isso que matou a
   `confirmar_pagamento` sete vezes em 04/10 — e o desvio saiu melhor que o plano (a cobrança
   se **carimba** em vez de ser apagada, e fica como prova do acordo).
7. 🔴 **`create or replace` numa migration aplicada FORA DE ORDEM desfaz conserto novo.** A
   última a subir ganha, o Postgres não reclama, e o teste do repositório fica verde.

## Travas e testes

- **Toda trava nova é FALSIFICADA**, pelo caminho mais esperto. Se passou verde, a primeira
  pergunta é se o defeito chegou a existir.
- **Caso de teste com CONFLITO**, não caminho feliz: o `falta_para_liberar` só foi medido de
  verdade com alguém que ADERIU e tem saldo abaixo do gatilho — os dois casos anteriores
  passavam com o cálculo zerado à força.
- **Regra que mora em dois lugares muda nos DOIS na mesma entrega.** A busca de lojas existe no
  banco e no navegador; pôr o "ignora acento" só no banco fez a lista **pular** na mão dela.
- **Leia a saída, não o código de saída.** Em 08/11, sem o `jsdom` declarado aqui, o `npm test`
  dizia "Test Files 1 passed" com **25 testes desaparecidos** (saía com 1, mas a linha verde
  enganava).
- **O dinheiro tem dois motores de propósito** (`src/nucleo/livro.ts` e as funções `cash.*`), com
  os mesmos casos. **Quem manda é o banco** — regra de dinheiro no navegador é sugestão.

## Como falar com ele

- **Sempre em português do Brasil.** Ele não lê inglês — toda linha que ele vê, inclusive o
  recado curto entre um passo e outro.
- **O PASSO PRIMEIRO, O PORQUÊ DEPOIS.** Quando ele tem que fazer algo: 👉 a ação no
  imperativo na primeira linha, com o link da tela exata; passos numerados, um clique por
  passo, com o nome do botão como está na tela; o valor pronto para copiar num bloco; e a
  palavra que ele manda de volta. **Uma ação por resposta.**
- 🔴 **Chave não vai pelo chat**: o aplicativo mascara (`eyJhbGci•••`) e ele copia a máscara.
  Valor com cara de chave ele copia de uma TELA que mostra o valor inteiro.
- **Terminou e está no ar: mande o link da PÁGINA afetada**, nunca de GitHub, PR ou commit.
  Sem página para mostrar, diga isso.
- **Modo autônomo:** pesquise, escreva a spec, execute tudo sem parar para perguntar, e volte
  quando terminar, com o relatório do que foi testado. Pare só em bloqueio real.

## O que ele decidiu em 19/11 (na conversa do QR Bio)

> *"O Clube Prime, ele oferece desconto (...) é 10% de desconto. E aí a gente tem um Clube de Oferta Prime, que é acima de
> 15% de desconto. E boa parte disso aí, a ideia era transformar isso em cashback, ou seja (...) ele paga o 100, tá? E
> recebe 20 reais dentro da conta do cashback, que seria uma carteira (...) seria em pontos. Aí ele poderia pegar esse
> dinheiro e comprar em outras lojas (...) ele tem que chegar a 30 para poder gastar (...) Chegou em 30, 40, 50, ele libera
> e gasta, e aí ele junta de novo."*

- 🟢 **Fechado em 19/11, à noite (na conversa do Troco Prime), e já no banco (`0023`):** *"em vez de dar o desconto em
  dinheiro, a gente vai dar em crédito para gastar dentro da nossa rede (...) se um produto custa 100 e ele colocou 20%
  de desconto, ele coloca 20% no saldo do associado do clube (...) ele pode também ter uma versão que ele dá o desconto e
  ainda dá o troco (...) aqui você ganha 10% de desconto e ainda ganha mais 10% de cashback."*
  - **O troco é o % da loja, SEM DOBRO.** A regra de 06/09 do dobro na compra presencial estava ligada
    (`multiplicador_presencial = 2`) e o balcão manda toda compra como presencial: R$ 200 numa loja de 10% lançaria 40,
    com a tela dizendo 20. Desligada (1). O botão segue em `cash.parametros`, para uma campanha um dia.
  - **Duas formas de a loja premiar**, nas regras de cada loja (`cash_admin_regras_da_loja`, tela `/admin`):
    **só troco** (`desconto_no_caixa` = 0, troco 20%) ou **desconto no caixa + troco** (10% + 10%). O desconto no caixa
    a loja aplica no preço; o Troco Prime guarda e MOSTRA (o balcão diz "Dá 10% de desconto no caixa e ainda devolve 10%
    em troco" e pede o **valor pago**, já com o desconto). O troco é o % sobre o valor que o vendedor digita.
  - Desconto + troco passando de 100% é recusado (`regras_passam_de_100`).
- **O percentual é o DESCONTO DO CLUBE, da loja inteira** (não por produto): o Clube Prime dá 10%, o Clube de Ofertas Prime
  15% ou mais. Em vez de abater, a loja cobra o preço cheio e devolve o percentual em pontos (paga 100, ganha 20). É o
  percentual da LOJA que já existe no motor.
- **Ponto = R$ 1**, e se fala **"pontos"** (na voz dele: *"seria em pontos"*). Dois saldos: o que **junta** (travado) e o
  que **libera** para gastar, a partir de **30** (pode esperar 40, 50), em qualquer loja da rede; depois volta a juntar. É
  a regra que o motor já tem.
- **O parceiro pode dar MAIS pontos além do desconto** (caminho, ainda em desenho; na voz dele: *"eu dou 10% mais 5 (...)
  todo produto que você comprar aqui, você tem, além do 10%, você tem ainda mais 5 (...) ou mais 10 (...) a gente tem que
  ir bolando isso aí, porque isso ainda não está muito bem estruturado não, mas esse é o caminho"*). Ou seja, duas formas
  de o parceiro premiar:
  - o desconto do Clube **vira pontos** (paga 100, ganha 10 ou 20);
  - **ou dá o desconto E pontos a mais**, fixos por produto ou por compra (10% + 5 pontos).

  O "desconto + troco" em percentual da loja inteira está feito (`0023`, acima). **"Pontos fixos por produto"** (o "+5
  pontos" em cada produto) continua regra nova: desenhar com ele antes de programar.
  O §5 do desenho já tem uma parente ("cashback em dobro na loja") e o terceiro saldo do §1 (o extra que só vale naquela
  loja).
- **A porta do cliente é o QR Bio** (a captação do Clube): a conta do cashback aparece ao lado da carteirinha. A escada
  inteira (QR Bio → QR Único → Catálogo) está em `drrodrigo/qrbio`, `docs/2026-11-19-a-escada.md`.
- **O nome:** "QR Cash" ele achou registrado; ele pensou em **"QR Coin"**, e pediu para ver a legalidade.
  - Medido em 19/11: **"QR Coin" já é o nome de uma criptomoeda** (o token `$QR` da rede Base, listado no CoinGecko, sem
    contrato auditado), e "QR Capital" é uma gestora de criptoativos grande no Brasil. O nome puxa para cripto, que é
    justamente o que este programa NÃO é.
  - A regra do §7 do desenho continua: **o que mantém isto como programa de fidelidade são os fatos** (o cliente não compra
    pontos com dinheiro, não saca, não transfere), e na comunicação se fala **"pontos"**, nunca "moeda" ou "meio de
    pagamento".
  - 🟢 **Escolhido em 19/11: TROCO PRIME** (*"faz sentido"*, à recomendação). "Troco" é o que volta da compra, todo
    brasileiro entende, sem cara de cripto nem de banco; "Troco Prime" junto é registrável (só "troco" seria palavra
    comum). Na frase do balcão: *"você tem 30 de troco; paga 70 e usa o troco"*. O domínio **trocoprime.com.br foi
    REGISTRADO por ele em 19/11** (registro.br; titular Rodrigo Rodrigues; DNS ainda os do registro.br, `a/b.auto.dns.br`;
    no dia, "aguardando ativação", o pagamento). Apontar para o site (Vercel) é pôr no ar: só com o OK dele, quando o
    projeto da Vercel existir. O `detroco.com.br` (o "de troco" da fala) ficou livre e sem registro. Antes de imprimir: a busca no
    INPI e um advogado.
  - No código: `src/marca.ts` (nome "Troco Prime", unidade "troco", "30,00 de troco"). **Toda frase de tela lê o nome
    de lá**: em 19/11 havia 11 frases e 3 títulos com "cash" à mão, e a trava `src/aMarcaMoraNumLugarSo.test.ts`
    (falsificada) reprova a próxima. E desde 19/11 à noite (*"troca o cashback para ele"*) a mesma trava reprova a
    PALAVRA "cashback" em frase de tela: a tela diz "Ativar o Troco Prime", "Dar troco", "Lançar o troco", "Onde ganhar
    troco". Nome de função, coluna e chave (`cash_balcao_dar_cashback`, `cashback_percentual`) ficam. Os nomes internos (a gaveta `cash`, `public.cash_*`, `valor_em_cash`) ficam: são do
    banco, não da tela.

## Decisões dele que ainda estão abertas

- **A sobra conta para o ciclo seguinte?** Quem junta 45 e transfere 30 fica com 15. Hoje esses
  15 contam para os próximos 30 (a fala de 19/11, *"ele tem que estar sempre juntando"*, combina com isso).
- **Quais 3–5 parceiros começam** (o percentual é o do Clube: 10% no Prime, 15%+ no de Ofertas).

## O que falta para alguém usar (corrigido em 19/11, pela passagem da conversa "Cashback prime")

> A passagem inteira da conversa antiga: [`docs/2026-11-19-passagem-do-cashback-prime.md`](docs/2026-11-19-passagem-do-cashback-prime.md).

1. ~~A tela do balcão~~: feita em 08/11 (`balcao.html`).
2. ~~O projeto da Vercel~~: **existe desde 08/11**; em 19/11 passou de `cashback` para **`trocoprime`**
   (https://cashback-snowy.vercel.app continua valendo). O OK dele para o domínio veio em 19/11 (*"vamos usar ele"*):
   **trocoprime.com.br** e **www** (este redireciona para o sem www) já estão **cadastrados no projeto**. Falta o
   apontamento no registro.br, que só ele faz: `A @ 216.150.1.1` e `CNAME www 5ec964930b98043b.vercel-dns-016.com`.
   Conferir de fora: `curl -s "https://dns.google/resolve?name=trocoprime.com.br&type=A"`.
3. O item "Meu cashback" no Clube Prime: **feito e mesclado** (`drrodrigo/clubeprime` #104, 08/11), **não publicado**
   (esperando "publica o clube"). Agora que a porta é o QR Bio, decidir se ele continua, e se passa a dizer "Troco Prime".
4. ~~A porta no QR Bio~~: **no ar desde 19/11** (a `0019` e a ponte `qrbio_troco_*`; ver "O contrato com o QR Bio").
5. ~~A tela do administrador~~: **feita em 19/11**, `/admin` (`admin.html`). Ele pediu: *"digita o nome dele lá e vincula"*.
   - **Vincular lojista:** digita o nome; a busca olha no **Catálogo Online** e no **QR Único**, sem acento, e diz quem já
     está vinculado. O percentual já vem escrito: o desconto do Clube que a loja do Catálogo declara, senão 10%.
   - **Depósito em dois passos:** "Registrar depósito" só prepara; a confirmação diz valor e loja por extenso (trava
     falsificada em `src/admin/tela.test.ts`).
   - Saques pedidos (marcar pago / recusar), a conferência da rede ("bate" / "NÃO BATE") e "vencer agora".
   - 🔴 **A loja do QR Único tem login próprio** (nenhum id igual ao `auth.users`). O balcão dela abre para a conta do
     Supabase com o **mesmo e-mail, confirmado** (`cash.loja_do_usuario`, `0020`). Sem conta com esse e-mail, o lojista
     precisa criar uma (é o mesmo login do Clube) e confirmar o e-mail.
   - A mesma loja pode existir nos dois (medido: "Ágape Jóias" está no Catálogo e no QR Único). Vincule **uma** vez.
6. ~~O vencimento automático~~: **feito em 19/11**, rotina `troco-prime-vencer` (04:11 em Brasília). Falta o **aviso** de
   vencimento (7 e 2 dias): precisa de um canal (push do QR Bio, WhatsApp ou e-mail).
7. O primeiro parceiro de verdade (zero loja, zero cliente em 19/11).
