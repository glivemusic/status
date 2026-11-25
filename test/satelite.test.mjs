// D11: a linha do satélite. Conta por fato distinto, nunca fica «fora», nunca pinta vermelho.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { classificar } from '../lib/classificar.mjs';
import { executarChecagem } from '../lib/checagem.mjs';
import { corDoDia, disponibilidade, esperadasNoDia } from '../lib/dias.mjs';
import { estadoGeral, estadosDoGeral } from '../lib/geral.mjs';
import { minutosDesde } from '../lib/tempo.mjs';
import { visaoDoEstado } from '../lib/visao.mjs';
import { TEXTOS } from '../site/textos.mjs';

// D24: o config real, com o app na rota de saúde (o `fetch` é falso: nada chama a rede).
const config = JSON.parse(readFileSync(new URL('../config/alvos.json', import.meta.url), 'utf8'));
const satelite = config.linhas.find((l) => l.id === 'satelite');
const app = config.linhas.find((l) => l.id === 'app');
const dependentes = config.linhas.filter((l) => l.alvo === 'app');

// O que a página mostraria: o geral e o estado de cada linha, pela visão (D24: o satélite fora do geral).
function naPagina(estado) {
  const visao = visaoDoEstado(config, estado);
  return {
    geral: estadoGeral(estadosDoGeral(visao.linhas), visao.verificado_em, visao.verificado_em),
    linhas: Object.fromEntries(visao.linhas.map((l) => [l.id, l.estado])),
    satelite: visao.linhas.find((l) => l.id === 'satelite'),
  };
}

test('o config: o satélite vem do corpo do app, um fato a cada 2 h, checado e fora do geral (D24)', () => {
  const linha = satelite;
  assert.equal(linha.pendente, undefined);
  assert.equal(linha.em_breve, undefined);
  assert.equal(linha.fora_do_geral, true);
  assert.equal(linha.alvo, 'app');
  assert.equal(linha.componente, 'satelite');
  assert.equal(linha.intervalo_s, 7200);
  assert.equal(linha.url, undefined);
});

// Um corpo do app. `sat`: o valor de componentes.satelite (undefined: ausente); `fato`: o objeto satelite.
function corpo({ servidor = 'ok', sat, fato } = {}) {
  const componentes = { servidor, login: 'ok', banco: 'ok' };
  if (sat !== undefined) componentes.satelite = sat;
  const json = { sistema: 'agronomy-center', estado: 'ok', verificado_em: '2026-11-23T21:00:00Z', componentes };
  if (fato !== undefined) json.satelite = fato;
  return JSON.stringify(json);
}
const resposta = (texto, status = 200) => ({ status, corpo: texto, duracaoMs: 300 });
const fato = (verificado_em = '2026-11-23T20:00:00Z', idade_s = 3600) => ({ verificado_em, idade_s });
const linhaDoSatelite = (r) => classificar(r, app, dependentes).satelite;

test('classificar: ok e degradado vêm do componente; sem_dado com o objeto nulo', () => {
  assert.equal(linhaDoSatelite(resposta(corpo({ sat: 'ok', fato: fato() }))), 'ok');
  assert.equal(linhaDoSatelite(resposta(corpo({ sat: 'degradado', fato: fato() }))), 'degradado');
  assert.equal(
    linhaDoSatelite(resposta(corpo({ sat: 'sem_dado', fato: { verificado_em: null, idade_s: null } }))),
    'sem_dado',
  );
});

test('classificar: resposta antiga, sem os campos, continua válida; só o satélite fica sem dado', () => {
  const r = classificar(resposta(corpo()), app, dependentes);
  assert.deepEqual(r, { app: 'ok', login: 'ok', banco: 'ok', satelite: 'sem_dado' });
  // Componente ok sem o objeto do fato: não há fato para contar.
  assert.equal(linhaDoSatelite(resposta(corpo({ sat: 'ok' }))), 'sem_dado');
  // Objeto do fato fora do formato.
  for (const ruim of ['ontem', [], { verificado_em: 'ontem', idade_s: 1 }, { verificado_em: '2026-11-23T20:00:00Z' }, fato(undefined, -1)]) {
    assert.equal(linhaDoSatelite(resposta(corpo({ sat: 'ok', fato: ruim }))), 'sem_dado', JSON.stringify(ruim));
  }
});

