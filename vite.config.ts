import { defineConfig } from 'vite'

// Uma página só, sem framework: o motor do dinheiro é TypeScript puro e a tela é
// DOM na mão. Isso mantém o pacote pequeno o bastante para caber numa página
// única -- o que permite mostrar a demonstração sem depender de hospedagem.
export default defineConfig({
  build: { outDir: 'dist', target: 'es2022' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
