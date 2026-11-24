// D13: grava no ramo `dados` sem perder nada.
//
// Como CLI (a checagem), depois de scripts/checar.mjs ter medido uma vez:
//   node scripts/gravar-dados.mjs --medida <arquivo> --arvore <pasta> --remoto <url>
//        [--config config/alvos.json] [--espera-min 1000] [--espera-max 4000]
// Em cada tentativa lê os JSON do `dados` recém-buscado, aplica a medida, faz o commit e o push. O `publicar` da
// tentativa que gravou vai para $GITHUB_OUTPUT, quando existir, junto com o `encadear` (D20: o teto diário).
//
// Como módulo, `gravarNoRamo` é o laço que a checagem e o incidente (scripts/incidente.mjs) usam.
// O token entra só pelo ambiente (GH_TOKEN) e só no push; nenhum outro filho git o recebe.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as esperarMs } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { aplicarMedida } from '../lib/checagem.mjs';
import { anotarEncadeado } from '../lib/encadear.mjs';
import {
  AUTOR,
  ESPERA_MAX_MS,
  ESPERA_MIN_MS,
  RAMO,
  TENTATIVAS,
  ambienteDoGit,
  classificarPush,
  dataDoGit,
  esperaComVariacao,
  mensagemDoCommit,
  precisaRecriar,
  semToken,
} from '../lib/gravar.mjs';
import { TEXTOS } from '../site/textos.mjs';

// A ref local que fica sem commit quando o próximo commit não tem pai (ramo novo ou recriado).
const TRABALHO = 'refs/heads/trabalho';

