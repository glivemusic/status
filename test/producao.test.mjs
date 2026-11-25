// D17: o modo página e as linhas em breve ficam no código (podem voltar): testados com um config derivado do real.
// D24: o config real, com a produção na rota de saúde.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { ESPERA_NOVA_TENTATIVA_MS, chamarPagina, checarAlvo, classificarPagina, modoDoAlvo } from '../lib/classificar.mjs';
import { executarChecagem } from '../lib/checagem.mjs';
import { estadoGeral, estadosDoGeral } from '../lib/geral.mjs';
import { visaoDoEstado, visaoDosDias } from '../lib/visao.mjs';
import { TEXTOS } from '../site/textos.mjs';

const real = JSON.parse(readFileSync(new URL('../config/alvos.json', import.meta.url), 'utf8'));
// O config da D17, derivado do real: o app no modo página na raiz do site; login, banco e satélite em breve.
const config = {
  linhas: real.linhas.map(({ fora_do_geral: _foraDoGeral, ...l }) =>
    l.url ? { ...l, url: 'https://basefertil.com/', modo: 'pagina' } : { ...l, em_breve: true },
  ),
};
const app = config.linhas.find((l) => l.id === 'app');
const dependentes = config.linhas.filter((l) => l.alvo === 'app');

test('D24: o config real: a rota de saúde da produção, nenhuma linha em breve, só o satélite fora do geral, nada do develop', () => {
  const doApp = real.linhas.find((l) => l.id === 'app');
  assert.equal(doApp.url, 'https://basefertil.com/api/health');
  assert.equal(doApp.modo, undefined);
  assert.equal(modoDoAlvo(doApp), 'saude');
  assert.equal(doApp.componente, 'servidor');
  assert.deepEqual(real.linhas.map((l) => l.id), ['app', 'login', 'banco', 'satelite']);
  assert.ok(real.linhas.every((l) => !('em_breve' in l)), 'nenhuma linha em breve');
  assert.deepEqual(
    real.linhas.filter((l) => 'fora_do_geral' in l).map((l) => [l.id, l.fora_do_geral]),
    [['satelite', true]],
  );
  for (const id of ['login', 'banco', 'satelite']) {
    const l = real.linhas.find((x) => x.id === id);
    assert.equal(l.alvo, 'app', id);
    assert.equal(l.componente, id, id);
  }
  assert.equal(real.linhas.find((l) => l.id === 'satelite').intervalo_s, 7200);
  assert.ok(!JSON.stringify(real).includes('develop'));
  assert.equal(real.linhas.filter((l) => l.url).length, 1, 'um alvo só');
});

test('modo: sem modo é saúde; página e saúde valem; outro é erro de config', () => {
  assert.equal(modoDoAlvo({ id: 'x' }), 'saude');
  assert.equal(modoDoAlvo({ id: 'x', modo: 'saude' }), 'saude');
  assert.equal(modoDoAlvo(app), 'pagina');
  assert.throws(() => modoDoAlvo({ id: 'x', modo: 'Pagina' }), /Modo desconhecido no alvo x/);
});

// Um fetch falso: as respostas em ordem; o relógio avança `duracoes[i]` ms em cada chamada.
function falso(respostas, duracoes = []) {
  let agora = 0;
  let i = 0;
  const chamadas = [];
  const esperas = [];
  const cancelados = [];
  return {
    chamadas,
    esperas,
    cancelados,
    relogio: () => agora,
    esperar: async (ms) => {
      esperas.push(ms);
    },
    fetch: async (url, opcoes) => {
      chamadas.push({ url, opcoes });
      const r = respostas[i];
      agora += duracoes[i] ?? 100;
      i += 1;
      if (r instanceof Error) throw r;
      const n = i;
      return {
        status: r,
        body: { cancel: async () => cancelados.push(n) },
        text: async () => assert.fail('o corpo não é lido'),
        json: async () => assert.fail('o corpo não é lido'),
      };
    },
  };
}

const doApp = async (respostas, duracoes) => {
  const f = falso(respostas, duracoes);
  const { resultados, fatos } = await checarAlvo(app, dependentes, f);
  return { ...f, resultados, fatos };
};

test('303 em 0,1 s é ok; 200 e 204 também; o corpo não é lido, só fechado', async () => {
  for (const status of [303, 200, 204, 301, 399]) {
    const r = await doApp([status], [100]);
    assert.equal(r.resultados.app, 'ok', String(status));
    assert.equal(r.chamadas.length, 1);
    assert.deepEqual(r.cancelados, [1]);
  }
});

