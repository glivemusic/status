// D3: classificar uma checagem.
// Um alvo é a linha do config com `url`; as linhas com `alvo: <id>` leem o componente do corpo dele.

export const TEMPO_MAXIMO_MS = 10_000;
export const LENTO_MS = 5_000;
export const ESPERA_NOVA_TENTATIVA_MS = 20_000;
export const AGENTE = 'status-agronomy-center';

const VALORES = new Set(['ok', 'degradado', 'fora']);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

// O corpo segue o contrato da rota de saúde?
export function corpoValido(corpo) {
  if (corpo === null || typeof corpo !== 'object' || Array.isArray(corpo)) return false;
  if (typeof corpo.sistema !== 'string') return false;
  if (!VALORES.has(corpo.estado)) return false;
  if (typeof corpo.verificado_em !== 'string' || !ISO.test(corpo.verificado_em)) return false;
  if (Number.isNaN(Date.parse(corpo.verificado_em))) return false;
  const c = corpo.componentes;
  if (c === null || typeof c !== 'object' || Array.isArray(c)) return false;
  return Object.values(c).every((v) => VALORES.has(v));
}

// `resposta`: { status, corpo (texto), duracaoMs }, ou null quando a chamada falhou (rede, tempo).
function lerCorpo(resposta) {
  if (!resposta || (resposta.status !== 200 && resposta.status !== 503)) return null;
  let json;
  try {
    json = JSON.parse(resposta.corpo);
  } catch {
    return null;
  }
  return corpoValido(json) ? json : null;
}

function componente(json, nome) {
  return Object.hasOwn(json.componentes, nome) ? json.componentes[nome] : 'sem_dado';
}

// -> { <id da linha>: 'ok' | 'degradado' | 'fora' | 'sem_dado' }
export function classificar(resposta, alvo, dependentes = []) {
  const json = lerCorpo(resposta);
  const resultado = {};
  if (!json) {
    resultado[alvo.id] = 'fora';
    for (const d of dependentes) resultado[d.id] = 'sem_dado';
    return resultado;
  }
  let proprio = componente(json, alvo.componente);
  if (proprio === 'ok' && resposta.duracaoMs > LENTO_MS) proprio = 'degradado';
  resultado[alvo.id] = proprio;
  for (const d of dependentes) resultado[d.id] = componente(json, d.componente);
  return resultado;
}

// Uma chamada. `fetch` e `relogio` (ms) entram por parâmetro.
export async function chamar(url, { fetch, relogio }) {
  const inicio = relogio();
  try {
    const r = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': AGENTE },
      cache: 'no-store',
      signal: AbortSignal.timeout(TEMPO_MAXIMO_MS),
    });
    const corpo = await r.text();
    return { status: r.status, corpo, duracaoMs: relogio() - inicio };
  } catch {
    return null;
  }
}

// Checa um alvo; se alguma linha saiu `fora`, espera 20 s e vale a segunda chamada.
export async function checarAlvo(alvo, dependentes, { fetch, relogio, esperar }) {
  let resultado = classificar(await chamar(alvo.url, { fetch, relogio }), alvo, dependentes);
  if (Object.values(resultado).includes('fora')) {
    await esperar(ESPERA_NOVA_TENTATIVA_MS);
    resultado = classificar(await chamar(alvo.url, { fetch, relogio }), alvo, dependentes);
  }
  return resultado;
}