// Roda um git. -> { codigo, saida, erro }
export function executarGit(args, { cwd, env }) {
  return new Promise((resolver, rejeitar) => {
    const filho = spawn('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let saida = '';
    let erro = '';
    filho.stdout.setEncoding('utf8').on('data', (d) => (saida += d));
    filho.stderr.setEncoding('utf8').on('data', (d) => (erro += d));
    filho.on('error', rejeitar);
    filho.on('close', (codigo) => resolver({ codigo, saida, erro }));
  });
}

export class FalhaDaGravacao extends Error {}

// `operacao(ler)`: `ler(nome)` devolve o JSON daquele arquivo na árvore recém-buscada (ou undefined, se não há).
//   -> { arquivos: { <nome>: valor }, mensagem, saida }. Erro lançado ali (por exemplo, de entrada) sobe sem push e
//   sem nova tentativa.
// `agora` (ISO): a hora da operação, fixada antes do laço; é a data do commit e decide a recriação diária.
// `antesDoPush({ tentativa })`: gancho dos testes, roda entre o commit e o push.
// -> { tentativas, criou, recriou, saida } da tentativa que gravou.
export async function gravarNoRamo({
  arvore,
  remoto,
  agora,
  operacao,
  git = executarGit,
  ambiente = process.env,
  esperar = (ms) => esperarMs(ms),
  aleatorio = Math.random,
  esperaMinMs = ESPERA_MIN_MS,
  esperaMaxMs = ESPERA_MAX_MS,
  tentativas = TENTATIVAS,
  antesDoPush = null,
  avisar = (texto) => console.log(texto),
}) {
  const token = ambiente.GH_TOKEN ?? '';
  const data = dataDoGit(agora);
  const envComum = {
    ...ambienteDoGit(ambiente),
    GIT_AUTHOR_NAME: AUTOR.nome,
    GIT_AUTHOR_EMAIL: AUTOR.email,
    GIT_COMMITTER_NAME: AUTOR.nome,
    GIT_COMMITTER_EMAIL: AUTOR.email,
    GIT_AUTHOR_DATE: data,
    GIT_COMMITTER_DATE: data,
  };

  async function rodar(args, { aceitos = [0], env = envComum } = {}) {
    const r = await git(args, { cwd: arvore, env });
    if (!aceitos.includes(r.codigo)) {
      const comando = args[0] === '-c' ? args[2] : args[0];
      const detalhe = semToken(`${r.erro}${r.saida}`.trim(), token);
      throw new FalhaDaGravacao(`git ${comando} falhou (código ${r.codigo})${detalhe ? `: ${detalhe}` : '.'}`);
    }
    return r;
  }

  // Sem pai: HEAD aponta para uma ref que não existe; o próximo commit não tem pai. O índice fica como está.
  async function soltarHead() {
    await rodar(['symbolic-ref', 'HEAD', TRABALHO]);
    const existe = await rodar(['show-ref', '--verify', '--quiet', TRABALHO], { aceitos: [0, 1] });
    if (existe.codigo === 0) await rodar(['update-ref', '-d', TRABALHO]);
  }

  mkdirSync(arvore, { recursive: true });
  if (!existsSync(join(arvore, '.git'))) await rodar(['-c', 'init.defaultBranch=trabalho', 'init', '-q']);
  const temOrigin = (await rodar(['remote'])).saida.split('\n').includes('origin');
  await rodar(['remote', temOrigin ? 'set-url' : 'add', 'origin', remoto]);

  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    // 1. Busca o `dados` (ou vê que ele não existe). O repositório é público: sem token.
    const lista = await rodar(['ls-remote', '--exit-code', 'origin', RAMO], { aceitos: [0, 2] });
    let sha = null;
    if (lista.codigo === 0) {
      await rodar(['fetch', '-q', '--no-tags', 'origin', `+${RAMO}:refs/remotes/origin/dados`]);
      sha = (await rodar(['rev-parse', '--verify', 'refs/remotes/origin/dados^{commit}'])).saida.trim();
    }

    // 2. A árvore igual ao `origin/dados` (ou vazia, sem commit, se ele não existe).
    if (sha) {
      await rodar(['checkout', '-q', '--force', '--detach', sha]);
    } else {
      await soltarHead();
      await rodar(['read-tree', '--empty']);
    }
    await rodar(['clean', '-q', '-f', '-d', '-x']);

    // Uma vez por dia (o commit mais velho é de outro dia de Assunção), o ramo vira um commit só.
    let recriou = false;
    if (sha) {
      const raizes = (await rodar(['log', '--max-parents=0', '--format=%cI', sha])).saida.split('\n').filter(Boolean);
      recriou = precisaRecriar(raizes, agora);
    }

    // 3. Aplica a operação nos JSON lidos agora.
    const ler = (nome) => {
      const caminho = join(arvore, nome);
      return existsSync(caminho) ? JSON.parse(readFileSync(caminho, 'utf8')) : undefined;
    };
    const { arquivos, mensagem, saida } = operacao(ler);
    for (const [nome, valor] of Object.entries(arquivos)) {
      writeFileSync(join(arvore, nome), `${JSON.stringify(valor, null, 2)}\n`);
    }

    // 4. Commit pelo github-actions[bot].
    await rodar(['add', '-A']);
    if (sha && recriou) await soltarHead();
    const texto = mensagemDoCommit(mensagem, { criou: !sha, recriou });
    await rodar(['-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '--no-verify', '-m', texto]);

    if (antesDoPush) await antesDoPush({ tentativa });

    // 5. Push. Forçado só na recriação, e só se o `dados` ainda é o que foi buscado nesta tentativa.
    const lease = recriou ? [`--force-with-lease=${RAMO}:${sha}`] : [];
    const envDoPush = { ...envComum, ...ambienteDoGit(ambiente, token) };
    const push = await git(['push', '--porcelain', ...lease, 'origin', `HEAD:${RAMO}`], { cwd: arvore, env: envDoPush });
    if (push.codigo === 0) return { tentativas: tentativa, criou: !sha, recriou, saida };

    const relato = semToken(`${push.saida}\n${push.erro}`.trim(), token);
    if (classificarPush(`${push.saida}\n${push.erro}`) !== 'recusado') {
      throw new FalhaDaGravacao(`git push falhou (código ${push.codigo}) sem ser recusa por gravação no meio: ${relato}`);
    }
    if (tentativa < tentativas) {
      avisar(`Push recusado: outra gravação chegou antes ao ramo dados. Nova tentativa (${tentativa + 1} de ${tentativas}).`);
      await esperar(esperaComVariacao(aleatorio, esperaMinMs, esperaMaxMs));
    }
  }
  throw new FalhaDaGravacao(
    `O push foi recusado nas ${tentativas} tentativas (outra gravação chegou antes ao ramo dados a cada vez). ` +
      'Nada desta execução foi gravado; rode de novo.',
  );
}

// As opções comuns das CLIs que gravam.
export const OPCOES_DA_GRAVACAO = {
  arvore: { type: 'string' },
  remoto: { type: 'string' },
  'espera-min': { type: 'string' },
  'espera-max': { type: 'string' },
};

export function esperaDasOpcoes(values) {
  const ler = (nome, padrao) => {
    if (values[nome] === undefined) return padrao;
    const n = Number(values[nome]);
    if (!Number.isInteger(n) || n < 0) throw new FalhaDaGravacao(`--${nome} precisa ser um inteiro de ms (>= 0).`);
    return n;
  };
  return { esperaMinMs: ler('espera-min', ESPERA_MIN_MS), esperaMaxMs: ler('espera-max', ESPERA_MAX_MS) };
}

// A operação da checagem: aplica a medida aos JSON lidos na tentativa. O `publicar` sai desta tentativa, e o
// `encadear` também: o teto diário de D20 conta no `estado.encadeados` lido agora (o `aviso` vai junto, e nenhum
// dos dois vai à página).
export function operacaoDaChecagem({ config, medida, textos = TEXTOS }) {
  return (ler) => {
    const s = aplicarMedida({
      config,
      estado: ler('estado.json') ?? {},
      dias: ler('dias.json') ?? {},
      incidentes: (ler('incidentes.json') ?? { incidentes: [] }).incidentes,
      medida,
      textos,
    });
    const encadear = anotarEncadeado(s.estado, medida.instante);
    return {
      arquivos: { 'estado.json': s.estado, 'dias.json': s.dias, 'incidentes.json': { incidentes: s.incidentes } },
      mensagem: `Checagem (${medida.instante})`,
      saida: { ...s, encadear },
    };
  };
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

async function principal() {
  const { values } = parseArgs({
    options: { ...OPCOES_DA_GRAVACAO, medida: { type: 'string' }, config: { type: 'string', default: 'config/alvos.json' } },
  });
  if (!values.medida || !values.arvore || !values.remoto) {
    console.error('Uso: node scripts/gravar-dados.mjs --medida <arquivo> --arvore <pasta> --remoto <url> [--config config/alvos.json]');
    process.exit(2);
  }
  const config = JSON.parse(readFileSync(values.config, 'utf8'));
  const medida = JSON.parse(readFileSync(values.medida, 'utf8'));
  if (typeof medida?.instante !== 'string' || !ISO.test(medida.instante) || typeof medida.resultados !== 'object') {
    console.error('Erro: a medida não está no formato de scripts/checar.mjs. Nada foi gravado.');
    process.exit(1);
  }

  let gravado;
  try {
    gravado = await gravarNoRamo({
      arvore: values.arvore,
      remoto: values.remoto,
      agora: medida.instante,
      ...esperaDasOpcoes(values),
      operacao: operacaoDaChecagem({ config, medida }),
    });
  } catch (erro) {
    if (!(erro instanceof FalhaDaGravacao)) throw erro;
    console.error(`Erro: ${erro.message}`);
    process.exit(1);
  }

  // O log do Actions é público: só o id da linha e o estado (e, na linha por fato, se a leitura não contou).
  const s = gravado.saida;
  for (const [linha, resultado] of Object.entries(s.resultados)) {
    const repetida = s.repetidas.includes(linha) ? ' (não contou: fato repetido, mais velho ou sem dado)' : '';
    console.log(`${linha}: ${resultado}${repetida}`);
  }
  const como = gravado.criou ? ', ramo criado' : gravado.recriou ? ', ramo recriado' : '';
  console.log(`Gravado no ramo dados na tentativa ${gravado.tentativas}${como}.`);
  const encadear = s.encadear ? 'sim' : 'nao';
  console.log(`publicar=${s.publicar}`);
  console.log(`encadear=${encadear}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `publicar=${s.publicar}\nencadear=${encadear}\n`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await principal();
