// D20: o job `encadear` da checagem. Espera o próximo horário e dispara a própria checagem.yml por
// workflow_dispatch, se não houver outro run dela ativo (uma corrente só).
//   GITHUB_RUN_ID, GITHUB_REPOSITORY e GH_TOKEN vêm do ambiente do Actions; o `gh` roda sem shell.
// O log é público: a espera em segundos e se disparou; no erro, uma mensagem fixa e, quando o `gh` falha, só a
// primeira linha do stderr dele, cortada em 200 caracteres e sem o token.
import { execFileSync } from 'node:child_process';
import { setTimeout as esperarMs } from 'node:timers/promises';
import { outrosRunsAtivos, segundosDeEspera } from '../lib/encadear.mjs';
import { semToken } from '../lib/gravar.mjs';

const WORKFLOW = 'checagem.yml';
const DETALHE_MAX = 200;

function falhar(mensagem) {
  console.error(`Erro: ${mensagem}`);
  process.exit(1);
}

const id = process.env.GITHUB_RUN_ID ?? '';
const repo = process.env.GITHUB_REPOSITORY ?? '';
if (!/^[1-9]\d{0,19}$/.test(id)) falhar('GITHUB_RUN_ID precisa ser o número do run. Nada foi disparado.');
if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repo) || repo.split('/')[1].startsWith('.')) {
  falhar('GITHUB_REPOSITORY precisa ser «dono/repo». Nada foi disparado.');
}

function gh(args, etapa) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (erro) {
    // O token sai antes do corte, para não sobrar um pedaço dele na borda dos 200 caracteres.
    const linha = String(erro.stderr ?? '').trim().split('\n')[0];
    const detalhe = semToken(linha, process.env.GH_TOKEN ?? '').slice(0, DETALHE_MAX);
    return falhar(`o gh falhou ao ${etapa}${detalhe ? `: ${detalhe}` : '.'} Nada foi disparado.`);
  }
}

// A resposta do gh em JSON; inválida, falha com mensagem fixa (nada da resposta vai ao log).
function json(texto, etapa) {
  try {
    return JSON.parse(texto);
  } catch {
    return falhar(`a resposta do gh ao ${etapa} não é JSON. Nada foi disparado.`);
  }
}

const run = json(gh(['api', `repos/${repo}/actions/runs/${id}`], 'ler o início do run'), 'ler o início do run');
const espera = segundosDeEspera(Date.now(), run?.run_started_at);
console.log(`Espera: ${espera} s.`);
await esperarMs(espera * 1000);

const etapa = 'listar os runs';
const lista = json(gh(['api', `repos/${repo}/actions/workflows/${WORKFLOW}/runs?per_page=50`], etapa), etapa);
const ativos = outrosRunsAtivos(lista?.workflow_runs, id);
if (ativos === null) {
  console.log('Não disparou: lista de runs inválida.');
} else if (ativos.length > 0) {
  console.log('Não disparou: há run ativo.');
} else {
  gh(['workflow', 'run', WORKFLOW, '--ref', 'main', '--repo', repo], 'disparar a checagem');
  console.log('Disparou.');
}
