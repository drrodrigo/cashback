import './estilo.css'
import { MARCA } from './marca'
import {
  ErroDeRegra,
  PROMOCIONAL,
  avancarDias,
  confirmarPagamento,
  contaCredito,
  contaRecebido,
  contasDoCliente,
  darCashback,
  depositar,
  descerParaGastar,
  diasEntre,
  distribuirPromocao,
  estadoVazio,
  invarianteFecha,
  pedirPagamento,
  podeDescer,
  podeUsarNaLoja,
  reciclar,
  sacar,
  saldo,
  saldoTotal,
  venceEmDisponivel,
  type Estado,
} from './nucleo/livro'

// ---------------------------------------------------------------------------
// Modo demonstração: guarda no navegador, não fala com servidor nenhum.
//
// Isso é escolha de arquitetura, não preguiça -- é o mesmo arranjo do Banco da
// Hora e da Rede de Parceiros. Produto novo nasce fora do banco do Catálogo; até
// o cash ter projeto Supabase próprio, ele roda assim. O motor (`nucleo/livro`)
// já é o mesmo que vai rodar contra banco depois: só troca onde o estado dorme.
// ---------------------------------------------------------------------------

const CHAVE_GUARDA = 'cash.demonstracao.v1'

interface Selecao {
  loja: string
  cliente: string
}

let estado: Estado
let selecao: Selecao
let recado: { texto: string; tom: 'bom' | 'ruim' } | null = null

function hojeDeVerdade(): string {
  return new Date().toISOString().slice(0, 10)
}

function semear(): Estado {
  const novo = estadoVazio(hojeDeVerdade())
  novo.lojas = [
    { id: 'padaria', nome: 'Padaria da Esquina', cashbackPercentual: 10 },
    { id: 'pizzaria', nome: 'Pizzaria do Zé', cashbackPercentual: 20 },
    { id: 'papelaria', nome: 'Papelaria Central', cashbackPercentual: 15 },
  ]
  novo.clientes = [
    { id: 'ana', nome: 'Ana Souza', telefone: '(31) 99999-0001' },
    { id: 'bruno', nome: 'Bruno Lima', telefone: '(31) 99999-0002' },
  ]

  // Abre com uma rede que já andou um pouco: três lojas com crédito, uma cliente
  // que já pode descer saldo e outro que ainda está juntando. Tela vazia não
  // mostra nada do que o produto faz.
  depositar(novo, 'padaria', 1000, 'semente-1')
  depositar(novo, 'pizzaria', 600, 'semente-2')
  depositar(novo, 'papelaria', 400, 'semente-3')
  darCashback(novo, 'padaria', 'ana', 180, { presencial: true, chave: 'semente-4' })
  darCashback(novo, 'pizzaria', 'ana', 90, { presencial: false, chave: 'semente-5' })
  darCashback(novo, 'papelaria', 'ana', 60, { presencial: true, restrito: true, chave: 'semente-6' })
  darCashback(novo, 'pizzaria', 'bruno', 55, { presencial: true, chave: 'semente-7' })
  return novo
}

function carregar(): Estado {
  try {
    const guardado = localStorage.getItem(CHAVE_GUARDA)
    if (guardado) return JSON.parse(guardado) as Estado
  } catch {
    // Navegador anônimo, cookies bloqueados, cota cheia: cai na semente e segue.
  }
  return semear()
}

function salvar(): void {
  try {
    localStorage.setItem(CHAVE_GUARDA, JSON.stringify(estado))
  } catch {
    // Não poder guardar não pode derrubar a tela: a demonstração continua na memória.
  }
}

// --- desenho -----------------------------------------------------------------

const cash = MARCA.valor
const reais = MARCA.reais

function escapar(texto: string): string {
  return texto.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}

function opcoesLoja(selecionada: string): string {
  return estado.lojas
    .map(
      (l) =>
        `<option value="${l.id}"${l.id === selecionada ? ' selected' : ''}>${escapar(l.nome)} · ${l.cashbackPercentual}%</option>`,
    )
    .join('')
}

function opcoesCliente(selecionado: string): string {
  return estado.clientes
    .map((c) => `<option value="${c.id}"${c.id === selecionado ? ' selected' : ''}>${escapar(c.nome)}</option>`)
    .join('')
}

