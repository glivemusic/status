// D13: o que é puro na gravação do ramo `dados` (o laço com git mora em scripts/gravar-dados.mjs).
import { diaDeAssuncao, emMs } from './tempo.mjs';

export const RAMO = 'refs/heads/dados';
export const TENTATIVAS = 4;
export const ESPERA_MIN_MS = 1_000;
export const ESPERA_MAX_MS = 4_000;
export const CHAVE_DO_CABECALHO = 'http.https://github.com/.extraheader';
export const AUTOR = { nome: 'github-actions[bot]', email: '41898282+github-actions[bot]@users.noreply.github.com' };

// Uma vez por dia o ramo vira um commit só: quando o commit mais velho (`raizes`: as datas ISO dos commits sem
// pai do ramo buscado) é de um dia de Assunção anterior ao de `agora`. Raiz do mesmo dia ou de depois (uma
// operação medida antes da meia-noite que grava depois da recriação) não recria.
export function precisaRecriar(raizes, agora) {
  const datas = raizes.map(emMs).filter(Number.isFinite);
  if (datas.length === 0) return false;
  return diaDeAssuncao(Math.min(...datas)) < diaDeAssuncao(agora);
}

// A saída de um `git push --porcelain` que falhou -> 'recusado' (vale nova tentativa) | 'outro' (falha na hora).
// Recusado: não é avanço rápido, o remoto tem o que não buscamos, o lease não confere, ou o remoto não
// conseguiu trocar a referência porque outra gravação a trocou no mesmo instante: na linha `[remote rejected]`,
// a ref que outra gravação criou depois de o remoto anunciar as refs e antes de atualizar (`reference already
// exists`, o começo do ramo em dois gravadores), a que mudou no meio (`incorrect old value`, o lease do lado do
// remoto) e as de trava (`failed to update ref`, `failed to lock`, `cannot lock ref`). `failed to update ref` é o
// relato genérico do git mais velho e cobre também a ref criada no meio.
// O motivo só conta dentro dos parênteses de uma linha de estado `[rejected]`/`[remote rejected]`, presa ao começo
// (o `!\t<ref>\t` da porcelana ou o ` ! ` humano) e ao fim da linha: o mesmo texto solto no stderr
// (`remote: error: ...`), uma linha que o remoto injeta (sempre com o prefixo `remote: `), um gancho que recusa,
// erro de rede, de permissão ou de autenticação é 'outro'.
const INICIO = String.raw`^(?:!\t[^\t\n]+\t| ! )`;
const RECUSAS = [
  new RegExp(String.raw`${INICIO}\[rejected\][^\n]*\((non-fast-forward|fetch first|stale info)\)$`, 'm'),
  new RegExp(
    String.raw`${INICIO}\[remote rejected\][^\n]*\((reference already exists|failed to update ref|failed to lock|cannot lock ref[^)\n]*|incorrect old value[^)\n]*)\)$`,
    'm',
  ),
];
export function classificarPush(saida) {
  return RECUSAS.some((r) => r.test(saida)) ? 'recusado' : 'outro';
}

// A espera entre tentativas, com variação: um inteiro em [minMs, maxMs]. `aleatorio` devolve [0, 1).
export function esperaComVariacao(aleatorio, minMs = ESPERA_MIN_MS, maxMs = ESPERA_MAX_MS) {
  const de = Math.max(0, Math.min(minMs, maxMs));
  const ate = Math.max(minMs, maxMs, 0);
  return de + Math.floor(aleatorio() * (ate - de + 1));
}

// O ambiente de todo filho git: sem o token, sem rastreio (que imprimiria cabeçalhos), sem configuração por
// ambiente herdada, sem pergunta no terminal e com mensagens em inglês fixo (para `classificarPush`).
// Só com `token` (no push) entra o cabeçalho, por GIT_CONFIG_COUNT/KEY_0/VALUE_0: nunca em argv nem em arquivo.
export function ambienteDoGit(base, token = '') {
  const env = {};
  for (const [k, v] of Object.entries(base ?? {})) {
    if (v === undefined) continue;
    if (k === 'GH_TOKEN' || k === 'GITHUB_TOKEN') continue;
    if (/^GIT_(TRACE|CURL_VERBOSE|CONFIG_(COUNT|KEY_|VALUE_|PARAMETERS))/.test(k)) continue;
    env[k] = v;
  }
  env.LC_ALL = 'C';
  env.GIT_TERMINAL_PROMPT = '0';
  if (token) {
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = CHAVE_DO_CABECALHO;
    env.GIT_CONFIG_VALUE_0 = cabecalhoDoToken(token);
  }
  return env;
}

export function cabecalhoDoToken(token) {
  return `AUTHORIZATION: basic ${btoa(`x-access-token:${token}`)}`;
}

// Tira o token (e o cabeçalho dele) de um texto que vai ao log.
export function semToken(texto, token = '') {
  if (!token) return texto;
  let limpo = texto;
  for (const segredo of [cabecalhoDoToken(token), btoa(`x-access-token:${token}`), token]) {
    limpo = limpo.split(segredo).join('***');
  }
  return limpo;
}

// A mensagem do commit: a da operação, marcada quando o ramo começa ou é recriado.
export function mensagemDoCommit(mensagem, { criou, recriou }) {
  if (criou) return `Dados: começo. ${mensagem}`;
  if (recriou) return `Dados: recriados. ${mensagem}`;
  return mensagem;
}

// A data do commit no formato interno do git ('<segundos> +0000').
export function dataDoGit(instante) {
  return `${Math.floor(emMs(instante) / 1000)} +0000`;
}