test('200 em 6 s é degradado; 5 s exatos é ok; 10 s exatos ainda é degradado', async () => {
  assert.equal((await doApp([200], [6000])).resultados.app, 'degradado');
  assert.equal((await doApp([303], [6000])).resultados.app, 'degradado');
  assert.equal((await doApp([200], [5000])).resultados.app, 'ok');
  assert.equal((await doApp([200], [10_000])).resultados.app, 'degradado');
  // Degradado não pede nova tentativa.
  assert.equal((await doApp([200], [6000])).chamadas.length, 1);
});

test('404, 500, erro de rede e tempo estourado são fora, com a nova tentativa depois de 20 s', async () => {
  const tempo = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  for (const ruim of [404, 500, 503, 199, 400, new TypeError('fetch failed'), tempo]) {
    const r = await doApp([ruim, ruim]);
    assert.equal(r.resultados.app, 'fora', String(ruim));
    assert.equal(r.chamadas.length, 2);
    assert.deepEqual(r.esperas, [ESPERA_NOVA_TENTATIVA_MS]);
  }
  // Resposta que chegou depois dos 10 s conta como tempo estourado.
  assert.equal((await doApp([200, 200], [10_001, 10_001])).resultados.app, 'fora');
  // A nova tentativa que salva.
  const salva = await doApp([new TypeError('fetch failed'), 303]);
  assert.equal(salva.resultados.app, 'ok');
  assert.equal(salva.chamadas.length, 2);
});

test('o fetch vai com redirect manual, só o User-Agent, sem cookie nem credencial, e tempo máximo de 10 s', async () => {
  const r = await doApp([303]);
  const [{ url, opcoes }] = r.chamadas;
  assert.equal(url, 'https://basefertil.com/');
  assert.equal(opcoes.method, 'GET');
  assert.equal(opcoes.redirect, 'manual');
  assert.equal(opcoes.credentials, 'omit');
  assert.deepEqual(opcoes.headers, { 'User-Agent': 'status-agronomy-center' });
  assert.ok(!Object.keys(opcoes.headers).some((k) => /cookie|authorization/i.test(k)));
  assert.ok(opcoes.signal instanceof AbortSignal);
  assert.ok(!('body' in opcoes));
});

test('as linhas que dependeriam do corpo ficam sem dado no modo página (o satélite, sem fato)', () => {
  const linhas = [
    { id: 'login', alvo: 'app', componente: 'login' },
    { id: 'satelite', alvo: 'app', componente: 'satelite', intervalo_s: 7200 },
  ];
  assert.deepEqual(classificarPagina({ status: 303, duracaoMs: 100 }, app, linhas), {
    resultados: { app: 'ok', login: 'sem_dado', satelite: 'sem_dado' },
    fatos: { satelite: null },
  });
  // D25: fora leva o motivo, só texto fixo.
  assert.deepEqual(classificarPagina(null, app, []), { resultados: { app: 'fora' }, fatos: {}, motivo: 'sem resposta' });
  assert.equal(classificarPagina({ status: 200, duracaoMs: 10_001 }, app, []).motivo, 'sem resposta');
  assert.equal(classificarPagina({ status: 404, duracaoMs: 100 }, app, []).motivo, 'status inesperado');
  assert.equal(classificarPagina({ status: 500, duracaoMs: 100 }, app, []).motivo, 'status inesperado');
  assert.ok(!('motivo' in classificarPagina({ status: 200, duracaoMs: 6000 }, app, [])), 'degradado não é falha');
});

