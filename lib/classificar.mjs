// D3: classificar uma checagem; D11: a linha que conta por fato (o satélite); D17: o modo página.
// Um alvo é a linha do config com `url`; as linhas com `alvo: <id>` leem o componente do corpo dele.
// O `modo` do alvo: 'saude' (o padrão: o contrato da rota de saúde, D3) ou 'pagina' (D17: só o status HTTP da
// página pública, sem ler o corpo).
import { linhaPorFato } from './dias.mjs';

export const MODOS = ['saude', 'pagina'];

export const TEMPO_MAXIMO_MS = 10_000;
export const LENTO_MS = 5_000;
export const ESPERA_NOVA_TENTATIVA_MS = 20_000;
export const AGENTE = 'status-agronomy-center';
// D25: o corpo da rota de saúde acima de 4096 bytes é falha, sem ler o resto.
export const CORPO_MAXIMO_BYTES = 4096;
// D25: o motivo da falha da checagem do alvo, no log público. Só estes textos fixos: nada da resposta.
export const MOTIVOS = Object.freeze({
  semResposta: 'sem resposta',
  redirecionado: 'redirecionado',
  grandeDemais: 'resposta grande demais',
  statusInesperado: 'status inesperado',
  foraDoContrato: 'fora do contrato',
});
// D11: fato com mais de 5 h é velho demais e vale como `sem_dado`.
export const IDADE_MAXIMA_S = 18_000;

const VALORES = new Set(['ok', 'degradado', 'fora']);
const VALORES_DO_FATO = new Set(['ok', 'degradado']);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function dataIso(valor) {
  return typeof valor === 'string' && ISO.test(valor) && !Number.isNaN(Date.parse(valor));
}

function objeto(valor) {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}

// O corpo segue o contrato da rota de saúde?
// `livres`: os componentes das linhas por fato (D11); o valor deles não invalida o corpo.
export function corpoValido(corpo, livres = []) {
  if (!objeto(corpo)) return false;
  if (typeof corpo.sistema !== 'string') return false;
  if (!VALORES.has(corpo.estado)) return false;
  if (!dataIso(corpo.verificado_em)) return false;
  const c = corpo.componentes;
  if (!objeto(c)) return false;
  return Object.entries(c).every(([nome, v]) => livres.includes(nome) || VALORES.has(v));
}

const statusDoContrato = (status) => status === 200 || status === 503;
const redirecionamento = (status) => Number.isInteger(status) && status >= 300 && status <= 399;

// `resposta`: { status, corpo (texto), duracaoMs } de `chamar`; com `motivo` e sem corpo quando a chamada falhou
// (rede, tempo, redirecionamento, corpo grande demais). null também vale como sem resposta.
function lerCorpo(resposta, livres) {
  if (!resposta || resposta.motivo || !statusDoContrato(resposta.status)) return null;
  let json;
  try {
    json = JSON.parse(resposta.corpo);
  } catch {
    return null;
  }
  return corpoValido(json, livres) ? json : null;
}

function componente(json, nome) {
  return Object.hasOwn(json.componentes, nome) ? json.componentes[nome] : 'sem_dado';
}

// D11: o valor de uma linha por fato e o `verificado_em` do fato (ISO normalizado), ou null.
// `sem_dado` sem corpo, com valor fora de ok|degradado, sem o objeto do fato ou com idade acima de 5 h.
export function lerFato(json, linha) {
  const vazio = { estado: 'sem_dado', verificado_em: null };
  if (!json) return vazio;
  const valor = componente(json, linha.componente);
  const fato = Object.hasOwn(json, linha.componente) ? json[linha.componente] : null;
  if (!VALORES_DO_FATO.has(valor) || !objeto(fato)) return vazio;
  const { verificado_em: em, idade_s: idade } = fato;
  if (!dataIso(em) || typeof idade !== 'number' || !Number.isFinite(idade) || idade < 0) return vazio;
  if (idade > IDADE_MAXIMA_S) return vazio;
  return { estado: valor, verificado_em: new Date(em).toISOString() };
}

