# CLAUDE.md — Cashback

> **Este repositório nasceu em 08/11/2026**, por `git subtree split` da pasta `cash/` do
> [`drrodrigo/catologoonline`](https://github.com/drrodrigo/catologoonline), guardando os 10
> commits de história. O motivo foi dele: *"eu quero separado do catálogo pq tá aumentando meu
> custo que toda vez que atualiza um atualiza o outro e eu pago mais caro"*.

## 🔴 Quem cuida (19/11)

**A conversa do QR Bio** (`drrodrigo/qrbio`), a pedido dele: *"você vai ser o cashback, você vai ser o Troco Prime"*. O
produto continua SEPARADO (este repositório, a gaveta `cash`, `trocoprime.com.br`); a conversa é uma só porque **a porta
do cliente é o QR Bio** (a conta ao lado da carteirinha do Clube). O mapa dos produtos: `drrodrigo/qrbio`,
`docs/O-CAMINHO.md`.

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

O banco está **no ar** desde 08/11: a gaveta `cash` e as 27 funções da fronteira
(`public.cash_*`). O que exatamente subiu, o nome de cada migration na produção e **o SQL da
conferência** estão em [`supabase/APLICADO-NA-PRODUCAO.md`](supabase/APLICADO-NA-PRODUCAO.md).

🔴 **A conferência que vale é comparar o MIOLO de cada função do repositório com a função
VIVA** (md5 sem comentário, espaço colapsado). Em 08/11 ela achou três consertos que tinham
voltado atrás — e o teste do repositório estava **verde** nos três, porque ele planta os
arquivos na ordem e a produção não tinha a mesma ordem.

## Comandos

```bash
npm install                 # na 1a vez precisa de --legacy-peer-deps (ver vitest.config.ts)
npm test                    # 106 testes (o motor, as telas e a trava do nome)
npm run build               # com as VITE_*; sem elas o `assets/dados-*.js` sai com 2,8 kB
                            # em vez de 219 kB (olhe ESSE arquivo, não o index-*.js)
npm run dev

bash scripts/banco-de-mentira.sh --testes   # 81 passos num Postgres descartável, de graça
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

  O motor hoje só tem o percentual da loja. "Pontos fixos por produto" é regra nova: desenhar com ele antes de programar.
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
    (falsificada) reprova a próxima. Os nomes internos (a gaveta `cash`, `public.cash_*`, `valor_em_cash`) ficam: são do
    banco, não da tela.

## Decisões dele que ainda estão abertas

- **A sobra conta para o ciclo seguinte?** Quem junta 45 e transfere 30 fica com 15. Hoje esses
  15 contam para os próximos 30 (a fala de 19/11, *"ele tem que estar sempre juntando"*, combina com isso).
- **Quais 3–5 parceiros começam** (o percentual é o do Clube: 10% no Prime, 15%+ no de Ofertas).

## O que falta para alguém usar

1. ~~A **tela do balcão**~~: feita em 08/11 (`balcao.html`, "ler a carteirinha, lançar o cashback, cobrar"); falta usar com um
   parceiro de verdade.
2. O **projeto da Vercel** deste repositório (Root Directory = a raiz).
3. O **item de menu no Clube Prime**, com o repasse de `/cashback` — e ele precisa ser
   **mesma origem**, senão a sessão do login não atravessa (`localStorage` é por origem).
   ⚠️ No `drrodrigo/clubeprime`, a barra de baixo do celular (`CascaLateral.tsx`) ignora o
   `externo` do item de menu: um item externo fica morto no celular. Conserte junto.
