// D4: estado e incidente automático, pela execução inteira da checagem.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { executarChecagem } from '../lib/checagem.mjs';
import { TEXTOS } from '../site/textos.mjs';

const config = {
  linhas: [
    { id: 'app', nome: { 'pt-BR': 'Aplicativo', 'es-PY': 'Aplicación' }, url: 'https://exemplo.invalid/h', componente: 'servidor' },
    { id: 'login', nome: { 'pt-BR': 'Login', 'es-PY': 'Inicio' }, alvo: 'app', componente: 'login' },
    { id: 'satelite', nome: { 'pt-BR': 'Satélite', 'es-PY': 'Satélite' }, pendente: true },
  ],
};

const INICIO = Date.parse('2026-11-23T12:02:00Z');
const PASSO = 5 * 60_000;

function respostaDe(servidor, login = 'ok') {
  if (servidor === 'rede') return null;
  const estado = servidor === 'fora' ? 'fora' : 'ok';
  return {
    status: servidor === 'fora' ? 503 : 200,
    corpo: JSON.stringify({
      sistema: 'agronomy-center',
      estado,
      verificado_em: '2026-11-23T12:00:00Z',
      componentes: login === null ? { servidor } : { servidor, login },
    }),
  };
}

// Roda uma série de checagens; cada item é o `componentes.servidor` (ou 'rede'), ou [servidor, login].
async function rodar(serie, dados = {}) {
  let { estado = {}, dias = {}, incidentes = [] } = dados;
  const saidas = [];
  for (let n = 0; n < serie.length; n += 1) {
    const [servidor, login] = Array.isArray(serie[n]) ? serie[n] : [serie[n], 'ok'];
    const agora = INICIO + n * PASSO;
    const s = await executarChecagem({
      config,
      estado,
      dias,
      incidentes,
      fetch: async () => {
        const r = respostaDe(servidor, login);
        if (!r) throw new Error('rede');
        return new Response(r.corpo, { status: r.status });
      },
      relogio: () => agora,
      esperar: async () => {},
      textos: TEXTOS,
    });
    ({ estado, dias, incidentes } = s);
    saidas.push(s);
  }
  return { estado, dias, incidentes, saidas };
}

const hora = (n) => new Date(INICIO + n * PASSO).toISOString();

test('1 falha não abre incidente', async () => {
  const { estado, incidentes } = await rodar(['ok', 'fora']);
  assert.equal(estado.linhas.app.estado, 'fora');
  assert.equal(incidentes.length, 0);
});

test('2 falhas seguidas abrem «fora», com início na primeira', async () => {
  const { estado, incidentes } = await rodar(['ok', 'fora', 'rede']);
  assert.equal(incidentes.length, 1);
  const i = incidentes[0];
  assert.equal(i.tipo, 'fora');
  assert.equal(i.inicio, hora(1));
  assert.equal(i.fim, null);
  assert.equal(i.origem, 'automatico');
  assert.deepEqual(i.linhas, ['app']);
  assert.equal(i.id, '20261123-1207-app');
  assert.equal(estado.linhas.app.incidente, i.id);
  assert.deepEqual(i.titulo, { 'pt-BR': 'Interrupção em Aplicativo', 'es-PY': 'Interrupción en Aplicación' });
  assert.equal(i.atualizacoes[0].estado, 'investigando');
  // 12:12 UTC é 09:12 em Assunção.
  assert.equal(i.atualizacoes[0].texto['pt-BR'], 'Detectado automaticamente às 09:12.');
  assert.equal(i.atualizacoes[0].texto['es-PY'], 'Detectado automáticamente a las 09:12.');
});

test('2 degradadas não abrem; 3 abrem «degradado»', async () => {
  const duas = await rodar(['degradado', 'degradado']);
  assert.equal(duas.incidentes.length, 0);
  const tres = await rodar(['degradado', 'degradado', 'degradado']);
  assert.equal(tres.incidentes.length, 1);
  assert.equal(tres.incidentes[0].tipo, 'degradado');
  assert.equal(tres.incidentes[0].inicio, hora(0));
  assert.deepEqual(tres.incidentes[0].titulo, { 'pt-BR': 'Instabilidade em Aplicativo', 'es-PY': 'Inestabilidad en Aplicación' });
});

test('série que mistura fora e degradado conta como degradada (limite 3)', async () => {
  const dois = await rodar(['fora', 'degradado']);
  assert.equal(dois.incidentes.length, 0);
  const tres = await rodar(['fora', 'degradado', 'degradado']);
  assert.equal(tres.incidentes.length, 1);
  assert.equal(tres.incidentes[0].tipo, 'degradado');
  assert.equal(tres.incidentes[0].inicio, hora(0));
});

test('série com 2 fora já abre como «fora» (degradado, fora, fora); fechar deixa minutos fora', async () => {
  const { incidentes, dias } = await rodar(['degradado', 'fora', 'fora', 'ok', 'ok']);
  assert.equal(incidentes.length, 1);
  assert.equal(incidentes[0].tipo, 'fora');
  assert.equal(incidentes[0].inicio, hora(0));
  assert.equal(incidentes[0].fim, hora(3));
  assert.equal(incidentes[0].titulo['pt-BR'], 'Interrupção em Aplicativo');
  assert.equal(dias.app['2026-11-23'].minutos_fora, 15);
  // E também com fora, degradado, fora.
  const outra = await rodar(['fora', 'degradado', 'fora']);
  assert.equal(outra.incidentes[0].tipo, 'fora');
});