test('com o fetch de verdade, num servidor local: 303 sem seguir, sem cookie, corpo descartado', async () => {
  const pedidos = [];
  const servidor = createServer((req, res) => {
    pedidos.push({ url: req.url, headers: req.headers });
    if (req.url === '/login') {
      res.writeHead(200).end('login');
      return;
    }
    res.writeHead(303, { Location: '/login', 'Set-Cookie': 'sessao=abc; Path=/' });
    res.end('x'.repeat(256 * 1024));
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${servidor.address().port}/`;
    const primeira = await chamarPagina(url, { fetch: globalThis.fetch, relogio: Date.now });
    const segunda = await chamarPagina(url, { fetch: globalThis.fetch, relogio: Date.now });
    assert.equal(primeira.status, 303);
    assert.deepEqual(Object.keys(primeira).sort(), ['duracaoMs', 'status'], 'nada do corpo é guardado');
    assert.equal(segunda.status, 303);
    assert.deepEqual(pedidos.map((p) => p.url), ['/', '/'], 'não segue para o login');
    for (const p of pedidos) {
      assert.equal(p.headers.cookie, undefined, 'sem cookie, nem o que a primeira resposta mandou gravar');
      assert.equal(p.headers.authorization, undefined);
      assert.equal(p.headers['user-agent'], 'status-agronomy-center');
    }
    assert.equal(classificarPagina(primeira, app, []).resultados.app, 'ok');
  } finally {
    servidor.closeAllConnections();
    await new Promise((r) => servidor.close(r));
  }
});

// A checagem inteira com o config da D17: o app no modo página, as em breve de fora.
async function rodar(statuses, dados = {}) {
  let { estado = {}, dias = {}, incidentes = [] } = dados;
  const chamadas = [];
  const saidas = [];
  for (let n = 0; n < statuses.length; n += 1) {
    const agora = Date.parse('2026-11-23T21:02:00Z') + n * 5 * 60_000;
    const s = await executarChecagem({
      config,
      estado,
      dias,
      incidentes,
      fetch: async (url) => {
        chamadas.push(url);
        if (statuses[n] === 'rede') throw new TypeError('fetch failed');
        return { status: statuses[n], body: null };
      },
      relogio: () => agora,
      esperar: async () => {},
      textos: TEXTOS,
    });
    ({ estado, dias, incidentes } = s);
    saidas.push(s);
  }
  return { estado, dias, incidentes, chamadas, saidas };
}

test('as linhas em breve não são checadas e não gravam estado, dia nem incidente', async () => {
  const { estado, dias, incidentes, chamadas, saidas } = await rodar([303, 500, 'rede', 404]);
  assert.ok(chamadas.every((u) => u === 'https://basefertil.com/'), 'só a página do app');
  assert.deepEqual(Object.keys(estado.linhas), ['app']);
  assert.deepEqual(Object.keys(dias), ['app']);
  assert.ok(incidentes.length > 0, 'o app abriu o seu incidente');
  assert.ok(incidentes.every((i) => i.linhas.length === 1 && i.linhas[0] === 'app'));
  assert.equal(incidentes[0].tipo, 'fora');
  for (const s of saidas) assert.deepEqual(Object.keys(s.resultados), ['app']);
  // O dia conta as checagens do app: 1 ok e 3 fora.
  assert.deepEqual(dias.app['2026-11-23'], { feitas: 4, ok: 1, degradado: 0, fora: 3, minutos_fora: dias.app['2026-11-23'].minutos_fora });
});

test('dados antigos das linhas em breve ficam como estavam: a checagem não os muda', async () => {
  const antigo = {
    estado: 'fora', fora_seguidas: 5, degradadas_seguidas: 0, boas_seguidas: 0, serie_inicio: '2026-11-20T10:00:00Z', incidente: null,
  };
  const { estado } = await rodar([303], { estado: { linhas: { login: antigo } } });
  assert.deepEqual(estado.linhas.login, antigo);
});

test('o geral: as linhas em breve não entram', () => {
  const agora = '2026-11-23T21:00:00Z';
  const linhas = (app) => [
    { id: 'app', estado: app },
    { id: 'login', em_breve: true },
    { id: 'banco', em_breve: true, estado: 'fora' }, // dado velho que escapasse não muda o geral
    { id: 'satelite', em_breve: true },
  ];
  assert.deepEqual(estadosDoGeral(linhas('ok')), ['ok']);
  assert.equal(estadoGeral(estadosDoGeral(linhas('ok')), agora, agora), 'ok');
  assert.equal(estadoGeral(estadosDoGeral(linhas('degradado')), agora, agora), 'degradado');
  assert.equal(estadoGeral(estadosDoGeral(linhas('fora')), agora, agora), 'fora');
  // Sem a marca (os dados de exemplo), todas entram, como antes.
  assert.deepEqual(estadosDoGeral([{ estado: 'ok' }, { estado: 'degradado' }]), ['ok', 'degradado']);
});

// D24: uma checagem com o config real (a rota de saúde) e o corpo do contrato. O que a página mostraria: o estado
// de cada linha e o geral, pela visão (`visaoDoEstado` + `estadosDoGeral` + `estadoGeral`).
const AGORA_D24 = Date.parse('2026-11-25T15:02:00Z');
function contrato({ estado = 'ok', banco = 'ok' } = {}) {
  return {
    sistema: 'agronomy-center',
    estado,
    verificado_em: '2026-11-25T15:01:59Z',
    componentes: { servidor: 'ok', login: 'ok', banco, satelite: 'ok' },
    satelite: { verificado_em: '2026-11-25T14:00:00Z', idade_s: 3719 },
  };
}
async function checarNaRota(status, corpo) {
  const chamadas = [];
  const s = await executarChecagem({
    config: real,
    estado: {},
    dias: {},
    incidentes: [],
    fetch: async (url, opcoes) => {
      chamadas.push({ url, opcoes });
      return new Response(JSON.stringify(corpo), { status });
    },
    relogio: () => AGORA_D24,
    esperar: async () => {},
    textos: TEXTOS,
  });
  const visao = visaoDoEstado(real, s.estado);
  return {
    ...s,
    chamadas,
    linhas: Object.fromEntries(visao.linhas.map((l) => [l.id, l.estado])),
    geral: estadoGeral(estadosDoGeral(visao.linhas), visao.verificado_em, new Date(AGORA_D24).toISOString()),
  };
}

test('D24: o corpo do contrato com tudo ok, pela rota de saúde: as quatro linhas ok e o geral ok', async () => {
  const r = await checarNaRota(200, contrato());
  assert.deepEqual(r.chamadas.map((c) => c.url), ['https://basefertil.com/api/health']);
  // D25: o modo saúde também não segue redirecionamento nem leva credencial.
  assert.equal(r.chamadas[0].opcoes.redirect, 'manual');
  assert.equal(r.chamadas[0].opcoes.credentials, 'omit');
  assert.deepEqual(r.linhas, { app: 'ok', login: 'ok', banco: 'ok', satelite: 'ok' });
  assert.equal(r.geral, 'ok');
  assert.equal(r.estado.linhas.satelite.verificado_em, '2026-11-25T14:00:00.000Z', 'o fato do satélite contou');
  assert.deepEqual(Object.keys(r.dias).sort(), ['app', 'banco', 'login', 'satelite']);
  assert.deepEqual(r.incidentes, []);
});

test('D24: os campos do corpo que não podem sair não chegam ao estado.json do ramo nem à visão publicada', async () => {
  const corpo = {
    ...contrato(),
    sistema: 'sistema-SECRETO',
    versao: 'v9.8.7-SECRETO',
    mensagem: 'MENSAGEM-SECRETA de erro interno',
    componentes: { servidor: 'ok', login: 'ok', banco: 'ok', satelite: 'ok', fila_SECRETA: 'ok' },
    tempos_ms: { servidor: 4321, login: 5432, banco: 6543 },
    detalhes: { banco: { mensagem: 'MENSAGEM-SECRETA', tempo_ms: 7654 } },
    satelite: { verificado_em: '2026-11-25T14:00:00Z', idade_s: 3719, provedor: 'PROVEDOR-SECRETO' },
  };
  const s = await executarChecagem({
    config: real,
    estado: {},
    dias: {},
    incidentes: [],
    fetch: async () => new Response(JSON.stringify(corpo), { status: 200 }),
    relogio: () => AGORA_D24,
    esperar: async () => {},
    textos: TEXTOS,
  });
  const visao = visaoDoEstado(real, s.estado);
  const textos = {
    'estado.json do ramo': JSON.stringify(s.estado),
    'dias.json do ramo': JSON.stringify(s.dias),
    'visão do estado': JSON.stringify(visao),
    'visão dos dias': JSON.stringify(visaoDosDias(real, s.dias, false)),
  };
  for (const [onde, texto] of Object.entries(textos)) {
    for (const proibido of ['SECRET', 'versao', 'mensagem', 'tempo', 'fila', 'sistema', 'idade_s', '3719', '4321', '5432', '6543', '7654', 'provedor', '15:01:59']) {
      assert.ok(!texto.includes(proibido), `${onde} contém «${proibido}»`);
    }
  }
  // Só os estados das linhas e, do satélite, o `verificado_em` do fato.
  assert.deepEqual(Object.keys(s.estado.linhas), ['app', 'login', 'banco', 'satelite']);
  assert.equal(s.estado.linhas.satelite.verificado_em, '2026-11-25T14:00:00.000Z');
  assert.deepEqual(visao.linhas.map((l) => Object.keys(l)), [
    ['id', 'nome', 'estado'],
    ['id', 'nome', 'estado'],
    ['id', 'nome', 'estado'],
    ['id', 'nome', 'estado', 'intervalo_s', 'verificado_em', 'fora_do_geral'],
  ]);
  assert.deepEqual(visao.linhas.map((l) => l.estado), ['ok', 'ok', 'ok', 'ok']);
  assert.equal(visao.linhas[3].verificado_em, '2026-11-25T14:00:00.000Z');
});

test('D24: banco fora com 503 e o corpo do contrato: a linha banco fora e o geral fora; o app e o satélite seguem ok', async () => {
  const r = await checarNaRota(503, contrato({ estado: 'fora', banco: 'fora' }));
  assert.equal(r.chamadas.length, 2, 'a nova tentativa de D3');
  assert.deepEqual(r.linhas, { app: 'ok', login: 'ok', banco: 'fora', satelite: 'ok' });
  assert.equal(r.geral, 'fora');
  assert.equal(r.estado.linhas.banco.fora_seguidas, 1);
});
