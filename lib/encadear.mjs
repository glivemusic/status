// D20: a checagem se encadeia. O que é puro: a conta da espera, o teto diário e os runs que impedem o disparo.
// A hora entra por parâmetro (ISO ou ms); nada aqui lê o relógio. O CLI é scripts/encadear.mjs.
import { diaDeAssuncao, emMs } from './tempo.mjs';

export const MIN_DESDE_O_INICIO_S = 5 * 60;
export const ESPERA_MIN_S = 60;
// Cabe no `timeout-minutes: 8` do job, com folga para o checkout, o node e as chamadas ao gh.
export const ESPERA_MAX_S = 420;
export const TETO_DIARIO = 300;

const MINUTO_MS = 60_000;

// O minuto (UTC) do horário de checagem: ≡ 2 módulo 5 (XX:X2 e XX:X7), como o `schedule`.
function minutoDeChecagem(ms) {
  return new Date(ms).getUTCMinutes() % 5 === 2;
}

// Os segundos (inteiros) que o `encadear` espera antes de disparar o próximo run.
// - piso: nunca antes de 5 min do início do run (condição do coordenador) e nunca menos de 60 s. Início ausente,
//   inválido ou no futuro vale como `agora` (piso de 300 s);
// - depois do piso, até o começo do próximo minuto ≡ 2 módulo 5 (se o piso já cai num deles, fica o piso);
// - se esse alinhamento passa de 420 s, fica o piso (o timeout do job manda; o piso nunca é violado).
export function segundosDeEspera(agora, inicioDoRun) {
  const agoraMs = emMs(agora);
  if (!Number.isFinite(agoraMs)) throw new TypeError('segundosDeEspera: `agora` não é uma data.');
  let inicioMs = inicioDoRun == null ? NaN : emMs(inicioDoRun);
  if (!Number.isFinite(inicioMs) || inicioMs > agoraMs) inicioMs = agoraMs;

  const piso = Math.max(ESPERA_MIN_S, Math.ceil((inicioMs + MIN_DESDE_O_INICIO_S * 1000 - agoraMs) / 1000));
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

// Uma corrente só: os runs da checagem que não terminaram (fila, rodando, esperando…), fora o próprio.
// `runs` que não é lista -> null (a resposta não serve; quem chama não dispara).
export function outrosRunsAtivos(runs, proprioId) {
  if (!Array.isArray(runs)) return null;
  return runs.filter(
    (r) => r !== null && typeof r === 'object' && r.status !== 'completed' && String(r.id) !== String(proprioId),
  );
}
