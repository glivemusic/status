// D20: a checagem se encadeia. O que é puro: a conta da espera, o teto diário e os runs que impedem o disparo.
// D25: a espera da reserva e a nova tentativa do disparo.
// A hora entra por parâmetro (ISO ou ms); nada aqui lê o relógio nem espera de verdade. O CLI é scripts/encadear.mjs.
import { diaDeAssuncao, emMs } from './tempo.mjs';

export const MIN_DESDE_O_INICIO_S = 5 * 60;
export const ESPERA_MIN_S = 60;
// Cabe no `timeout-minutes: 9` do job (D25), com folga para o checkout, o node, as chamadas ao gh e as novas
// tentativas do disparo (até 45 s de espera a mais).
export const ESPERA_MAX_S = 420;
export const TETO_DIARIO = 300;
// D25: o disparo pela API tenta até 3 vezes no total, com 15 s antes da 2ª e 30 s antes da 3ª.
export const TENTATIVAS_DISPARO = 3;
export const ESPERAS_DISPARO_S = [15, 30];

const MINUTO_MS = 60_000;

// O minuto (UTC) do horário de checagem: ≡ 2 módulo 5 (XX:X2 e XX:X7), como o `schedule`.
function minutoDeChecagem(ms) {
  return new Date(ms).getUTCMinutes() % 5 === 2;
}

// D25: a espera do job `reserva`, sem o horário nem o piso de 60 s: só o que falta para os 5 min desde o início do
// run (0 se já passou, o caso normal). Início ausente, inválido ou no futuro vale como `agora` (300 s).
export function segundosDeEsperaReserva(agora, inicioDoRun) {
  const agoraMs = emMs(agora);
  if (!Number.isFinite(agoraMs)) throw new TypeError('A espera: `agora` não é uma data.');
  let inicioMs = inicioDoRun == null ? NaN : emMs(inicioDoRun);
  if (!Number.isFinite(inicioMs) || inicioMs > agoraMs) inicioMs = agoraMs;
  return Math.max(0, Math.ceil((inicioMs + MIN_DESDE_O_INICIO_S * 1000 - agoraMs) / 1000));
}

// Os segundos (inteiros) que o `encadear` espera antes de disparar o próximo run.
// - piso: nunca antes de 5 min do início do run (condição do coordenador; a espera da reserva) e nunca menos de
//   60 s. Início ausente, inválido ou no futuro vale como `agora` (piso de 300 s);
// - depois do piso, até o começo do próximo minuto ≡ 2 módulo 5 (se o piso já cai num deles, fica o piso);
// - se esse alinhamento passa de 420 s, fica o piso (o timeout do job manda; o piso nunca é violado).
export function segundosDeEspera(agora, inicioDoRun) {
  const piso = Math.max(ESPERA_MIN_S, segundosDeEsperaReserva(agora, inicioDoRun));
  const agoraMs = emMs(agora);
  const alvoMs = agoraMs + piso * 1000;
  let alinhado = piso;
  if (!minutoDeChecagem(alvoMs)) {
    let proximoMs = Math.floor(alvoMs / MINUTO_MS) * MINUTO_MS + MINUTO_MS;
    while (!minutoDeChecagem(proximoMs)) proximoMs += MINUTO_MS;
    alinhado = Math.ceil((proximoMs - agoraMs) / 1000);
  }
  return alinhado <= ESPERA_MAX_S ? alinhado : piso;
}

function encadeadosValidos(e) {
  return (
    e !== null &&
    typeof e === 'object' &&
    typeof e.dia === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(e.dia) &&
    Number.isInteger(e.n) &&
    e.n >= 0
  );
}

// O teto diário (condição do coordenador): no máximo `teto` disparos autorizados por dia de Assunção.
// `encadeados`: o `{ dia, n }` do estado.json (ausente ou malformado vale como zero).
// -> { encadeados: { dia, n }, encadear, aviso }; `aviso` é `{ tipo: 'teto-diario', em }` (ISO UTC de `agora`)
//    enquanto o teto vale, e `null` no resto.
export function contarEncadeado(encadeados, agora, teto = TETO_DIARIO) {
  const hoje = diaDeAssuncao(agora);
  const atual = encadeadosValidos(encadeados) && encadeados.dia === hoje ? encadeados : { dia: hoje, n: 0 };
  if (atual.n >= teto) {
    return {
      encadeados: { dia: hoje, n: atual.n },
      encadear: false,
      aviso: { tipo: 'teto-diario', em: new Date(emMs(agora)).toISOString() },
    };
  }
  return { encadeados: { dia: hoje, n: atual.n + 1 }, encadear: true, aviso: null };
}

