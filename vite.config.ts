import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// DUAS PÁGINAS, e um detalhe de endereço que o BipeChat já pagou caro.
//
// `base: './'` -- caminho RELATIVO, não `/cashback/`. O aplicativo é servido em
// dois lugares: na raiz do projeto dele na Vercel (para eu depurar) e em
// `/cashback/` do Clube Prime (pelo repasse, que é o que faz a sessão do login
// atravessar -- ver a §16 da spec). Com `base` chumbado num dos dois, o outro
// pede os arquivos no lugar errado e abre BRANCO, sem erro na tela. Relativo
// funciona nos dois sem ninguém lembrar de trocar nada.
//
// Isto só é seguro porque aqui não há roteador de caminho: a tela é uma, e o que
// muda é o estado. Aplicativo com rotas de caminho precisa de `base` absoluto.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    rollupOptions: {
      input: {
        // O endereço principal é a CONTA da pessoa -- é o que ele pediu.
        index: resolve(__dirname, 'index.html'),
        // A demonstração do modelo continua: é ela que mostra balcão, carteira,
        // rede e relógio sem depender de banco nenhum. Serve para explicar o
        // produto a quem nunca viu.
        demonstracao: resolve(__dirname, 'demonstracao.html'),
      },
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