test('1 boa não fecha; 2 fecham, com o fim na primeira boa', async () => {
  const uma = await rodar(['fora', 'fora', 'ok']);
  assert.equal(uma.incidentes[0].fim, null);
  const duas = await rodar(['fora', 'fora', 'ok', 'ok']);
  const i = duas.incidentes[0];
  assert.equal(i.fim, hora(2));
  assert.equal(duas.estado.linhas.app.incidente, null);
  const ultima = i.atualizacoes.at(-1);
  assert.equal(ultima.estado, 'resolvido');
  assert.equal(ultima.texto['pt-BR'], 'O serviço voltou ao normal às 09:12.');
  assert.equal(ultima.texto['es-PY'], 'El servicio volvió a la normalidad a las 09:12.');
});

test('uma boa no meio quebra a série das boas', async () => {
  const { incidentes } = await rodar(['fora', 'fora', 'ok', 'fora', 'ok', 'ok']);
  assert.equal(incidentes.length, 1);
  assert.equal(incidentes[0].fim, hora(4));
});

test('sem dado no meio não quebra a série', async () => {
  // login sem componente na resposta = sem dado.
  const ruins = await rodar([['ok', 'fora'], ['ok', null], ['ok', 'fora']]);
  const login = ruins.incidentes.find((i) => i.linhas.includes('login'));
  assert.ok(login, 'abriu o incidente do login');
  assert.equal(login.inicio, hora(0));
  const boas = await rodar([['ok', 'fora'], ['ok', 'fora'], ['ok', 'ok'], ['ok', null], ['ok', 'ok']]);
  const fechado = boas.incidentes.find((i) => i.linhas.includes('login'));
  assert.equal(fechado.fim, hora(2));
  assert.equal(ruins.estado.linhas.login.estado, 'fora');
});

test('degradado aberto que recebe 2 fora seguidas vira «fora» (mesmo incidente)', async () => {
  const uma = await rodar(['degradado', 'degradado', 'degradado', 'fora']);
  assert.equal(uma.incidentes[0].tipo, 'degradado');
  const { incidentes, saidas } = await rodar(['degradado', 'degradado', 'degradado', 'fora', 'fora']);
  assert.equal(incidentes.length, 1);
  assert.equal(incidentes[0].tipo, 'fora');
  assert.equal(incidentes[0].inicio, hora(0));
  assert.equal(saidas.at(-1).publicar, true);
});

test('linha pendente não é checada nem gera nada', async () => {
  const { estado, dias, incidentes } = await rodar(['fora', 'fora']);
  assert.equal(estado.linhas.satelite, undefined);
  assert.equal(dias.satelite, undefined);
  assert.ok(incidentes.every((i) => !i.linhas.includes('satelite')));
});

test('automático resolvido à mão: a checagem solta a referência e zera a série', async () => {
  const aberto = await rodar(['fora', 'fora']);
  const id = aberto.incidentes[0].id;
  const resolvido = aberto.incidentes.map((i) => ({ ...i, fim: hora(2) }));
  const depois = await rodar(['fora'], { ...aberto, incidentes: resolvido });
  assert.equal(depois.estado.linhas.app.incidente, null);
  assert.equal(depois.estado.linhas.app.fora_seguidas, 1);
  assert.equal(depois.incidentes.length, 1);
  assert.equal(depois.incidentes[0].id, id);
});

test('publicar: com evento, ou quando o último deploy tem mais de 15 min', async () => {
  const { saidas } = await rodar(['ok', 'ok', 'ok', 'ok', 'fora', 'fora']);
  // 1ª: nunca publicou. 2ª a 4ª: até 15 min. 5ª: 20 min depois. 6ª: abriu incidente.
  assert.deepEqual(
    saidas.map((s) => s.publicar),
    [true, false, false, false, true, true],
  );
  assert.equal(saidas[0].estado.publicado_em, hora(0));
  assert.equal(saidas[1].estado.publicado_em, hora(0));
});

test('os dados gravados não levam endereço, tempo nem mensagem de erro', async () => {
  const { estado, dias, incidentes } = await rodar(['rede', 'rede', 'ok']);
  const texto = JSON.stringify({ estado, dias, incidentes });
  assert.ok(!texto.includes('exemplo.invalid'));
  assert.ok(!texto.includes('rede'));
  assert.ok(!/duracao|status|erro/i.test(texto));
});

test('a checagem aplica os cortes de 90 dias e de 1 ano', async () => {
  const registro = { feitas: 288, ok: 288, degradado: 0, fora: 0, minutos_fora: 0 };
  const fechado = (id, inicio) => ({
    id,
    linhas: ['app'],
    tipo: 'fora',
    inicio,
    fim: '2025-11-23T13:00:00Z',
    origem: 'manual',
    titulo: { 'pt-BR': 'x', 'es-PY': 'y' },
    atualizacoes: [],
  });
  const { dias, incidentes } = await rodar(['ok'], {
    // A checagem roda em 2026-11-23 (Assunção): o primeiro dia que fica é 2026-08-26.
    dias: { app: { '2026-08-25': { ...registro }, '2026-08-26': { ...registro } } },
    incidentes: [
      fechado('velho', '2025-11-23T12:00:00Z'),
      fechado('recente', '2025-11-23T12:03:00Z'),
      { ...fechado('aberto-velho', '2025-01-01T00:00:00Z'), linhas: ['login'], fim: null },
    ],
  });
  assert.deepEqual(Object.keys(dias.app).sort(), ['2026-08-26', '2026-11-23']);
  assert.deepEqual(incidentes.map((i) => i.id), ['recente', 'aberto-velho']);
});
