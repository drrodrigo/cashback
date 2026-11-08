import { defineConfig } from 'vitest/config'

// A suíte do cashback.
//
// Este arquivo mudou em 08/11/2026, quando o cashback saiu de dentro do
// `drrodrigo/catologoonline` e virou repositório próprio. Lá ele era uma pasta
// (`cash/`), e o `include` tinha que dizer `cash/src/**` porque o vitest resolvia
// o padrão a partir da raiz do outro repositório -- rodar `npm test` de dentro da
// pasta não achava teste nenhum, e a suíte só rodava por `npm run test:cash` de lá.
//
// Aqui a raiz é esta, então o caminho é `src/**` e `npm test` funciona direto.
//
// 🔴 E `npm install` precisa de `--legacy-peer-deps` para GERAR o lockfile: o npm
// 10.9.9 estoura com "Cannot read properties of null (reading 'edgesOut')"
// resolvendo os peers do `vitest` 4 (`#loadPeerSet`, pelo
// `@vitest/browser-playwright` que ele declara como peer opcional). Por isso o
// `package-lock.json` é versionado: COM ele, `npm ci` e `npm install` passam os
// dois -- medido numa cópia limpa, e foi o que impediu o build da Vercel de
// falhar no install antes de compilar uma linha.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
