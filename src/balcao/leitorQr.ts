// ---------------------------------------------------------------------------
// A CÂMERA DO BALCÃO.
//
// Lê o QR da carteirinha pelo `BarcodeDetector` nativo onde ele existe (Chrome
// no Android) e pela biblioteca `jsQR` onde não existe -- o iPhone, que é metade
// do balcão. A `jsQR` só é baixada quando o nativo falta.
//
// A estratégia é a mesma do `LeitorQr` do `drrodrigo/clubeprime`, que já roda no
// balcão do Clube; o código é outro porque aqui não há React. Se um dia o de lá
// aprender alguma coisa (aparelho que declara o detector e falha, por exemplo),
// vale trazer.
//
// 🔴 E EXISTE UM SEGUNDO CAMINHO QUE FUNCIONA DE VERDADE: digitar o código. Sem
// ele, um computador de balcão sem câmera -- ou uma permissão negada sem querer
// -- deixaria o vendedor com uma tela que não faz nada. Botão que não faz nada é
// porta pintada na parede.
// ---------------------------------------------------------------------------

type DetectorNativo = {
  detect(fonte: CanvasImageSource): Promise<Array<{ rawValue: string }>>
}

type ConstrutorDetector = {
  new (opcoes: { formats: string[] }): DetectorNativo
  getSupportedFormats(): Promise<string[]>
}

type Decodificador = (video: HTMLVideoElement) => Promise<string | null>

export type EstadoDaCamera = 'ligando' | 'lendo' | 'negada' | 'sem-camera' | 'falhou'

const ENTRE_QUADROS_MS = 250
// Depois de uma leitura, espera antes de ler de novo: o mesmo QR continua na
// frente da câmera, e o token dele só vale uma vez.
const DEPOIS_DE_LER_MS = 2500

async function criarDecodificador(): Promise<Decodificador> {
  const Nativo = (globalThis as unknown as { BarcodeDetector?: ConstrutorDetector }).BarcodeDetector
  if (Nativo) {
    try {
      if ((await Nativo.getSupportedFormats()).includes('qr_code')) {
        const detector = new Nativo({ formats: ['qr_code'] })
        return async (video) => (await detector.detect(video))[0]?.rawValue ?? null
      }
    } catch {
      // Alguns aparelhos declaram o detector e falham ao usar: segue para a jsQR.
    }
  }

  const { default: jsQR } = await import('jsqr')
  const canvas = document.createElement('canvas')
  const contexto = canvas.getContext('2d', { willReadFrequently: true })

  return async (video) => {
    if (!contexto || !video.videoWidth) return null
    // 640 px de largura bastam para o QR de uma tela de celular e poupam bateria.
    const escala = Math.min(1, 640 / video.videoWidth)
    canvas.width = Math.round(video.videoWidth * escala)
    canvas.height = Math.round(video.videoHeight * escala)
    contexto.drawImage(video, 0, 0, canvas.width, canvas.height)
    const quadro = contexto.getImageData(0, 0, canvas.width, canvas.height)
    // A carteirinha mostra QR escuro em fundo branco: não precisa tentar invertido.
    return jsQR(quadro.data, quadro.width, quadro.height, { inversionAttempts: 'dontInvert' })?.data ?? null
  }
}

export interface Leitor {
  /** O `<video>` para pendurar na tela. */
  video: HTMLVideoElement
  /** Desliga a câmera. Chamar SEMPRE ao sair da tela: luz acesa assusta. */
  parar(): void
}

/**
 * Liga a câmera e chama `aoLer` a cada QR reconhecido.
 *
 * `aoMudarEstado` recebe cada passo para a tela poder DIZER o que está
 * acontecendo -- "ligando", "negada", "sem câmera". Tela que fica preta sem
 * explicação manda o vendedor chamar o suporte.
 */
export async function ligarCamera(
  aoLer: (texto: string) => void,
  aoMudarEstado: (e: EstadoDaCamera) => void,
): Promise<Leitor> {
  const video = document.createElement('video')
  video.setAttribute('playsinline', 'true')
  video.muted = true

  let parado = false
  let fluxo: MediaStream | null = null
  let relogio: ReturnType<typeof setTimeout> | null = null

  const parar = () => {
    parado = true
    if (relogio) clearTimeout(relogio)
    for (const t of fluxo?.getTracks() ?? []) t.stop()
  }

  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    aoMudarEstado('sem-camera')
    return { video, parar }
  }

  aoMudarEstado('ligando')
  try {
    // `environment`: a câmera de trás, que é a que aponta para o celular do
    // cliente. A da frente filmaria o vendedor.
    fluxo = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    })
  } catch (e) {
    const nome = (e as { name?: string })?.name
    aoMudarEstado(nome === 'NotAllowedError' ? 'negada' : nome === 'NotFoundError' ? 'sem-camera' : 'falhou')
    return { video, parar }
  }

  if (parado) {
    for (const t of fluxo.getTracks()) t.stop()
    return { video, parar }
  }

  video.srcObject = fluxo
  await video.play().catch(() => undefined)

  let decodificar: Decodificador
  try {
    decodificar = await criarDecodificador()
  } catch {
    aoMudarEstado('falhou')
    parar()
    return { video, parar }
  }

  aoMudarEstado('lendo')

  const olhar = async () => {
    if (parado) return
    let lido: string | null = null
    try {
      lido = await decodificar(video)
    } catch {
      // Um quadro ruim não derruba a leitura: tenta o próximo.
    }
    if (parado) return
    if (lido) {
      aoLer(lido)
      relogio = setTimeout(olhar, DEPOIS_DE_LER_MS)
    } else {
      relogio = setTimeout(olhar, ENTRE_QUADROS_MS)
    }
  }
  void olhar()

  return { video, parar }
}