function painelConferencia(): string {
  const emCash = saldoTotal(estado)
  const fecha = invarianteFecha(estado)
  return `
    <section class="painel conferencia largura-total${fecha ? '' : ' quebrada'}">
      <div class="medida">
        <span class="medida-rotulo">Dinheiro em custódia</span>
        <span class="medida-valor">${reais(estado.custodia)}</span>
      </div>
      <div class="medida">
        <span class="medida-rotulo">Cash que existe</span>
        <span class="medida-valor">${cash(emCash)}</span>
      </div>
      <div class="medida">
        <span class="medida-rotulo">Fundo de promoção</span>
        <span class="medida-valor destaque">${cash(saldo(estado, PROMOCIONAL))}</span>
      </div>
      <div class="medida">
        <span class="medida-rotulo">Confere?</span>
        <span class="${fecha ? 'selo-ok' : 'selo-erro'}">${fecha ? '✓ bate certinho' : '✗ NÃO BATE'}</span>
      </div>
      <div class="saldo-nota" style="flex:1 1 220px">
        Cada cash que existe é um real depositado por algum lojista. Se essas duas colunas
        se separarem, alguém sacaria dinheiro que não existe — por isso a conferência fica aqui em cima.
      </div>
    </section>`
}

function painelLoja(): string {
  const loja = estado.lojas.find((l) => l.id === selecao.loja) ?? estado.lojas[0]
  const credito = saldo(estado, contaCredito(loja.id))
  const recebido = saldo(estado, contaRecebido(loja.id))

  return `
    <section class="painel">
      <h2>Balcão da loja <small>o lado de quem vende</small></h2>

      <div class="campo">
        <label for="loja">Loja</label>
        <select id="loja" data-campo="loja">${opcoesLoja(loja.id)}</select>
      </div>

      <div class="saldos">
        <div class="saldo">
          <span class="saldo-rotulo">Crédito</span>
          <span class="saldo-valor">${cash(credito)}</span>
          <span class="saldo-nota">é daqui que sai o cashback</span>
        </div>
        <div class="saldo">
          <span class="saldo-rotulo">Recebido</span>
          <span class="saldo-valor">${cash(recebido)}</span>
          <span class="saldo-nota">é daqui que ela saca</span>
        </div>
      </div>

      <h3>Entrar com dinheiro</h3>
      <div class="linha">
        <div class="campo">
          <label for="deposito">Depositar em reais</label>
          <input type="number" id="deposito" min="1" step="10" value="500">
        </div>
        <button data-acao="depositar">Depositar</button>
      </div>

      <h3>Venda com cashback</h3>
      <div class="linha">
        <div class="campo">
          <label for="cliente-cashback">Cliente</label>
          <select id="cliente-cashback">${opcoesCliente(selecao.cliente)}</select>
        </div>
        <div class="campo">
          <label for="compra-cashback">Valor da compra</label>
          <input type="number" id="compra-cashback" min="1" step="10" value="100">
        </div>
      </div>
      <div class="linha">
        <label class="marcador"><input type="checkbox" id="presencial" checked> comprou na loja (vale o dobro)</label>
        <label class="marcador"><input type="checkbox" id="restrito"> só vale nesta loja</label>
        <button data-acao="cashback">Dar cashback</button>
      </div>

      <h3>Receber pagamento em ${MARCA.moeda}</h3>
      <div class="linha">
        <div class="campo">
          <label for="cliente-cobranca">Cliente</label>
          <select id="cliente-cobranca">${opcoesCliente(selecao.cliente)}</select>
        </div>
        <div class="campo">
          <label for="compra-cobranca">Valor da compra</label>
          <input type="number" id="compra-cobranca" min="1" step="10" value="80">
        </div>
        <div class="campo">
          <label for="cash-cobranca">Pago em ${MARCA.moeda}</label>
          <input type="number" id="cash-cobranca" min="1" step="5" value="30">
        </div>
      </div>
      <div class="linha">
        <button data-acao="cobrar">Pedir confirmação</button>
        <span class="saldo-nota">o cliente confirma os dois números na tela dele</span>
      </div>

      <h3>Tirar o que recebeu</h3>
      <div class="linha">
        <div class="campo">
          <label for="valor-saque">Valor</label>
          <input type="number" id="valor-saque" min="1" step="10" value="${Math.max(recebido, 0).toFixed(2)}">
        </div>
        <button class="secundario" data-acao="reciclar">Reciclar (sem taxa)</button>
        <button class="secundario" data-acao="sacar">Sacar (taxa ${estado.config.taxaSaquePercentual}%)</button>
      </div>
    </section>`
}

