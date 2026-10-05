# Cash — a moeda da rede

Cashback com moeda própria: em vez de dar desconto, a loja devolve **cash**, que o
cliente gasta em qualquer loja da rede. Desconto sai do caixa hoje; cash só é pago
quando o cliente volta.

O desenho completo (contas, regras, limite jurídico, modelo de receita) está em
[`docs/superpowers/specs/2026-09-06-cashback-moeda-da-rede.md`](../docs/superpowers/specs/2026-09-06-cashback-moeda-da-rede.md).

## O estado hoje (14/09/2026)

**Modo demonstração: guarda no navegador, não fala com servidor nenhum.** O schema
está escrito, **plantado e provado num Postgres descartável**, e **não aplicado em banco
nenhum** — esperando uma palavra do dono, não uma mensalidade.

> **Correção de 01/10, e ela vale dinheiro.** Este arquivo dizia que o cash esperava "a
> decisão do projeto Supabase próprio (US$ 10/mês)". Isso envelheceu no dia seguinte ao
> que foi escrito: em 13/09 o dono juntou tudo num banco só, com uma **gaveta (schema)
> por produto**. O cash não precisa de projeto novo nem de mensalidade nova — precisa de
> UMA migration aplicada no banco único, e ela custa R$ 0,00.

O que já existe de verdade:

| | |
|---|---|
| `src/nucleo/livro.ts` | O motor do dinheiro: contas, lotes, vencimento, idempotência, a invariante |
| `src/nucleo/livro.test.ts` | 29 testes, incluindo os que tentam quebrar a invariante |
| `src/main.ts` | A tela: balcão da loja, carteira do cliente, fundo da rede, relógio |
| `supabase/migrations/0001_livro_razao.sql` | O mesmo modelo em SQL, por aplicar |

**O motor não sabe onde o estado dorme.** É TypeScript puro, sem navegador nem banco
— hoje ele roda contra `localStorage`, amanhã contra Postgres, e os mesmos testes
valem nos dois casos. Foi assim de propósito: tela se refaz numa tarde, dinheiro
errado não se desfaz.

## A regra que tudo protege

```
soma de TODO o cash que existe  ==  dinheiro parado em custódia
```

O lojista deposita reais e recebe cash; outro lojista recebe cash e saca reais. Se
essa conta não fechar, alguém saca dinheiro que não existe. Por isso não existe
`saldo = saldo - x` em lugar nenhum: valor só se move entre contas, e só entra ou sai
em duas operações (depositar e sacar), que mexem na custódia na mesma transação.

A tela mostra essa conferência no topo, sempre — e o motor recusa qualquer operação
que a quebre.

## Rodar

```
npm run test:cash        # da raiz do repositório: 29 testes do motor
npx vite build cash      # da raiz: gera cash/dist
npx vite cash            # da raiz: abre em desenvolvimento

# planta a gaveta num Postgres descartável e mede as regras dela:
bash bipechat/scripts/banco-de-mentira.sh --raiz cash --testes
```

O último é o que prova a migration antes de ela encostar no banco de verdade. São 12
medidas, e nenhuma delas se faz lendo o arquivo: `revoke` escrito não prova porta
fechada (são **duas** portas, `public` e `anon`), e grant que falta não dá erro — dá
silêncio, dias depois, numa Edge Function que parou de ler.

Os comandos saem da raiz porque `npm install` dentro de pasta aninhada quebra neste
ambiente, com um erro do próprio npm (`Cannot read properties of null (reading
'edgesOut')`). O `package.json` daqui declara as dependências mesmo assim: quando o
cash ganhar repositório próprio, `npm install && npm test` funciona sem mudar nada.

## O que ele NÃO tem, e não é esquecimento

- **Não tem rota no aplicativo do Catálogo**, linha no `vercel.json` dele nem slug
  reservado. Domínio emprestado também conta como misturar — isso já foi desfeito uma
  vez neste repositório, com a Rede de Parceiros, e o motivo está no `CLAUDE.md`.
