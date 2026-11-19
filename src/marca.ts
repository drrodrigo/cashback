// ---------------------------------------------------------------------------
// A MARCA MORA AQUI -- e só aqui.
//
// Mesmo arranjo do BipeChat (`bipechat/src/lib/marca.ts`): trocar o nome é editar
// este arquivo, e o aplicativo inteiro acompanha. O nome da moeda foi escolhido
// pelo Rodrigo em 14/09 -- "põe cash, esse é o nome dela para começar" -- e o
// "para começar" é literal: trocar depois custa uma linha daqui.
//
// 19/11/2026: TROCO PRIME (na conversa do QR Bio). "QR Cash" ele achou registrado, e "QR Coin" já é o
// nome de uma criptomoeda (o token $QR da rede Base). "Troco" é o que volta da compra, todo brasileiro
// entende, e não tem cara de cripto nem de banco; o domínio trocoprime.com.br estava livre em 19/11.
// Na frase do balcão: "você tem 30 de troco; paga 70 e usa o troco".
// ---------------------------------------------------------------------------

export const MARCA = {
  /** O produto. */
  nome: 'Troco Prime',

  /** A unidade, como aparece no meio da frase: "você tem 50,00 de troco". */
  moeda: 'troco',

  /** Como o valor aparece escrito, do jeito que ele fala: "20 de troco"; com centavos só quando há ("20,50 de troco"). */
  valor: (n: number) => {
    const centavos = Math.round(n * 100)
    const texto = centavos % 100 === 0 ? String(centavos / 100) : (centavos / 100).toFixed(2).replace('.', ',')
    return `${texto} de troco`
  },

  /** Reais, para o que é dinheiro de verdade -- custódia, depósito e saque. */
  reais: (n: number) => `R$ ${n.toFixed(2).replace('.', ',')}`,

  tagline: 'O desconto que volta como troco.',

  /** Verde-petróleo: dinheiro sem ser o verde de cifrão, e longe do âmbar do BipeChat. */
  cor: '#0F766E',

  /**
   * A logo (19/11, escolhida por ele entre 4 que o ChatGPT desenhou: a "T de retorno", o T com a seta laranja que faz
   * a volta). Os originais e o 1024 estão em `docs/marca/`; os tamanhos servidos, em `public/`.
   */
  icone: '/icone-192.png',
  logo: '/logo-troco-prime.png',
} as const