function painelCliente(): string {
  const cliente = estado.clientes.find((c) => c.id === selecao.cliente) ?? estado.clientes[0]
  const { acumulo, disponivel, restritos } = contasDoCliente(estado, cliente.id)
  const vence = venceEmDisponivel(estado, cliente.id)
  const diasParaVencer = vence ? diasEntre(estado.hoje, vence) : null
  const falta = Math.max(estado.config.gatilho - acumulo, 0)
  const pendentes = estado.pagamentosPendentes.filter((p) => p.clienteId === cliente.id)

  const cartõesRestritos = restritos
    .map(
      (r) => `
        <div class="saldo">
          <span class="saldo-rotulo">Só na ${escapar(r.loja.nome)}</span>
          <span class="saldo-valor">${cash(r.valor)}</span>
          <span class="saldo-nota">sai antes do saldo da rede</span>
        </div>`,
    )
    .join('')

  const cobrancas = pendentes
    .map((p) => {
      const loja = estado.lojas.find((l) => l.id === p.lojaId)
      return `
        <div class="pendencia">
          <p><strong>${escapar(loja?.nome ?? p.lojaId)}</strong> está cobrando:</p>
          <p class="numeros">compra de ${reais(p.valorCompra)} · ${cash(p.valorEmCash)} do seu saldo · ${reais(p.valorCompra - p.valorEmCash)} em dinheiro</p>
          <div class="linha">
            <button data-acao="confirmar" data-id="${p.id}">Confirmar</button>
            <button class="discreto" data-acao="recusar" data-id="${p.id}">Não é isso</button>
          </div>
        </div>`
    })
    .join('')

  return `
    <section class="painel">
      <h2>Carteira do cliente <small>o lado de quem compra</small></h2>

      <div class="campo">
        <label for="cliente">Cliente</label>
        <select id="cliente" data-campo="cliente">${opcoesCliente(cliente.id)}</select>
      </div>

      <div class="saldos">
        <div class="saldo">
          <span class="saldo-rotulo">Juntando</span>
          <span class="saldo-valor">${cash(acumulo)}</span>
          <span class="saldo-nota">${falta > 0 ? `faltam ${cash(falta)} pra liberar` : 'já dá pra liberar'}</span>
        </div>
        <div class="saldo">
          <span class="saldo-rotulo">Pra gastar</span>
          <span class="saldo-valor">${cash(disponivel)}</span>
          <span class="saldo-nota${diasParaVencer !== null && diasParaVencer <= 7 ? ' urgente' : ''}">${
            vence ? `vence em ${vence} (${diasParaVencer} dia${diasParaVencer === 1 ? '' : 's'})` : 'nada liberado ainda'
          }</span>
        </div>
        ${cartõesRestritos}
      </div>

      <h3>Descer pra gastar</h3>
      <div class="linha">
        <div class="campo">
          <label for="valor-descer">Quanto</label>
          <input type="number" id="valor-descer" min="1" step="5" value="${Math.max(Math.min(acumulo, estado.config.gatilho), 0).toFixed(2)}">
        </div>
        <button data-acao="descer"${podeDescer(estado, cliente.id) ? '' : ' disabled'}>Liberar</button>
      </div>
      <p class="saldo-nota">
        Só o que descer ganha prazo de ${estado.config.prazoGastoDias} dias. O que ficar juntando não corre relógio —
        por isso quem escolhe quanto descer é o cliente.
      </p>

      ${cobrancas || '<p class="vazio">Nenhuma cobrança esperando confirmação.</p>'}

      <h3>Pode usar agora</h3>
      <p class="saldo-nota">
        ${estado.lojas
          .map((l) => `${escapar(l.nome)}: <strong>${cash(podeUsarNaLoja(estado, cliente.id, l.id))}</strong>`)
          .join(' · ')}
      </p>
    </section>`
}