// D25: por que não houve corpo válido. O status chega antes do corpo: fora de 200/503 (e não 3xx) é «status
// inesperado» (e `chamar` nem lê o corpo).
function motivoSemCorpo(resposta) {
  if (!resposta || !Number.isInteger(resposta.status)) return MOTIVOS.semResposta;
  if (redirecionamento(resposta.status)) return MOTIVOS.redirecionado;
  if (!statusDoContrato(resposta.status)) return MOTIVOS.statusInesperado;
  return resposta.motivo ?? MOTIVOS.foraDoContrato;
}

function livresDe(dependentes) {
  return dependentes.filter(linhaPorFato).map((d) => d.componente);
}

// -> { resultados: { <id da linha>: 'ok' | 'degradado' | 'fora' | 'sem_dado' },
//      fatos: { <id da linha por fato>: verificado_em | null },
//      motivo (D25, só sem corpo válido): um dos `MOTIVOS` }
// A linha por fato nunca sai `fora` (D11).
export function classificarComFatos(resposta, alvo, dependentes = []) {
  const json = lerCorpo(resposta, livresDe(dependentes));
  const resultados = {};
  const fatos = {};
  if (json) {
    let proprio = componente(json, alvo.componente);
    if (proprio === 'ok' && resposta.duracaoMs > LENTO_MS) proprio = 'degradado';
    resultados[alvo.id] = proprio;
  } else {
    resultados[alvo.id] = 'fora';
  }
  for (const d of dependentes) {
    if (linhaPorFato(d)) {
      const fato = lerFato(json, d);
      resultados[d.id] = fato.estado;
      fatos[d.id] = fato.verificado_em;
    } else {
      resultados[d.id] = json ? componente(json, d.componente) : 'sem_dado';
    }
  }
  return json ? { resultados, fatos } : { resultados, fatos, motivo: motivoSemCorpo(resposta) };
}

// -> { <id da linha>: 'ok' | 'degradado' | 'fora' | 'sem_dado' }
export function classificar(resposta, alvo, dependentes = []) {
  return classificarComFatos(resposta, alvo, dependentes).resultados;
}

// O modo do alvo (D17). Modo fora da lista é erro de config, não queda do serviço.
export function modoDoAlvo(alvo) {
  const modo = alvo.modo ?? 'saude';
  if (!MODOS.includes(modo)) throw new Error(`Modo desconhecido no alvo ${alvo.id}: ${JSON.stringify(modo)}.`);
  return modo;
}

// D17: o modo página. `resposta`: { status, duracaoMs }, ou null quando a chamada falhou (rede, tempo).
// ok: 2xx ou 3xx em até 5 s; degradado: 2xx ou 3xx acima de 5 s; fora: rede, tempo estourado (10 s), 4xx, 5xx ou
// qualquer outro status. As linhas que dependeriam do corpo ficam `sem_dado` (não há corpo).
// D25: fora, leva o `motivo`: «sem resposta» (rede, tempo estourado) ou «status inesperado».
export function classificarPagina(resposta, alvo, dependentes = []) {
  const chegou = resposta && Number.isInteger(resposta.status) && resposta.duracaoMs <= TEMPO_MAXIMO_MS;
  const respondeu = chegou && resposta.status >= 200 && resposta.status <= 399;
  let proprio = 'fora';
  if (respondeu) proprio = resposta.duracaoMs > LENTO_MS ? 'degradado' : 'ok';
  const resultados = { [alvo.id]: proprio };
  const fatos = {};
  for (const d of dependentes) {
    resultados[d.id] = 'sem_dado';
    if (linhaPorFato(d)) fatos[d.id] = null;
  }
  if (respondeu) return { resultados, fatos };
  return { resultados, fatos, motivo: chegou ? MOTIVOS.statusInesperado : MOTIVOS.semResposta };
}