// Grava o teto no estado (o `aviso` sai quando vem null). -> se o run pode encadear.
export function anotarEncadeado(estado, agora, teto = TETO_DIARIO) {
  const { encadeados, encadear, aviso } = contarEncadeado(estado.encadeados, agora, teto);
  estado.encadeados = encadeados;
  if (aviso) estado.aviso = aviso;
  else delete estado.aviso;
  return encadear;
}

// D25: o status HTTP da saída de erro do gh («… HTTP 500: …») -> número, ou null (sem status: erro de rede).
export function statusDoErro(stderr) {
  const achado = /\bHTTP (\d{3})\b/.exec(String(stderr ?? ''));
  return achado ? Number(achado[1]) : null;
}

// D25: o status que pede nova tentativa: 5xx, ou sem status (null: rede ou outro erro do gh sem HTTP, inclusive o gh
// morto por tempo). Com ele, o disparo que falhou pode ter saído.
export function statusTentavel(status) {
  return status === null || (Number.isInteger(status) && status >= 500 && status <= 599);
}

// D25: depois da `tentativa` (1, 2, 3) que falhou com `status` (número ou null), tenta de novo?
// 5xx ou sem status: sim, com 15 s depois da 1ª e 30 s depois da 2ª; 4xx (e qualquer outro status), ou a 3ª
// esgotada: falha.
export function decidirNovaTentativa({ tentativa, status }) {
  if (!statusTentavel(status) || tentativa >= TENTATIVAS_DISPARO) return { acao: 'falhar' };
  return { acao: 'tentar', esperaS: ESPERAS_DISPARO_S[tentativa - 1] };
}

export const LISTA_INVALIDA = 'lista de runs inválida';

// D25: o disparo com nova tentativa. Tudo de fora entra por parâmetro:
// - `disparar()` -> { ok: true } | { ok: false, status (número | null), detalhe };
// - `listarAtivos()` -> os outros runs ativos (lista) | null (lista inválida); antes de cada nova tentativa, porque o
//   disparo que falhou pode ter criado o run: havendo algum, para sem disparar; lista inválida, falha;
// - `esperar(ms, status)`: `status` é o da tentativa que falhou (para o log).
// -> { resultado: 'disparou' | 'parou' | 'falhou', tentativas, status?, podeTerSaido?, detalhe? }. No 'falhou',
//    `status` é o do último disparo, `podeTerSaido` diz se alguma tentativa falhou com status tentável (5xx ou sem
//    status: o run pode ter sido criado) e `detalhe` é o do último disparo, ou `LISTA_INVALIDA`; no 'parou',
//    `detalhe` é «há run ativo».
export async function dispararComNovaTentativa({ disparar, listarAtivos, esperar }) {
  let podeTerSaido = false;
  for (let tentativa = 1; ; tentativa += 1) {
    const r = await disparar();
    if (r.ok) return { resultado: 'disparou', tentativas: tentativa };
    const status = r.status ?? null;
    podeTerSaido ||= statusTentavel(status);
    const falhou = (detalhe) => ({ resultado: 'falhou', tentativas: tentativa, status, podeTerSaido, detalhe });
    const decisao = decidirNovaTentativa({ tentativa, status });
    if (decisao.acao === 'falhar') return falhou(r.detalhe);
    await esperar(decisao.esperaS * 1000, status);
    const ativos = await listarAtivos();
    if (ativos === null) return falhou(LISTA_INVALIDA);
    if (ativos.length > 0) return { resultado: 'parou', tentativas: tentativa, detalhe: 'há run ativo' };
  }
}

// Uma corrente só: os runs da checagem que não terminaram (fila, rodando, esperando…), fora o próprio.
// `runs` que não é lista -> null (a resposta não serve; quem chama não dispara e, desde a D25, falha).
export function outrosRunsAtivos(runs, proprioId) {
  if (!Array.isArray(runs)) return null;
  return runs.filter(
    (r) => r !== null && typeof r === 'object' && r.status !== 'completed' && String(r.id) !== String(proprioId),
  );
}
