// D3: classificar uma checagem. D25: o redirecionamento, o limite do corpo e o motivo no log.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { aplicarMedida, arquivoDaMedida, medirChecagem } from '../lib/checagem.mjs';
import { CORPO_MAXIMO_BYTES, ESPERA_NOVA_TENTATIVA_MS, chamar, checarAlvo, classificar } from '../lib/classificar.mjs';
import { TEXTOS } from '../site/textos.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));

const app = { id: 'app', url: 'https://exemplo.invalid/api/health', componente: 'servidor' };
const dependentes = [
  { id: 'login', alvo: 'app', componente: 'login' },
  { id: 'banco', alvo: 'app', componente: 'banco' },
];

function corpo(componentes, estado = 'ok') {
  return JSON.stringify({ sistema: 'agronomy-center', estado, verificado_em: '2026-11-23T21:00:00Z', componentes });
}
const resposta = (status, texto, duracaoMs = 300) => ({ status, corpo: texto, duracaoMs });

test('corpo válido com 200: cada linha recebe o seu componente', () => {
  const r = classificar(resposta(200, corpo({ servidor: 'ok', login: 'degradado', banco: 'ok' })), app, dependentes);
  assert.deepEqual(r, { app: 'ok', login: 'degradado', banco: 'ok' });
});

test('corpo válido com 503 também vale', () => {
  const r = classificar(resposta(503, corpo({ servidor: 'ok', login: 'ok', banco: 'fora' }, 'fora')), app, dependentes);
  assert.deepEqual(r, { app: 'ok', login: 'ok', banco: 'fora' });
});

test('sem corpo válido: app fora, as que dependem do corpo sem dado', () => {
  const casos = [
    null, // erro de rede ou tempo estourado
    resposta(500, 'erro interno'),
    resposta(502, corpo({ servidor: 'ok', login: 'ok', banco: 'ok' })), // outro status
    resposta(404, corpo({ servidor: 'ok', login: 'ok', banco: 'ok' })),
    resposta(200, '<html>'),
    resposta(200, JSON.stringify({ estado: 'ok' })),
    resposta(200, corpo({ servidor: 'talvez' })),
    resposta(200, JSON.stringify({ sistema: 'x', estado: 'ok', verificado_em: 'ontem', componentes: {} })),
    resposta(200, JSON.stringify({ sistema: 'x', estado: 'ok', verificado_em: '2026-11-23T21:00:00Z', componentes: [] })),
  ];
  for (const caso of casos) {
    assert.deepEqual(classificar(caso, app, dependentes), { app: 'fora', login: 'sem_dado', banco: 'sem_dado' });
  }
});

test('componente ausente vira sem dado', () => {
  const r = classificar(resposta(200, corpo({ servidor: 'ok', login: 'ok' })), app, dependentes);
  assert.deepEqual(r, { app: 'ok', login: 'ok', banco: 'sem_dado' });
  const semServidor = classificar(resposta(200, corpo({ login: 'ok', banco: 'ok' })), app, dependentes);
  assert.equal(semServidor.app, 'sem_dado');
});

test('lentidão: mais de 5 s rebaixa app de ok para degradado; 5 s exatos não', () => {
  const texto = corpo({ servidor: 'ok', login: 'ok', banco: 'ok' });
  assert.equal(classificar(resposta(200, texto, 5001), app, dependentes).app, 'degradado');
  assert.equal(classificar(resposta(200, texto, 5000), app, dependentes).app, 'ok');
  assert.equal(classificar(resposta(200, texto, 5001), app, dependentes).login, 'ok');
});

// Um fetch falso que devolve as respostas em ordem; o relógio avança `duracoes[i]` ms em cada chamada.
function falso(respostas, duracoes = []) {
  let agora = 0;
  let i = 0;
  const chamadas = [];
  const esperas = [];
  return {
    chamadas,
    esperas,
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
      if (r instanceof Response) return r;
      return new Response(r.corpo, { status: r.status });
    },
  };
}

