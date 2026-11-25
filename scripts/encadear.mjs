// D20: o job `encadear` da checagem. Espera o próximo horário e dispara a própria checagem.yml por
// workflow_dispatch, se não houver outro run dela ativo (uma corrente só).
// D25: o disparo tenta de novo no 5xx e no erro de rede (`dispararComNovaTentativa`), e o modo `--reserva` (o job
// `reserva`, quando o `encadear` falhou) dispara sem esperar o horário, só os 5 min desde o início do run.
//   node scripts/encadear.mjs [--reserva]
//   GITHUB_RUN_ID, GITHUB_REPOSITORY e GH_TOKEN vêm do ambiente do Actions; o `gh` roda sem shell.
// O log é público: a espera em segundos e se disparou; no erro, uma mensagem fixa e, quando o `gh` falha, só a
// primeira linha do stderr dele, cortada em 200 caracteres e sem o token.
import { execFileSync } from 'node:child_process';
import { setTimeout as esperarMs } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import {
  LISTA_INVALIDA,
  dispararComNovaTentativa,
  outrosRunsAtivos,
  segundosDeEspera,
  segundosDeEsperaReserva,
  statusDoErro,
} from '../lib/encadear.mjs';
import { semToken } from '../lib/gravar.mjs';

const WORKFLOW = 'checagem.yml';
const DETALHE_MAX = 200;
// D25: cada chamada ao gh tem no máximo 30 s; morto por tempo, o disparo vale como sem status.
const GH_TEMPO_MAXIMO_MS = 30_000;

function falhar(mensagem) {
  console.error(`Erro: ${mensagem}`);
  process.exit(1);
}

let reserva;
try {
  ({ values: { reserva } } = parseArgs({ options: { reserva: { type: 'boolean', default: false } } }));
} catch {
  falhar('uso: node scripts/encadear.mjs [--reserva]. Nada foi disparado.');
}

const id = process.env.GITHUB_RUN_ID ?? '';
const repo = process.env.GITHUB_REPOSITORY ?? '';
if (!/^[1-9]\d{0,19}$/.test(id)) falhar('GITHUB_RUN_ID precisa ser o número do run. Nada foi disparado.');
if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repo) || repo.split('/')[1].startsWith('.')) {
  falhar('GITHUB_REPOSITORY precisa ser «dono/repo». Nada foi disparado.');
}

// Chama o gh e devolve o erro em vez de sair: { ok: true, saida } | { ok: false, stderr, morto, detalhe }.
// `detalhe`: a primeira linha do stderr; o token sai antes do corte, para não sobrar um pedaço dele na borda dos
// 200 caracteres. `morto`: o gh passou dos 30 s e foi encerrado.
function tentarGh(args) {
  try {
    const opcoes = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TEMPO_MAXIMO_MS };
    return { ok: true, saida: execFileSync('gh', args, opcoes) };
  } catch (erro) {
    const stderr = String(erro.stderr ?? '');
    const morto = Boolean(erro.signal);
    const linha = stderr.trim().split('\n')[0];
    const detalhe = morto ? 'o gh passou do tempo' : semToken(linha, process.env.GH_TOKEN ?? '').slice(0, DETALHE_MAX);
    return { ok: false, stderr, morto, detalhe };
  }
}

// D25: o fim da mensagem de erro. Depois de um disparo que falhou com 5xx ou sem status, o run pode ter sido criado.
const NADA = 'Nada foi disparado.';
const PODE_TER_SAIDO = 'O disparo pode não ter saído.';

function falhaDoGh(etapa, detalhe, fim = NADA) {
  return falhar(`o gh falhou ao ${etapa}${detalhe ? `: ${detalhe}` : '.'} ${fim}`);
}

function gh(args, etapa, fim = NADA) {
  const r = tentarGh(args);
  return r.ok ? r.saida : falhaDoGh(etapa, r.detalhe, fim);
}

// A resposta do gh em JSON; inválida, falha com mensagem fixa (nada da resposta vai ao log).
function json(texto, etapa, fim = NADA) {
  try {
    return JSON.parse(texto);
  } catch {
    return falhar(`a resposta do gh ao ${etapa} não é JSON. ${fim}`);
  }
}

// Os outros runs ativos da checagem, ou null (lista inválida). O gh que falha ao listar encerra com erro, com `fim`
// no fim da mensagem.
function listarAtivos(fim = NADA) {
  const etapa = 'listar os runs';
  const resposta = gh(['api', `repos/${repo}/actions/workflows/${WORKFLOW}/runs?per_page=50`], etapa, fim);
  return outrosRunsAtivos(json(resposta, etapa, fim)?.workflow_runs, id);
}

function disparar() {
  const r = tentarGh(['workflow', 'run', WORKFLOW, '--ref', 'main', '--repo', repo]);
  if (r.ok) return { ok: true };
  return { ok: false, status: r.morto ? null : statusDoErro(r.stderr), detalhe: r.detalhe };
}

if (reserva) console.log('Reserva.');
const run = json(gh(['api', `repos/${repo}/actions/runs/${id}`], 'ler o início do run'), 'ler o início do run');
const espera = (reserva ? segundosDeEsperaReserva : segundosDeEspera)(Date.now(), run?.run_started_at);
console.log(`Espera: ${espera} s.`);
await esperarMs(espera * 1000);

// D25: a lista inválida falha (a corrente não morre calada: o `encadear` falho aciona a `reserva`).
const ativos = listarAtivos();
if (ativos === null) {
  falhar(`a lista de runs é inválida. ${NADA}`);
} else if (ativos.length > 0) {
  console.log('Não disparou: há run ativo.');
} else {
  const saida = await dispararComNovaTentativa({
    disparar,
    // Dentro do laço, a lista vem sempre depois de um disparo que falhou com 5xx ou sem status.
    listarAtivos: () => listarAtivos(PODE_TER_SAIDO),
    esperar: (ms, status) => {
      const como = status === null ? 'sem status' : `HTTP ${status}`;
      console.log(`O disparo falhou (${como}); nova tentativa em ${ms / 1000} s.`);
      return esperarMs(ms);
    },
  });
  if (saida.resultado === 'falhou') {
    const fim = saida.podeTerSaido ? PODE_TER_SAIDO : NADA;
    if (saida.detalhe === LISTA_INVALIDA) falhar(`a lista de runs é inválida. ${fim}`);
    falhaDoGh('disparar a checagem', saida.detalhe, fim);
  }
  console.log(saida.resultado === 'disparou' ? 'Disparou.' : `Não disparou: ${saida.detalhe}.`);
}