// Cancela um corpo (ou o leitor dele) sem ler. Cancelar o que falhou não muda o resultado: o status já chegou.
async function cancelar(fluxo) {
  try {
    await fluxo?.cancel();
  } catch {
    // nada a fazer
  }
}

// D25: lê o corpo em fluxo até `CORPO_MAXIMO_BYTES`; passou, cancela sem ler o resto e devolve null.
// Corpo nulo é corpo vazio. O UTF-8 só é decodificado no fim.
async function lerAteOLimite(corpo) {
  if (!corpo) return '';
  const leitor = corpo.getReader();
  const pedacos = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > CORPO_MAXIMO_BYTES) {
      await cancelar(leitor);
      return null;
    }
    pedacos.push(value);
  }
  const bytes = new Uint8Array(total);
  let pos = 0;
  for (const p of pedacos) {
    bytes.set(p, pos);
    pos += p.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

// Uma chamada à rota de saúde. `fetch` e `relogio` (ms) entram por parâmetro.
// D25: não segue redirecionamento nem leva cookie ou credencial (só o User-Agent), como `chamarPagina`.
// -> { status, corpo (texto), duracaoMs }; na falha, `motivo` no lugar do corpo: { motivo } sem resposta (rede,
//    tempo, erro na leitura do corpo) e { status, duracaoMs, motivo } no 3xx e no status fora de 200/503 (o corpo é
//    cancelado sem ler) ou no corpo acima de 4096 bytes.
export async function chamar(url, { fetch, relogio }) {
  const inicio = relogio();
  try {
    const r = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': AGENTE },
      redirect: 'manual',
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(TEMPO_MAXIMO_MS),
    });
    // 3xx ou status fora de 200/503: o corpo não serve; é cancelado sem ler.
    if (!statusDoContrato(r.status)) {
      const duracaoMs = relogio() - inicio;
      await cancelar(r.body);
      const motivo = redirecionamento(r.status) ? MOTIVOS.redirecionado : MOTIVOS.statusInesperado;
      return { status: r.status, duracaoMs, motivo };
    }
    const corpo = await lerAteOLimite(r.body);
    const duracaoMs = relogio() - inicio;
    if (corpo === null) return { status: r.status, duracaoMs, motivo: MOTIVOS.grandeDemais };
    return { status: r.status, corpo, duracaoMs };
  } catch {
    return { motivo: MOTIVOS.semResposta };
  }
}

// D17: uma chamada à página pública. Não segue o redirecionamento (não entra no app), não leva cookie nem
// credencial (só o User-Agent) e não lê o corpo: só o fecha. -> { status, duracaoMs } | null
export async function chamarPagina(url, { fetch, relogio }) {
  const inicio = relogio();
  try {
    const r = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': AGENTE },
      redirect: 'manual',
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(TEMPO_MAXIMO_MS),
    });
    const duracaoMs = relogio() - inicio;
    await cancelar(r.body);
    return { status: r.status, duracaoMs };
  } catch {
    return null;
  }
}

// Checa um alvo; se alguma linha saiu `fora`, espera 20 s e vale a segunda chamada (e o motivo dela).
// -> { resultados, fatos, motivo? }, como em `classificarComFatos` e `classificarPagina`.
export async function checarAlvo(alvo, dependentes, { fetch, relogio, esperar }) {
  const pagina = modoDoAlvo(alvo) === 'pagina';
  const medir = async () =>
    pagina
      ? classificarPagina(await chamarPagina(alvo.url, { fetch, relogio }), alvo, dependentes)
      : classificarComFatos(await chamar(alvo.url, { fetch, relogio }), alvo, dependentes);
  let saida = await medir();
  if (Object.values(saida.resultados).includes('fora')) {
    await esperar(ESPERA_NOVA_TENTATIVA_MS);
    saida = await medir();
  }
  return saida;
}
