// ---------------------------------------------------------------------------
// A MARCA MORA AQUI -- e só aqui.
//
// Mesmo arranjo do BipeChat (`bipechat/src/lib/marca.ts`): trocar o nome é editar
// este arquivo, e o aplicativo inteiro acompanha. O nome da moeda foi escolhido
// pelo Rodrigo em 14/09 -- "põe cash, esse é o nome dela para começar" -- e o
// "para começar" é literal: trocar depois custa uma linha daqui.
// ---------------------------------------------------------------------------

export const MARCA = {
  /** O produto. */
  nome: 'Cash',

  /** A unidade, como aparece no meio da frase: "você tem 50 cash". */
  moeda: 'cash',

  /** Como o valor aparece escrito: 50 cash. */
  valor: (n: number) => `${n.toFixed(2).replace('.', ',')} cash`,

  /** Reais, para o que é dinheiro de verdade -- custódia, depósito e saque. */
  reais: (n: number) => `R$ ${n.toFixed(2).replace('.', ',')}`,

  tagline: 'O desconto que volta como visita.',

  /** Verde-petróleo: dinheiro sem ser o verde de cifrão, e longe do âmbar do BipeChat. */
  cor: '#0F766E',
} as const