test('nova tentativa que salva: a primeira falha, a segunda vale', async () => {
  const f = falso([new Error('rede'), { status: 200, corpo: corpo({ servidor: 'ok', login: 'ok', banco: 'ok' }) }]);
  const { resultados: r } = await checarAlvo(app, dependentes, f);
  assert.deepEqual(r, { app: 'ok', login: 'ok', banco: 'ok' });
  assert.equal(f.chamadas.length, 2);
  assert.deepEqual(f.esperas, [20_000]);
  assert.equal(f.chamadas[0].opcoes.headers['User-Agent'], 'status-agronomy-center');
  assert.equal(f.chamadas[0].opcoes.method, 'GET');
});

test('nova tentativa que confirma a falha', async () => {
  const f = falso([{ status: 500, corpo: '' }, new Error('rede')]);
  const { resultados: r } = await checarAlvo(app, dependentes, f);
  assert.deepEqual(r, { app: 'fora', login: 'sem_dado', banco: 'sem_dado' });
  assert.equal(f.chamadas.length, 2);
});

test('componente fora também pede a nova tentativa', async () => {
  const f = falso([
    { status: 503, corpo: corpo({ servidor: 'ok', login: 'fora', banco: 'ok' }, 'fora') },
    { status: 503, corpo: corpo({ servidor: 'ok', login: 'fora', banco: 'ok' }, 'fora') },
  ]);
  const { resultados: r } = await checarAlvo(app, dependentes, f);
  assert.equal(r.login, 'fora');
  assert.equal(f.chamadas.length, 2);
});

test('sem fora, não há nova tentativa; a lentidão vem do relógio', async () => {
  const f = falso([{ status: 200, corpo: corpo({ servidor: 'ok', login: 'ok', banco: 'ok' }) }], [6000]);
  const { resultados: r } = await checarAlvo(app, dependentes, f);
  assert.equal(r.app, 'degradado');
  assert.equal(f.chamadas.length, 1);
  assert.deepEqual(f.esperas, []);
});

// D25: um corpo em fluxo que conta os pedaços puxados e anota o cancelamento. `highWaterMark: 0`: só puxa quando
// alguém lê, então os puxados são os lidos.
function fluxo(pedacos) {
  const estado = { puxados: 0, cancelado: false };
  estado.corpo = new ReadableStream(
    {
      pull(controle) {
        if (estado.puxados >= pedacos.length) {
          controle.close();
          return;
        }
        controle.enqueue(pedacos[estado.puxados]);
        estado.puxados += 1;
      },
      cancel() {
        estado.cancelado = true;
      },
    },
    { highWaterMark: 0 },
  );
  return estado;
}

const bytes = (texto) => new TextEncoder().encode(texto);
const tudoOk = { servidor: 'ok', login: 'ok', banco: 'ok' };
const FORA_SEM_CORPO = { app: 'fora', login: 'sem_dado', banco: 'sem_dado' };

// Um corpo do contrato com exatamente `n` bytes (um campo a mais, que o contrato aceita, completa o tamanho).
function corpoCom(n) {
  const base = JSON.parse(corpo(tudoOk));
  const vazio = Buffer.byteLength(JSON.stringify({ ...base, x: '' }));
  const texto = JSON.stringify({ ...base, x: 'a'.repeat(n - vazio) });
  assert.equal(Buffer.byteLength(texto), n);
  return texto;
}

