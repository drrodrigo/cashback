# Passagem: conversa "Cashback prime" → conversa do QR Bio (Troco Prime), 19/11/2026

> Escrita pela conversa "Cashback prime" (06/09 a 08/11) a pedido dele, conferida contra este repositório (commit
> 037898a), o código (`src/nucleo/livro.ts`, `cash.parametros`) e o site no ar. Guardada aqui pela conversa do QR Bio,
> que cuida do Troco Prime desde 19/11. As regras de dinheiro abaixo JÁ estão no motor e no banco.

## 1. O que o CLAUDE.md dizia atrasado (corrigido no mesmo dia)

- **O projeto da Vercel existe** (criado por ele em 08/11): `cashback`, https://cashback-snowy.vercel.app, com as duas
  `VITE_`. Em 19/11 a raiz mostra "Troco Prime — minha conta" e `/balcao.html` "Troco Prime — balcão da loja" (conferido
  pela conversa do QR Bio).
- **O item de menu no Clube Prime foi feito** (`drrodrigo/clubeprime` PR #104, mesclado em 08/11): "Meu cashback — o
  dinheiro que volta quando você compra", levando a `/cashback` no próprio endereço do Clube (repasse no `vercel.json` do
  Clube), com o conserto da barra de baixo do celular (`CascaLateral`). 🔴 **NÃO publicado**: o Clube tem projeto próprio na
  Vercel e ficou esperando ele dizer "publica o clube". Falta decidir se o item diz "Troco Prime" e se continua existindo,
  agora que a porta é o QR Bio.

## 2. As regras do dinheiro (fechadas com ele em 06/09)

- **Lastro:** a loja deposita reais antes e recebe crédito; o cashback sai desse crédito. A soma de todos os pontos é igual
  ao dinheiro em custódia, sempre. **Nenhum ponto nasce do nada**: brinde ou campanha, a plataforma deposita antes.
- **Prazos** (`cash.parametros`; mudar o número não mexe em saldo já liberado): o **liberado para gastar vale 30 dias**
  (não gastou, perde: "o relógio", decisão dele); o **juntado vence em 365 dias**; o **"só desta loja" em 30 dias**.
- **O que vence não some:** vai para a conta promocional, o fundo da rede (campanha, brinde, sorteio). É fundo, não lucro.
- **Dobro no balcão (ideia dele):** compra presencial vale 2× (`multiplicador_presencial` = 2); retirar na loja conta como
  presencial. Comunicar como bônus ("compre na loja e ganhe o dobro"), nunca como castigo. O fundo pode bancar o dobro.
- **Aceitação sem condição:** a loja da rede aceita sem compra mínima e sem teto; pode haver venda paga 100% em pontos.
- **Ordem de gasto:** primeiro o restrito daquela loja, depois o da rede; dentro de cada um, o que vence antes sai antes.
- **O lojista:** recicla o que recebeu (vira crédito, sem taxa) ou pede saque em reais com **taxa de 5%** (vai para o
  fundo). Hoje o saque é pedido no balcão e o administrador paga à mão (`cash_admin_pagar_saque`).
- **Cobrança no balcão:** o balcão só PEDE; o cliente confirma no celular os dois números (a compra e os pontos). Quem diz
  qual é o cliente é só o QR da carteirinha (não há campo de telefone nem CPF, e uma trava impede). A câmera lê o QR, e o
  campo de digitar o código aparece sempre.
- **As 4 travas do prazo:** o cliente escolhe quanto liberar; a data aparece antes de confirmar; aviso aos 7 e aos 2 dias;
  dizer para onde vai o que vence. 🔴 O aviso de 7 e 2 dias **não existe**; o vencimento roda à mão (`cash_admin_vencer`).

## 3. Receita e lançamento (desenho de 06/09)

- Receitas: a assinatura do lojista (a previsível), a taxa de saque (empurra a reciclar) e o que vence (verba carimbada
  para campanha). Um plano só no começo. O número que mostra se funciona é a **taxa de resgate**.
