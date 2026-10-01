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
