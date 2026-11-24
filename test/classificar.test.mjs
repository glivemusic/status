// D3: classificar uma checagem.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checarAlvo, classificar } from '../lib/classificar.mjs';

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
      return { status: r.status, text: async () => r.corpo };
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
