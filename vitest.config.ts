import { defineConfig } from 'vitest/config'

// Suíte própria do cash, separada da do Catálogo de propósito: são dois produtos
// que não compartilham nada, e misturar as duas faz a do Catálogo carregar jsdom,
// plugin de React e variáveis de Supabase para testar aritmética de dinheiro.
//
// Neste repositório ela roda pelo binário da raiz (`npm run test:cash`), porque
// `npm install` dentro de pasta aninhada quebra neste ambiente com um erro do
// próprio npm ("Cannot read properties of null (reading 'edgesOut')"). O
// `package.json` daqui declara as dependências mesmo assim: quando o cash ganhar
// repositório próprio, `npm install && npm test` funciona sem mudar nada.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['cash/src/**/*.test.ts'],
    root: '.',
  },
})
