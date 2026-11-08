import { defineConfig } from 'vitest/config'

// Suíte própria do cash, separada da do Catálogo de propósito: são dois produtos
// que não compartilham nada, e misturar as duas faz a do Catálogo carregar jsdom,
// plugin de React e variáveis de Supabase para testar aritmética de dinheiro.
//
// Neste repositório ela roda pelo binário da raiz (`npm run test:cash`), porque
// `npm install` dentro desta pasta quebra com um erro do próprio npm ("Cannot
// read properties of null (reading 'edgesOut')").
//
// 🔴 A CAUSA, medida em 08/11 ao preparar o projeto da Vercel: é um defeito do
// npm 10.9.9 resolvendo os PEERS do `vitest` 4 (`#loadPeerSet` em
// build-ideal-tree.js, no `@vitest/browser-playwright` que o vitest declara como
// peer opcional). Não é a pasta aninhada, e não é este ambiente: aconteceria na
// Vercel também, e o build do cash não subiria.
//
// O conserto é o `package-lock.json` desta pasta, versionado: com ele, tanto
// `npm ci` quanto `npm install` passam (os dois medidos numa cópia limpa, fora
// do repositório). Para GERAR o lockfile de novo, se um dia precisar, é
// `npm install --legacy-peer-deps` -- que é o único jeito de passar pelo defeito.
// Depois disso, `npm install && npm test` funciona sem mudar nada.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['cash/src/**/*.test.ts'],
    root: '.',
  },
})