test('D25: 301, 302 e 307 são falha: app fora, dependentes sem dado, motivo «redirecionado», corpo cancelado sem ler', async () => {
  for (const status of [301, 302, 307]) {
    const fluxos = [fluxo([bytes('x'.repeat(100))]), fluxo([bytes('x'.repeat(100))])];
    const cabecalhos = { Location: '/login', 'Set-Cookie': 'sessao=abc' };
    const f = falso(fluxos.map((fl) => new Response(fl.corpo, { status, headers: cabecalhos })));
    const saida = await checarAlvo(app, dependentes, f);
    assert.deepEqual(saida, { resultados: FORA_SEM_CORPO, fatos: {}, motivo: 'redirecionado' }, String(status));
    assert.equal(f.chamadas.length, 2, 'a nova tentativa de D3 continua');
    for (const fl of fluxos) {
      assert.equal(fl.puxados, 0, 'o corpo não foi lido');
      assert.equal(fl.cancelado, true, 'o corpo foi cancelado');
    }
    for (const { opcoes } of f.chamadas) {
      assert.equal(opcoes.redirect, 'manual');
      assert.equal(opcoes.credentials, 'omit');
      assert.equal(opcoes.cache, 'no-store');
      assert.deepEqual(opcoes.headers, { 'User-Agent': 'status-agronomy-center' });
      assert.ok(opcoes.signal instanceof AbortSignal);
    }
  }
});

test('D25: o corpo válido de exatamente 4096 bytes passa', async () => {
  assert.equal(CORPO_MAXIMO_BYTES, 4096);
  const f = falso([{ status: 200, corpo: corpoCom(4096) }]);
  const saida = await checarAlvo(app, dependentes, f);
  assert.deepEqual(saida, { resultados: { app: 'ok', login: 'ok', banco: 'ok' }, fatos: {} });
  assert.equal(f.chamadas.length, 1);
});

test('D25: 4097 bytes é falha «resposta grande demais»: lê até passar do limite, cancela e não lê o resto', async () => {
  const texto = bytes(corpoCom(4097));
  // 4096 bytes, 1 byte e mais 10 pedaços que nunca deviam ser puxados.
  const pedacos = () => [texto.slice(0, 4096), texto.slice(4096), ...Array.from({ length: 10 }, () => bytes('y'.repeat(1024)))];
  const fluxos = [fluxo(pedacos()), fluxo(pedacos())];
  const f = falso(fluxos.map((fl) => new Response(fl.corpo, { status: 200 })));
  const saida = await checarAlvo(app, dependentes, f);
  assert.deepEqual(saida, { resultados: FORA_SEM_CORPO, fatos: {}, motivo: 'resposta grande demais' });
  for (const fl of fluxos) {
    assert.equal(fl.puxados, 2, 'parou no pedaço que passou do limite');
    assert.equal(fl.cancelado, true);
  }
  // Um pedaço só, grande: também para nele.
  const grande = fluxo([bytes('z'.repeat(64 * 1024)), bytes('z')]);
  const r = await chamar(app.url, { fetch: async () => new Response(grande.corpo, { status: 503 }), relogio: () => 0 });
  assert.deepEqual(r, { status: 503, duracaoMs: 0, motivo: 'resposta grande demais' });
  assert.equal(grande.puxados, 1);
  assert.equal(grande.cancelado, true);
});

test('D25: a nova tentativa depois de 20 s continua valendo: 302 e depois 200 válido é ok, sem motivo', async () => {
  const f = falso([{ status: 302, corpo: '' }, { status: 200, corpo: corpo(tudoOk) }]);
  const saida = await checarAlvo(app, dependentes, f);
  assert.deepEqual(saida, { resultados: { app: 'ok', login: 'ok', banco: 'ok' }, fatos: {} });
  assert.deepEqual(f.esperas, [ESPERA_NOVA_TENTATIVA_MS]);
  assert.equal(ESPERA_NOVA_TENTATIVA_MS, 20_000);
  // E ao contrário: vale o motivo da segunda chamada.
  const g = falso([new TypeError('fetch failed'), { status: 302, corpo: '' }]);
  assert.equal((await checarAlvo(app, dependentes, g)).motivo, 'redirecionado');
});

