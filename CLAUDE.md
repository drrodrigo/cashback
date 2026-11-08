# CLAUDE.md — Cashback

> **Este repositório nasceu em 08/11/2026**, por `git subtree split` da pasta `cash/` do
> [`drrodrigo/catologoonline`](https://github.com/drrodrigo/catologoonline), guardando os 10
> commits de história. O motivo foi dele: *"eu quero separado do catálogo pq tá aumentando meu
> custo que toda vez que atualiza um atualiza o outro e eu pago mais caro"*.

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
npm test                    # 54 testes (29 do motor + 25 da tela)
npm run build               # com as VITE_*; sem elas o pacote sai com 10 kB em vez de 226 kB
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

## Decisões dele que ainda estão abertas

- **Cashback por produto ou geral?** *"Aí tem que decidir ainda com o lojista."* Hoje existe só
  o percentual da LOJA. Modelar o por-produto antes da decisão é inventar a regra dele.
- **A sobra conta para o ciclo seguinte?** Quem junta 45 e transfere 30 fica com 15. Hoje esses
  15 contam para os próximos 30.
- **O nome da moeda** continua "cash".
- **Quais 3–5 parceiros começam, e com qual percentual.**

## O que falta para alguém usar

1. A **tela do balcão** (hoje só a do cliente existe).
2. O **projeto da Vercel** deste repositório (Root Directory = a raiz).
3. O **item de menu no Clube Prime**, com o repasse de `/cashback` — e ele precisa ser
   **mesma origem**, senão a sessão do login não atravessa (`localStorage` é por origem).
   ⚠️ No `drrodrigo/clubeprime`, a barra de baixo do celular (`CascaLateral.tsx`) ignora o
   `externo` do item de menu: um item externo fica morto no celular. Conserte junto.