test('classificar: componentes.satelite «fora» ou inválido torna só a linha sem dado, sem invalidar o corpo', () => {
  for (const valor of ['fora', 'talvez', null, 3]) {
    const r = classificar(resposta(corpo({ sat: valor, fato: fato() })), app, dependentes);
    assert.deepEqual(r, { app: 'ok', login: 'ok', banco: 'ok', satelite: 'sem_dado' }, String(valor));
  }
});

test('classificar: idade de 18000 s conta; 18001 é sem dado', () => {
  assert.equal(linhaDoSatelite(resposta(corpo({ sat: 'ok', fato: fato(undefined, 18000) }))), 'ok');
  assert.equal(linhaDoSatelite(resposta(corpo({ sat: 'degradado', fato: fato(undefined, 18000) }))), 'degradado');
  assert.equal(linhaDoSatelite(resposta(corpo({ sat: 'ok', fato: fato(undefined, 18001) }))), 'sem_dado');
});

test('classificar: sem corpo válido o satélite é sem dado, nunca fora', () => {
  for (const r of [null, resposta('erro', 500), resposta('<html>'), resposta(corpo({ servidor: 'talvez', sat: 'ok', fato: fato() }))]) {
    const saida = classificar(r, app, dependentes);
    assert.equal(saida.app, 'fora');
    assert.equal(saida.satelite, 'sem_dado');
  }
});

// A execução inteira: cada passo é uma checagem de 5 em 5 min com o que o app devolve.
// A primeira checagem é depois de todos os fatos de F (D18: fato mais de 10 min no futuro não conta).
const INICIO = Date.parse('2026-11-23T18:02:00Z');
const PASSO = 5 * 60_000;
const hora = (n) => new Date(INICIO + n * PASSO).toISOString();
// Os fatos: o app pergunta ao provedor nas horas pares.
const F = {
  a: '2026-11-23T10:00:00.000Z',
  b: '2026-11-23T12:00:00.000Z',
  c: '2026-11-23T14:00:00.000Z',
  d: '2026-11-23T16:00:00.000Z',
};