- Ideias dele de lançamento: 3 meses grátis, os 100 primeiros sem pagar, metade do preço para quem é do Catálogo.
  "Deposita 1.000 e recebe 950" dá como taxa de entrada, mas não resolve o imposto.
- Para o lojista: o cashback é custo na emissão, como comprar mídia; o que o cliente não usou fica com a rede (no contrato
  e na tela de depósito). No convite: a loja aceita venda 100% em pontos, e o depósito antecipado é o que torna isso seguro.

## 4. Jurídico e fiscal (pendências dele)

- **Contador antes do primeiro depósito:** o depósito entra como valor de terceiro em custódia, não como receita.
- **Começo recomendado: piloto sem saque** (deposita, dá, recebe, recicla; quem sai, sai por acerto contratual). Saque de
  verdade depois, por instituição licenciada (Asaas, Mercado Pago, Iugu). O Banco Central exige autorização de todos até
  31/03/2029. Dinheiro do lojista em conta separada; contrato diz o que acontece se o programa acabar. **Advogado antes do
  primeiro depósito.** Nunca "meio/forma de pagamento" no material: os pontos "valem nas lojas da rede".

## 5. Dados das pessoas

- A loja A vê só os resgates dela, nunca o que o cliente comprou na B. Oferta exige consentimento separado. O cliente vê o
  extrato inteiro e pode apagar a conta (saldo resolvido antes). Relatório do lojista agregado ("venda que passou pela
  rede"). Itens da compra só da venda online do Catálogo.

## 6. Clientes, parceiros e login

- Base: os membros do Clube Prime (**3.912** em 08/11). Login único do Clube ("banco universal", 5.083 contas no mesmo
  `auth.users`). **A sessão não atravessa domínio** (`localStorage` por endereço): por isso o `/cashback` mora no endereço
  do Clube. (No QR Bio a ponte não depende disso: ela confere a sessão do próprio QR Bio, `qrbio_troco_*`.)
- A loja do Troco Prime não é a do Catálogo: o administrador liga com `cash_admin_ligar_parceiro` (parceiro do Clube; 42
  em 04/10) ou `cash_admin_ligar_loja_do_catalogo`. Ele pediu em 04/10 ver no mapa **os produtos** que dão cashback: não existe.

## 7. O que ficou pela metade

1. Publicar o Clube ("publica o clube").
2. **Tela do administrador:** não existe (as funções `cash_admin_*` estão no banco).
3. Aviso de vencimento (7 e 2 dias) e vencimento automático.
4. Faxina: apagar `cash._sonda_aspas` e `cash._sonda_dois_reais` (o `drop` precisa do OK dele no chat).
5. A pasta velha `cash/` no `drrodrigo/catologoonline`: só se ele disser "apaga a pasta velha".
6. Apontar trocoprime.com.br para a Vercel do cashback (pôr no ar: só com o OK dele).
7. Zero loja, zero cliente: falta o primeiro parceiro de verdade depositar e usar o balcão.
8. O cashback não tem cartão na tela Passagens.

## 8. Cuidados que já custaram tempo

- Na Vercel, **não clicar em "Add" no bloco Supabase/Postgres**: cria outro banco, cobrado à parte.
- O código de dois fatores da Vercel vem do aplicativo autenticador (ou de um código de recuperação).
- `_porque` não é chave válida no `vercel.json`: a Vercel recusa o arquivo inteiro.
- **App nas lojas:** a Apple tem regras para moeda e carteira dentro de app; conferir antes de pôr o Troco Prime no app do
  QR Bio (pontos que não se compram nem se sacam são fidelidade; mas conferir na hora).

## 9. Onde ler mais

- O desenho completo: `drrodrigo/catologoonline`, `feature/catalogo-saas`, `docs/superpowers/specs/2026-09-06-cashback-moeda-da-rede.md`.
- Páginas da conversa antiga: "O caminho da moeda" https://claude.ai/code/artifact/5b42e330-4108-4ecb-a031-ee9bba4ac407 ·
  "Cash da rede" https://claude.ai/artifact/CHhJqv2okFmXiSJwirZLBX · "Balcão do Cash" https://claude.ai/artifact/WzrSQcQCUZEEroShwxraNQ