test('D25: os outros motivos: sem resposta, status inesperado, fora do contrato; corpo válido não tem motivo', async () => {
  const tempo = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  const grande = 'x'.repeat(5000);
  const casos = [
    [new TypeError('fetch failed'), 'sem resposta'],
    [tempo, 'sem resposta'],
    [{ status: 500, corpo: 'erro interno' }, 'status inesperado'],
    [{ status: 404, corpo: corpo(tudoOk) }, 'status inesperado'],
    [{ status: 502, corpo: corpo(tudoOk) }, 'status inesperado'],
    [{ status: 201, corpo: corpo(tudoOk) }, 'status inesperado'],
    // O status chega antes do corpo: fora de 200/503, o motivo é o status (o corpo nem é lido).
    [{ status: 500, corpo: grande }, 'status inesperado'],
    [{ status: 200, corpo: '<html>' }, 'fora do contrato'],
    [{ status: 200, corpo: '' }, 'fora do contrato'],
    [{ status: 200, corpo: JSON.stringify({ estado: 'ok' }) }, 'fora do contrato'],
    [{ status: 503, corpo: corpo({ servidor: 'talvez' }) }, 'fora do contrato'],
    [{ status: 200, corpo: grande }, 'resposta grande demais'],
  ];
  for (const [resposta, motivo] of casos) {
    const f = falso([resposta, resposta]);
    const saida = await checarAlvo(app, dependentes, f);
    assert.deepEqual(saida, { resultados: FORA_SEM_CORPO, fatos: {}, motivo }, `${resposta.status ?? resposta.name}: ${motivo}`);
  }
  // Status fora de 200/503 (e não 3xx): o corpo é cancelado sem ler.
  for (const status of [500, 404, 201]) {
    const fl = fluxo([bytes(corpo(tudoOk))]);
    const r = await chamar(app.url, { fetch: async () => new Response(fl.corpo, { status }), relogio: () => 0 });
    assert.deepEqual(r, { status, duracaoMs: 0, motivo: 'status inesperado' }, String(status));
    assert.equal(fl.puxados, 0, `${status}: o corpo não foi lido`);
    assert.equal(fl.cancelado, true, `${status}: o corpo foi cancelado`);
  }
  // Corpo válido com um componente fora: falha da linha, não da checagem; sem motivo.
  const comBancoFora = { status: 503, corpo: corpo({ servidor: 'ok', login: 'ok', banco: 'fora' }, 'fora') };
  const saida = await checarAlvo(app, dependentes, falso([comBancoFora, comBancoFora]));
  assert.ok(!('motivo' in saida));
  // A chamada que falha na rede devolve só o motivo.
  const semRede = await chamar(app.url, { fetch: async () => Promise.reject(new TypeError('x')), relogio: () => 0 });
  assert.deepEqual(semRede, { motivo: 'sem resposta' });
  // Corpo nulo é corpo vazio.
  const nulo = await chamar(app.url, { fetch: async () => ({ status: 200, body: null }), relogio: () => 0 });
  assert.deepEqual(nulo, { status: 200, corpo: '', duracaoMs: 0 });
});

test('D25: o corpo que dá erro no meio da leitura é «sem resposta», com app fora, sem travar', async () => {
  // O fluxo dá erro no 2º pedaço.
  const comErro = () => {
    let n = 0;
    return new ReadableStream(
      {
        pull(controle) {
          n += 1;
          if (n === 1) controle.enqueue(bytes('{"sistema":'));
          else controle.error(new TypeError('terminated'));
        },
      },
      { highWaterMark: 0 },
    );
  };
  const f = falso([new Response(comErro(), { status: 200 }), new Response(comErro(), { status: 200 })]);
  const saida = await checarAlvo(app, dependentes, f);
  assert.deepEqual(saida, { resultados: FORA_SEM_CORPO, fatos: {}, motivo: 'sem resposta' });
  assert.equal(f.chamadas.length, 2, 'a nova tentativa de D3 continua');
});