- **Não tem banco.** Ver acima.
- **Não tem login.** A demonstração troca de loja e de cliente num seletor, porque o
  que ela precisa mostrar é o dinheiro andando, não a autenticação.

## Quando virar produto de verdade

1. A migration aplicada no banco único (gaveta `cash`) — **falta só a palavra do dono**.
   Já está provada no Postgres de mentira, inclusive falsificada: abrindo a gaveta para o
   `anon` e desligando a RLS de uma tabela, o teste fica vermelho apontando qual regra
   caiu.
2. Projeto Vercel próprio, com diretório raiz `cash/` (o `vercel.json` daqui já está
   pronto), ramos `main` e `beta`.
3. Domínio próprio, e o nome definitivo da moeda — "cash" foi a escolha do Rodrigo em
   14/09 **para começar**, e trocar é editar `src/marca.ts`, uma linha.
4. Repositório próprio, como o Banco da Hora e o AutoBipe fizeram.


## O aplicativo da conta (05/10)

O endereço principal (`index.html`) é a **conta da pessoa**: ativar o cashback,
ver o saldo, ver quanto falta para os 30, transferir para gastar, achar as lojas
e ler os lançamentos. A **demonstração** do modelo inteiro (balcão, carteira,
rede, relógio) mudou para `demonstracao.html` e continua funcionando **sem banco
nenhum** -- é ela que explica o produto a quem nunca viu.

```
npx vite build cash                  # constrói as duas páginas
npx vite --config cash/vite.config.ts   # roda local
npx vitest run --config cash/vitest.config.ts   # 53 testes
```

### Como ele está organizado, e por quê

| arquivo | o que é |
|---|---|
| `src/carteira/estado.ts` | **função pura**: dado o que o banco devolveu, QUAL das seis telas desenhar |
| `src/carteira/tela.ts` | o desenho, em DOM na mão. Não fala com a rede |
| `src/carteira/tela.test.ts` | **monta a tela e LÊ o que aparece**, nos seis estados |
| `src/dados.ts` | a conversa com o banco, só pela fronteira `public.cash_*` |
| `src/main.ts` | a costura |

A separação existe por causa da lição de 01/10: eu entreguei quatro consertos
seguidos para "a secretária não consegue aplicar tema" lendo o componente, e na
quinta vez montei a página com os dados reais e vi que **ela abria sem nenhum
botão**. As onze travas que eu havia escrito liam o ARQUIVO. Esta monta a tela.

### 🔴 Sem as variáveis no build, falta o CÓDIGO -- não só o dado

Medido em 05/10:

| build | tamanho do pacote da conta |
|---|---:|
| **sem** `VITE_SUPABASE_URL` / `ANON_KEY` | **9,66 kB** |
| **com** as duas | **218,60 kB** |

A diferença é a biblioteca do Supabase inteira. O empacotador a **elimina**
porque, sem as variáveis, o ramo que chama `createClient` fica inalcançável em
tempo de build. Quer dizer:

> **Preencher a variável no painel e não publicar de novo deixa no ar um pacote
> que NUNCA vai conectar** -- e não por falta de dado, por falta de código.

É a face mais afiada da regra *"variável `VITE_` só entra no site durante o
BUILD"*. E dá uma conferência de fora, de graça: **pacote de ~10 kB no ar
significa que o build saiu sem as variáveis.** Com elas são ~220 kB.

Por isso o aplicativo tem uma tela só para esse caso, e ela manda **publicar de
novo** em vez de só preencher.

### O endereço: `base: './'`, e não `/cashback/`

O aplicativo é servido em dois lugares -- na raiz do projeto dele (para depurar)
e em `/cashback/` do Clube Prime, pelo repasse que faz a sessão do login
atravessar (spec §16). Com `base` chumbado num dos dois, o outro pede os arquivos
no lugar errado e abre **branco, sem erro na tela**. Caminho relativo funciona
nos dois sem ninguém lembrar de trocar nada.

Isto só é seguro porque aqui não há roteador de caminho: a tela é uma, e o que
muda é o estado.
