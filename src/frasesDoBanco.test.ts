// TODO CÓDIGO DE ERRO DO BANCO TEM FRASE DE GENTE (19/11).
//
// Até 19/11, onze códigos chegavam crus no balcão: a loja lia "membro_nao_ativou" na tela em vez de "Esse cliente
// ainda não ativou o Troco Prime". Esta trava lê cada `raise exception '<código>'` das migrations e cobra a frase.
//
// Falsificada em 19/11: tirar a linha `membro_nao_ativou` de FRASES deixa este teste vermelho, apontando o código.
import { describe, expect, it } from 'vitest'
import { fraseDoErro } from './dados'

const MIGRATIONS = import.meta.glob<string>('../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true })

function codigosDoBanco(): string[] {
  const achados = new Set<string>()
  for (const sql of Object.values(MIGRATIONS)) {
    for (const m of sql.matchAll(/raise exception '([a-z_]+)'/g)) achados.add(m[1])
  }
  return [...achados].sort()
}

describe('as frases dos erros do banco', () => {
  it('acha os códigos nas migrations (se vier vazio, a trava estaria cega)', () => {
    expect(codigosDoBanco().length).toBeGreaterThan(20)
  })

  it.each(codigosDoBanco())('o código "%s" vira frase, e não aparece cru na tela', (codigo) => {
    const frase = fraseDoErro({ message: codigo })
    expect(frase).not.toContain(codigo)
    expect(frase).toMatch(/[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/)
  })

  it('o erro do Clube, que vem na DICA, também vira frase', () => {
    expect(fraseDoErro({ message: 'token vencido ou já usado', hint: 'token_expirado' })).toContain('Peça para o cliente abrir a carteirinha de novo')
  })
})