// Passo: [valor do satélite, fato] | 'rede' | { servidor, sat, fato } (corpo cru).
// `inicio`: o instante (ms) da primeira checagem; as outras vêm de 5 em 5 min.
async function rodar(passos, dados = {}, inicio = INICIO) {
  let { estado = {}, dias = {}, incidentes = [] } = dados;
  const saidas = [];
  for (let n = 0; n < passos.length; n += 1) {
    const p = passos[n];
    const agora = inicio + n * PASSO;
    const s = await executarChecagem({
      config,
      estado,
      dias,
      incidentes,
      fetch: async () => {
        if (p === 'rede') throw new Error('rede');
        const texto = Array.isArray(p) ? corpo({ sat: p[0], fato: p[1] === null ? undefined : fato(p[1]) }) : corpo(p);
        return { status: 200, text: async () => texto };
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
const doSatelite = (incidentes) => incidentes.filter((i) => i.linhas.includes('satelite'));

test('leituras repetidas do mesmo fato contam 1: contagem, dia e verificado_em', async () => {
  const { estado, dias, saidas } = await rodar([['ok', F.a], ['ok', F.a], ['ok', F.a], ['ok', F.a]]);
  assert.equal(dias.satelite['2026-11-23'].feitas, 1);
  assert.equal(dias.satelite['2026-11-23'].ok, 1);
  assert.equal(estado.linhas.satelite.boas_seguidas, 1);
  assert.equal(estado.linhas.satelite.verificado_em, F.a);
  assert.equal(estado.linhas.satelite.estado, 'ok');
  assert.deepEqual(saidas.map((s) => s.repetidas.includes('satelite')), [false, true, true, true]);
  // O verificado_em do fato é normalizado: o mesmo instante escrito de outro jeito é o mesmo fato.
  const outra = await rodar([['ok', '2026-11-23T10:00:00Z'], ['ok', '2026-11-23T07:00:00-03:00']]);
  assert.equal(outra.dias.satelite['2026-11-23'].feitas, 1);
});

test('D15: verificado_em igual ao maior já visto não conta (nem escrito de outro jeito)', async () => {
  const { estado, dias, incidentes, saidas } = await rodar([
    ['degradado', F.b],
    ['degradado', F.b],
    ['degradado', '2026-11-23T09:00:00-03:00'], // o mesmo instante de F.b
  ]);
  assert.equal(dias.satelite['2026-11-23'].feitas, 1);
  assert.equal(estado.linhas.satelite.degradadas_seguidas, 1);
  assert.equal(doSatelite(incidentes).length, 0, 'o mesmo fato lido de novo não abre');
  assert.deepEqual(saidas.map((s) => s.repetidas.includes('satelite')), [false, true, true]);
});

test('D15: verificado_em menor (o cache que volta) não conta, não abre e não substitui o maior', async () => {
  // O maior é F.c (ok); volta F.b degradado e depois F.a degradado: nada conta, nada abre.
  const { estado, dias, incidentes, saidas } = await rodar([['ok', F.c], ['degradado', F.b], ['degradado', F.a]]);
  assert.deepEqual(dias.satelite['2026-11-23'], { feitas: 1, ok: 1, degradado: 0, fora: 0, minutos_fora: 0 });
  assert.equal(estado.linhas.satelite.verificado_em, F.c, 'o «Verificado há» segue do maior');
  assert.equal(estado.linhas.satelite.estado, 'ok', 'o fato velho não troca o estado da linha');
  assert.equal(estado.linhas.satelite.boas_seguidas, 1);
  assert.equal(estado.linhas.satelite.degradadas_seguidas, 0);
  assert.equal(doSatelite(incidentes).length, 0);
  assert.deepEqual(saidas.map((s) => s.repetidas.includes('satelite')), [false, true, true]);

  // Com incidente aberto, um ok velho não fecha.
  const aberto = await rodar([['degradado', F.b], ['degradado', F.c], ['ok', F.a]]);
  const [i] = doSatelite(aberto.incidentes);
  assert.equal(i.fim, null, 'o ok mais velho não fecha');
  assert.equal(aberto.estado.linhas.satelite.verificado_em, F.c);
  assert.equal(aberto.estado.linhas.satelite.estado, 'degradado');
});

test('D15: depois de um sem_dado passageiro, a leitura do mesmo fato (ou de um mais velho) volta ao estado do último fato', async () => {
  for (const volta of [['degradado', F.b], ['ok', F.a]]) {
    const { estado, dias, incidentes, saidas } = await rodar([['degradado', F.a], ['degradado', F.b], 'rede', volta]);
    assert.equal(saidas[2].estado.linhas.satelite.estado, 'sem_dado', 'o sem_dado passageiro aparece');
    const linha = estado.linhas.satelite;
    assert.equal(linha.estado, 'degradado', `volta ao último fato contado (${volta})`);
    assert.equal(linha.verificado_em, F.b);
    assert.equal(linha.degradadas_seguidas, 2);
    const [i] = doSatelite(incidentes);
    assert.equal(i.fim, null, 'o incidente continua aberto');
    assert.equal(linha.incidente, i.id);
    assert.deepEqual(dias.satelite['2026-11-23'], { feitas: 2, ok: 0, degradado: 2, fora: 0, minutos_fora: 0 }, 'nada conta no dia');
    assert.equal(saidas[3].repetidas.includes('satelite'), true);
    // D24: a página mostra a linha degradada; o geral não muda por ela.
    const pagina = naPagina(estado);
    assert.equal(pagina.linhas.satelite, 'degradado');
    assert.equal(pagina.geral, 'ok');
  }
});

test('D18: verificado_em 10 min à frente da checagem conta; 11 min não conta nem substitui o maior', async () => {
  const checagem = Date.parse('2026-11-23T20:00:00Z');
  const aFrente = (min) => new Date(checagem + min * 60_000).toISOString();

  const dez = await rodar([['ok', aFrente(10)]], {}, checagem);
  assert.equal(dez.estado.linhas.satelite.verificado_em, aFrente(10));
  assert.equal(dez.estado.linhas.satelite.estado, 'ok');
  assert.equal(dez.dias.satelite['2026-11-23'].feitas, 1);
  assert.deepEqual(dez.saidas[0].repetidas, []);

  const onze = await rodar([['ok', aFrente(11)]], {}, checagem);
  assert.equal(onze.estado.linhas.satelite.verificado_em, null, 'sem fato contado');
  assert.equal(onze.estado.linhas.satelite.estado, 'sem_dado');
  assert.equal(onze.dias.satelite, undefined, 'nada no dia');
  assert.deepEqual(onze.saidas[0].repetidas, ['satelite']);

  // Depois de um fato contado (F.d, ok), um degradado 11 min à frente não conta, não abre e não vira o maior;
  // o mesmo fato, quando a hora chega, conta.
  const futuro = '2026-11-23T20:21:00.000Z';
  const r = await rodar([['ok', F.d], ['degradado', futuro], ['degradado', futuro]], {}, checagem);
  const linha = r.saidas[1].estado.linhas.satelite;
  assert.equal(linha.verificado_em, F.d, 'o maior continua o último contado');
  assert.equal(linha.estado, 'ok', 'a linha volta ao estado do último fato');
  assert.equal(linha.degradadas_seguidas, 0);
  assert.deepEqual(r.saidas[1].repetidas, ['satelite']);
  // A 3ª checagem é às 20:10: o fato das 20:21 está a 11 min, ainda não conta.
  assert.equal(r.estado.linhas.satelite.verificado_em, F.d);
  const depois = await rodar([['degradado', futuro]], r, Date.parse('2026-11-23T20:11:00Z'));
  assert.equal(depois.estado.linhas.satelite.verificado_em, futuro, 'a 10 min, conta');
  assert.equal(depois.estado.linhas.satelite.degradadas_seguidas, 1);
  assert.equal(doSatelite(depois.incidentes).length, 0);
});

test('D15: verificado_em maior conta, mesmo depois de um que voltou', async () => {
  const { estado, dias, incidentes, saidas } = await rodar([['ok', F.b], ['ok', F.a], ['degradado', F.c], ['degradado', F.d]]);
  assert.deepEqual(dias.satelite['2026-11-23'], { feitas: 3, ok: 1, degradado: 2, fora: 0, minutos_fora: 0 });
  assert.equal(estado.linhas.satelite.verificado_em, F.d);
  const [i] = doSatelite(incidentes);
  assert.equal(i.inicio, F.c);
  assert.deepEqual(saidas.map((s) => s.repetidas.includes('satelite')), [false, true, false, false]);
});

test('1 fato degradado não abre (nem lido várias vezes); 2 fatos distintos abrem «degradado»', async () => {
  const um = await rodar([['degradado', F.a], ['degradado', F.a], ['degradado', F.a], ['degradado', F.a]]);
  assert.equal(doSatelite(um.incidentes).length, 0);
  assert.equal(um.estado.linhas.satelite.estado, 'degradado');
  assert.equal(um.estado.linhas.satelite.degradadas_seguidas, 1);

  const dois = await rodar([['ok', F.a], ['degradado', F.b], ['degradado', F.b], ['degradado', F.c]]);
  const lista = doSatelite(dois.incidentes);
  assert.equal(lista.length, 1);
  const [i] = lista;
  assert.equal(i.tipo, 'degradado');
  assert.equal(i.origem, 'automatico');
  assert.equal(i.inicio, F.b, 'início no verificado_em do primeiro fato ruim');
  assert.equal(i.fim, null);
  assert.equal(i.id, '20261123-1200-satelite');
  assert.deepEqual(i.titulo, { 'pt-BR': 'Atraso nas imagens de satélite', 'es-PY': 'Demora en las imágenes satelitales' });
  assert.equal(i.atualizacoes[0].em, hora(3));
  assert.equal(i.atualizacoes[0].estado, 'investigando');
  assert.deepEqual(i.atualizacoes[0].texto, {
    'pt-BR':
      'O provedor das imagens Sentinel-2 não está respondendo. Imagens novas podem demorar; o restante do aplicativo funciona normalmente.',
    'es-PY':
      'El proveedor de las imágenes Sentinel-2 no está respondiendo. Las imágenes nuevas pueden demorar; el resto de la aplicación funciona con normalidad.',
  });
  assert.equal(dois.estado.linhas.satelite.incidente, i.id);
  assert.equal(dois.saidas.at(-1).publicar, true);
});

test('sem dado no meio não quebra a série do satélite', async () => {
  const { incidentes } = await rodar([['degradado', F.a], 'rede', ['sem_dado', null], ['degradado', F.b]]);
  assert.equal(doSatelite(incidentes).length, 1);
  assert.equal(doSatelite(incidentes)[0].inicio, F.a);
});

test('1 fato ok fecha, com o fim no verificado_em do fato bom; a leitura repetida do ok não muda nada', async () => {
  const { incidentes, estado, saidas } = await rodar([
    ['degradado', F.a],
    ['degradado', F.b],
    ['degradado', F.b],
    ['ok', F.c],
    ['ok', F.c],
  ]);
  const [i] = doSatelite(incidentes);
  assert.equal(i.fim, F.c);
  assert.equal(estado.linhas.satelite.incidente, null);
  const ultima = i.atualizacoes.at(-1);
  assert.equal(ultima.estado, 'resolvido');
  // 14:00 UTC é 11:00 em Assunção.
  assert.equal(ultima.texto['pt-BR'], 'O serviço voltou ao normal às 11:00.');
  assert.equal(ultima.texto['es-PY'], 'El servicio volvió a la normalidad a las 11:00.');
  // Publica na 1ª (nunca publicou), ao abrir (2º fato ruim) e ao fechar; a leitura repetida não publica.
  assert.deepEqual(saidas.map((s) => s.publicar), [true, true, false, true, false]);
});

test('nunca fora: nem com corpo inválido, nem com componentes.satelite «fora», nem em série longa', async () => {
  const ruins = await rodar(['rede', 'rede', 'rede', { sat: 'fora', fato: fato(F.a) }, { sat: 'fora', fato: fato(F.b) }]);
  assert.equal(ruins.estado.linhas.satelite.estado, 'sem_dado');
  assert.equal(ruins.estado.linhas.satelite.fora_seguidas, 0);
  assert.equal(doSatelite(ruins.incidentes).length, 0);
  assert.equal(ruins.dias.satelite, undefined, 'sem fato, nenhum dia');
  // O app, sim, abriu o seu incidente «fora».
  assert.ok(ruins.incidentes.some((i) => i.linhas.includes('app') && i.tipo === 'fora'));

  const longa = await rodar([
    ['degradado', F.a],
    ['degradado', F.b],
    ['degradado', F.c],
    ['degradado', F.d],
    { servidor: 'fora', sat: 'fora', fato: fato('2026-11-23T18:00:00Z') },
  ]);
  const lista = doSatelite(longa.incidentes);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].tipo, 'degradado');
  assert.equal(longa.dias.satelite['2026-11-23'].fora, 0);
  assert.ok(Object.values(longa.estado.linhas.satelite).every((v) => v !== 'fora'));
});

test('automático do satélite resolvido à mão: o mesmo fato não conta de novo', async () => {
  const aberto = await rodar([['degradado', F.a], ['degradado', F.b]]);
  const resolvido = aberto.incidentes.map((i) => ({ ...i, fim: hora(2) }));
  const depois = await rodar([['degradado', F.b]], { ...aberto, incidentes: resolvido });
  assert.equal(depois.estado.linhas.satelite.incidente, null);
  assert.equal(depois.estado.linhas.satelite.degradadas_seguidas, 0);
  assert.equal(depois.dias.satelite['2026-11-23'].feitas, 2);
  assert.equal(doSatelite(depois.incidentes).length, 1);
});

test('o fato conta no dia de Assunção do seu verificado_em, não no da checagem', async () => {
  // Fato às 02:50 UTC do dia 24 (23:50 do dia 23 em Assunção), lido às 03:05 UTC (00:05 do dia 24 em Assunção).
  const { dias, saidas } = await rodar([['ok', '2026-11-24T02:50:00Z']], {}, Date.parse('2026-11-24T03:05:00Z'));
  assert.equal(saidas[0].estado.verificado_em, '2026-11-24T03:05:00.000Z');
  assert.deepEqual(dias.satelite['2026-11-23'], { feitas: 1, ok: 1, degradado: 0, fora: 0, minutos_fora: 0 });
  assert.equal(dias.satelite['2026-11-24'], undefined, 'nada no dia da checagem');
  // A linha app, que conta a checagem, caiu no dia 24.
  assert.equal(dias.app['2026-11-24'].feitas, 1);
  assert.equal(dias.app['2026-11-23'], undefined);
});

test('o dia conta fatos; disponibilidade sem o degradado', async () => {
  const { dias } = await rodar([['ok', F.a], ['degradado', F.b], ['ok', F.c], ['ok', F.d]]);
  assert.deepEqual(dias.satelite['2026-11-23'], { feitas: 4, ok: 3, degradado: 1, fora: 0, minutos_fora: 0 });
  assert.equal(disponibilidade([dias.satelite['2026-11-23']], { porFato: true }), '75,00 %');
  // As outras linhas seguem com o degradado no ar.
  assert.equal(disponibilidade([dias.satelite['2026-11-23']]), '100,00 %');
});

test('previstos: 12 por dia; hoje, proporcional', () => {
  const agora = '2026-11-23T21:00:00Z'; // 18:00 em Assunção
  assert.equal(esperadasNoDia('2026-11-22', agora, 7200), 12);
  assert.equal(esperadasNoDia('2026-11-23', agora, 7200), 9);
  assert.equal(esperadasNoDia('2026-11-24', agora, 7200), 0);
  assert.equal(esperadasNoDia('2026-11-22', agora), 288);
});

test('a cor do satélite: amarela com incidente degradado ou sem fato ok, cinza sem fato no dia, verde com fato ok; nunca vermelha', () => {
  const dia = (extra) => ({ feitas: 12, ok: 12, degradado: 0, fora: 0, minutos_fora: 0, ...extra });
  const cor = (registro, temDegradado = false) => corDoDia({ registro, temDegradado, porFato: true });
  assert.equal(cor(dia()), 'verde');
  assert.equal(cor(dia({ ok: 10, degradado: 2 }), true), 'amarela');
  assert.equal(cor(dia({ ok: 11, degradado: 1 })), 'verde', 'um fato degradado sem incidente não pinta');
  // D21: a regra dos 50 % saiu; um fato basta para o verde.
  assert.equal(cor(dia({ feitas: 1, ok: 1 })), 'verde');
  assert.equal(cor(dia({ feitas: 0, ok: 0 })), 'cinza');
  assert.equal(cor(undefined), 'cinza');
  // Mesmo com minutos fora (um incidente «fora» posto à mão), nunca vermelha.
  assert.equal(cor(dia({ minutos_fora: 300 })), 'verde');
  assert.equal(cor(dia({ minutos_fora: 300 }), true), 'amarela');
  assert.equal(cor(dia({ feitas: 0, ok: 0, minutos_fora: 300 })), 'cinza');
  // D21, a borda: o dia sem nenhum fato `ok` sai amarelo, nunca verde nem vermelho.
  assert.equal(cor(dia({ ok: 0, degradado: 12 })), 'amarela');
  assert.equal(cor(dia({ feitas: 1, ok: 0, degradado: 1 })), 'amarela');
  assert.equal(cor(dia({ ok: 0, fora: 12 })), 'amarela');
  // As outras linhas continuam com a vermelha.
  assert.equal(corDoDia({ registro: dia({ feitas: 288, minutos_fora: 30 }) }), 'vermelha');
});

test('D24: com o satélite degradado (2 fatos distintos) e as outras ok, o geral continua ok; a linha do satélite fica degradada, com o incidente aberto, e a linha app não muda', async () => {
  const { estado, incidentes } = await rodar([['degradado', F.a], ['degradado', F.b]]);
  assert.equal(estado.linhas.app.estado, 'ok');
  assert.equal(estado.linhas.app.degradadas_seguidas, 0);
  assert.equal(estado.linhas.app.incidente, null);
  const pagina = naPagina(estado);
  assert.deepEqual(pagina.linhas, { app: 'ok', login: 'ok', banco: 'ok', satelite: 'degradado' });
  assert.equal(pagina.geral, 'ok');
  // A linha continua com estado, «Verificado há» e o incidente degradado aberto.
  assert.equal(pagina.satelite.verificado_em, F.b);
  const [i] = doSatelite(incidentes);
  assert.equal(i.tipo, 'degradado');
  assert.equal(i.fim, null);
  assert.equal(estado.linhas.satelite.incidente, i.id);
  // Com outra linha degradada, o geral muda por ela.
  const comBanco = structuredClone(estado);
  comBanco.linhas.banco.estado = 'degradado';
  assert.equal(naPagina(comBanco).geral, 'degradado');
});

test('D24: o satélite sem dado, ou com idade_s de 18001, não muda o geral; 18000 conta', async () => {
  const semDado = { sat: 'sem_dado', fato: { verificado_em: null, idade_s: null } };
  for (const passo of [semDado, { sat: 'degradado', fato: fato(F.a, 18001) }, { sat: 'ok', fato: fato(F.a, 18001) }]) {
    const { estado, dias } = await rodar([passo]);
    const pagina = naPagina(estado);
    assert.equal(pagina.linhas.satelite, 'sem_dado', JSON.stringify(passo));
    assert.equal(pagina.geral, 'ok', JSON.stringify(passo));
    assert.equal(dias.satelite, undefined, 'nada conta no dia');
  }
  const conta = await rodar([{ sat: 'degradado', fato: fato(F.a, 18000) }]);
  assert.equal(conta.dias.satelite['2026-11-23'].feitas, 1);
  const pagina = naPagina(conta.estado);
  assert.equal(pagina.linhas.satelite, 'degradado');
  assert.equal(pagina.geral, 'ok');
});

test('«Verificado há…»: minutos inteiros do último fato; sem fato, nada', () => {
  assert.equal(minutosDesde('2026-11-23T20:00:00Z', '2026-11-23T21:00:00Z'), 60);
  assert.equal(minutosDesde('2026-11-23T20:00:00Z', '2026-11-23T20:00:59Z'), 0);
  assert.equal(minutosDesde('2026-11-23T21:05:00Z', '2026-11-23T21:00:00Z'), 0, 'relógio atrasado não dá negativo');
  assert.equal(minutosDesde(null, '2026-11-23T21:00:00Z'), null);
  assert.equal(minutosDesde('ontem', '2026-11-23T21:00:00Z'), null);
});