function painelRede(): string {
  return `
    <section class="painel">
      <h2>A rede <small>o fundo e o relógio</small></h2>

      <h3>Campanha com o fundo</h3>
      <div class="linha">
        <div class="campo">
          <label for="cliente-brinde">Dar para</label>
          <select id="cliente-brinde">${opcoesCliente(selecao.cliente)}</select>
        </div>
        <div class="campo">
          <label for="valor-brinde">Quanto</label>
          <input type="number" id="valor-brinde" min="1" step="5" value="20">
        </div>
        <button class="secundario" data-acao="brinde">Distribuir</button>
      </div>
      <p class="saldo-nota">
        Brinde sai do fundo, que tem lastro — nunca do nada. Se o fundo estiver vazio, a plataforma
        precisa depositar dinheiro de verdade antes, igual a qualquer lojista.
      </p>

      <h3>Passar o tempo</h3>
      <div class="linha">
        <button class="discreto" data-acao="avancar" data-dias="7">+7 dias</button>
        <button class="discreto" data-acao="avancar" data-dias="30">+30 dias</button>
        <button class="discreto" data-acao="avancar" data-dias="366">+1 ano</button>
      </div>
      <p class="saldo-nota">
        Avance e veja o saldo vencer: o que ninguém usou sai da carteira do cliente e vira fundo de
        promoção da rede. A conferência lá em cima continua batendo o tempo todo.
      </p>
    </section>`
}

function painelExtrato(): string {
  const eventos = [...estado.lancamentos].reverse().slice(0, 40)
  if (eventos.length === 0) return ''
  const linhas = eventos
    .map((l) => {
      const tom = l.tipo === 'saque' || l.tipo === 'vencimento' || l.tipo === 'taxa' ? 'sai' : 'entra'
      const unidade = l.tipo === 'deposito' || l.tipo === 'saque' ? reais(l.valor) : cash(l.valor)
      return `
        <div class="evento">
          <span class="evento-data">${l.em}</span>
          <span class="evento-texto">${escapar(l.descricao)}</span>
          <span class="evento-valor ${tom}">${unidade}</span>
        </div>`
    })
    .join('')
  return `
    <section class="painel largura-total">
      <h2>Extrato da rede <small>tudo que aconteceu, na ordem</small></h2>
      <div class="extrato">${linhas}</div>
    </section>`
}

function desenhar(): void {
  const raiz = document.getElementById('app')
  if (!raiz) return
  raiz.innerHTML = `
    <header class="topo">
      <div class="marca">
        <strong>${MARCA.nome}</strong>
        <span>${MARCA.tagline}</span>
      </div>
      <span class="tarja">Demonstração · guarda no seu navegador</span>
      <div class="topo-direita">
        <span class="relogio">hoje: ${estado.hoje}</span>
        <button class="discreto" data-acao="reiniciar">Recomeçar do zero</button>
      </div>
    </header>

    <main class="conteudo">
      ${recado ? `<div class="aviso ${recado.tom === 'bom' ? 'bom' : 'ruim'} largura-total">${escapar(recado.texto)}</div>` : ''}
      ${painelConferencia()}
      ${painelLoja()}
      ${painelCliente()}
      ${painelRede()}
      ${painelExtrato()}
    </main>

    <footer class="rodape">
      Nada aqui fala com servidor: é tudo no seu navegador, para ver o modelo funcionando.
      O motor que move o dinheiro é o mesmo que vai rodar contra banco quando o ${MARCA.nome} tiver o dele.
    </footer>`
  recado = null
}

// --- ações --------------------------------------------------------------------

function numero(id: string): number {
  const campo = document.getElementById(id) as HTMLInputElement | null
  return campo ? Number(campo.value) : 0
}

function texto(id: string): string {
  const campo = document.getElementById(id) as HTMLSelectElement | null
  return campo ? campo.value : ''
}

function marcado(id: string): boolean {
  const campo = document.getElementById(id) as HTMLInputElement | null
  return campo ? campo.checked : false
}

function comAviso(fn: () => string): void {
  try {
    const mensagem = fn()
    recado = { texto: mensagem, tom: 'bom' }
    salvar()
  } catch (erro) {
    if (erro instanceof ErroDeRegra) {
      recado = { texto: erro.message, tom: 'ruim' }
    } else {
      // Invariante quebrada cai aqui. Não é para acontecer -- e se acontecer,
      // a tela precisa gritar, não seguir mostrando saldo bonito.
      recado = { texto: `Erro grave: ${(erro as Error).message}`, tom: 'ruim' }
    }
  }
  desenhar()
}

