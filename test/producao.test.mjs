// D17: no ar com dado real da produção, só no aplicativo. O modo página, as linhas em breve e o config.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { ESPERA_NOVA_TENTATIVA_MS, chamarPagina, checarAlvo, classificarPagina, modoDoAlvo } from '../lib/classificar.mjs';
import { executarChecagem } from '../lib/checagem.mjs';
import { estadoGeral, estadosDoGeral } from '../lib/geral.mjs';
import { TEXTOS } from '../site/textos.mjs';

const config = JSON.parse(readFileSync(new URL('../config/alvos.json', import.meta.url), 'utf8'));
const app = config.linhas.find((l) => l.id === 'app');
const dependentes = config.linhas.filter((l) => l.alvo === 'app');

test('o config: o app checa a produção no modo página; login, banco e satélite em breve; nada do develop', () => {
  assert.equal(app.url, 'https://basefertil.com/');
  assert.equal(app.modo, 'pagina');
  for (const id of ['login', 'banco', 'satelite']) {
    const l = config.linhas.find((x) => x.id === id);
    assert.equal(l.em_breve, true, id);
    // Guardam o que precisam para voltar.
    assert.equal(l.alvo, 'app', id);
    assert.equal(l.componente, id, id);
  }
  assert.equal(config.linhas.find((l) => l.id === 'satelite').intervalo_s, 7200);
  assert.ok(!JSON.stringify(config).includes('develop'));
  assert.equal(config.linhas.filter((l) => l.url).length, 1, 'um alvo só');
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
  assert.deepEqual(classificarPagina(null, app, []), { resultados: { app: 'fora' }, fatos: {} });
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

// A checagem inteira com o config real: o app no modo página, as em breve de fora.
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