test('D25: com o fetch de verdade, num servidor local: 302 sem seguir e sem cookie; corpo grande cortado', async () => {
  const pedidos = [];
  const servidor = createServer((req, res) => {
    pedidos.push({ url: req.url, headers: req.headers });
    if (req.url === '/grande') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('x'.repeat(256 * 1024));
      return;
    }
    if (req.url === '/login') {
      res.writeHead(200).end(corpo(tudoOk));
      return;
    }
    res.writeHead(302, { Location: '/login', 'Set-Cookie': 'sessao=abc; Path=/' });
    res.end('x'.repeat(256 * 1024));
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${servidor.address().port}`;
    const opcoes = { fetch: globalThis.fetch, relogio: Date.now };
    const primeira = await chamar(`${base}/api/health`, opcoes);
    const segunda = await chamar(`${base}/api/health`, opcoes);
    for (const r of [primeira, segunda]) {
      assert.equal(r.status, 302);
      assert.equal(r.motivo, 'redirecionado');
      assert.ok(!('corpo' in r), 'nada do corpo é guardado');
    }
    assert.deepEqual(pedidos.map((p) => p.url), ['/api/health', '/api/health'], 'não segue para o login');
    for (const p of pedidos) {
      assert.equal(p.headers.cookie, undefined, 'sem cookie, nem o que a primeira resposta mandou gravar');
      assert.equal(p.headers.authorization, undefined);
      assert.equal(p.headers['user-agent'], 'status-agronomy-center');
    }
    const grande = await chamar(`${base}/grande`, opcoes);
    assert.equal(grande.status, 200);
    assert.equal(grande.motivo, 'resposta grande demais');
    assert.ok(!('corpo' in grande));
  } finally {
    servidor.closeAllConnections();
    await new Promise((r) => servidor.close(r));
  }
});

// D25: o motivo vai ao log, nunca ao arquivo da medida nem ao ramo `dados`.
const configReal = JSON.parse(readFileSync(join(RAIZ, 'config', 'alvos.json'), 'utf8'));

test('D25: medirChecagem devolve os motivos dos alvos que falharam; o arquivo da medida e aplicarMedida não mudam', async () => {
  const relogio = () => Date.parse('2026-11-25T15:47:00Z');
  const medida = await medirChecagem({
    config: configReal,
    fetch: async () => new Response('', { status: 302, headers: { Location: 'https://outro.invalid/login' } }),
    relogio,
    esperar: async () => {},
  });
  assert.deepEqual(medida.motivos, { app: 'redirecionado' });
  assert.deepEqual(medida.resultados, { app: 'fora', login: 'sem_dado', banco: 'sem_dado', satelite: 'sem_dado' });
  assert.ok(!JSON.stringify(medida).includes('outro.invalid'), 'nada da resposta na medida');

  // O arquivo: só instante, resultados e fatos.
  const arquivo = arquivoDaMedida(medida);
  assert.deepEqual(Object.keys(arquivo).sort(), ['fatos', 'instante', 'resultados']);
  const { motivos: _motivos, ...semMotivos } = medida;
  assert.deepEqual(arquivo, semMotivos);

  // aplicarMedida dá o mesmo com e sem os motivos.
  const aplicar = (m) => aplicarMedida({ config: configReal, estado: {}, dias: {}, incidentes: [], medida: m, textos: TEXTOS });
  assert.deepEqual(aplicar(medida), aplicar(arquivo));

  // Sem falha, os motivos ficam vazios.
  const boa = await medirChecagem({
    config: configReal,
    fetch: async () => new Response(corpo({ ...tudoOk, satelite: 'ok' }), { status: 200 }),
    relogio,
    esperar: async () => {},
  });
  assert.deepEqual(boa.motivos, {});
});

test('D25: o checar.mjs grava a medida só com instante, resultados e fatos (sem alvo: sem rede)', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'status-checar-'));
  try {
    const config = join(pasta, 'alvos.json');
    writeFileSync(config, JSON.stringify({ linhas: [{ id: 'app', nome: 'App' }] }));
    const destino = join(pasta, 'sub', 'medida.json');
    const args = ['scripts/checar.mjs', '--config', config, '--medida', destino];
    const r = spawnSync(process.execPath, args, { cwd: RAIZ, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(destino, 'utf8'))).sort(), ['fatos', 'instante', 'resultados']);
    assert.ok(!r.stdout.includes('Motivo'));
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});