function agir(acao: string, alvo: HTMLElement): void {
  const loja = selecao.loja
  const nomeLoja = estado.lojas.find((l) => l.id === loja)?.nome ?? loja

  switch (acao) {
    case 'depositar':
      return comAviso(() => {
        const valor = numero('deposito')
        depositar(estado, loja, valor)
        return `${nomeLoja} depositou ${reais(valor)} e recebeu ${cash(valor)} de crédito.`
      })

    case 'cashback':
      return comAviso(() => {
        const cliente = texto('cliente-cashback')
        const compra = numero('compra-cashback')
        const lanc = darCashback(estado, loja, cliente, compra, {
          presencial: marcado('presencial'),
          restrito: marcado('restrito'),
        })
        return lanc.descricao
      })

    case 'cobrar':
      return comAviso(() => {
        const cliente = texto('cliente-cobranca')
        pedirPagamento(estado, loja, cliente, numero('compra-cobranca'), numero('cash-cobranca'))
        selecao.cliente = cliente
        return 'Cobrança enviada: agora o cliente confirma na carteira dele.'
      })

    case 'confirmar':
      return comAviso(() => {
        const lanc = confirmarPagamento(estado, alvo.dataset.id ?? '')
        return lanc.descricao
      })

    case 'recusar':
      return comAviso(() => {
        estado.pagamentosPendentes = estado.pagamentosPendentes.filter((p) => p.id !== alvo.dataset.id)
        return 'Cobrança recusada. Nada saiu do saldo.'
      })

    case 'descer':
      return comAviso(() => {
        const lanc = descerParaGastar(estado, selecao.cliente, numero('valor-descer'))
        return lanc.descricao
      })

    case 'reciclar':
      return comAviso(() => {
        const valor = numero('valor-saque')
        reciclar(estado, loja, valor)
        return `${nomeLoja} reciclou ${cash(valor)} — virou crédito de novo, sem taxa.`
      })

    case 'sacar':
      return comAviso(() => {
        const { taxa, recebeEmReais } = sacar(estado, loja, numero('valor-saque'))
        return `${nomeLoja} recebeu ${reais(recebeEmReais)} na conta. A taxa de ${cash(taxa)} foi para o fundo de promoção.`
      })

    case 'brinde':
      return comAviso(() => {
        const cliente = texto('cliente-brinde')
        const valor = numero('valor-brinde')
        distribuirPromocao(estado, cliente, valor)
        return `Campanha: ${cash(valor)} distribuídos do fundo.`
      })

    case 'avancar':
      return comAviso(() => {
        const dias = Number(alvo.dataset.dias ?? 0)
        const vencidos = avancarDias(estado, dias)
        const total = vencidos.reduce((s, l) => s + l.valor, 0)
        return vencidos.length === 0
          ? `Passaram ${dias} dias. Nada venceu.`
          : `Passaram ${dias} dias. Venceram ${cash(total)} sem uso, e viraram fundo de promoção.`
      })

    case 'reiniciar':
      estado = semear()
      selecao = { loja: estado.lojas[0].id, cliente: estado.clientes[0].id }
      salvar()
      recado = { texto: 'Recomeçado do zero.', tom: 'bom' }
      return desenhar()
  }
}

function iniciar(): void {
  estado = carregar()
  selecao = { loja: estado.lojas[0].id, cliente: estado.clientes[0].id }

  document.addEventListener('click', (evento) => {
    const alvo = (evento.target as HTMLElement).closest<HTMLElement>('[data-acao]')
    if (!alvo) return
    agir(alvo.dataset.acao ?? '', alvo)
  })

  document.addEventListener('change', (evento) => {
    const alvo = evento.target as HTMLElement
    const campo = alvo.dataset.campo
    if (campo === 'loja') selecao.loja = (alvo as HTMLSelectElement).value
    if (campo === 'cliente') selecao.cliente = (alvo as HTMLSelectElement).value
    if (campo) desenhar()
  })

  desenhar()
}

iniciar()
