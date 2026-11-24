// D5 e D21: dias de Assunção, disponibilidade, cor da barra, «medindo desde» e cortes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DIAS_PARA_PERCENTUAL,
  atualizarMinutosFora,
  corDoDia,
  cortarDias,
  disponibilidade,
  esperadasNoDia,
  medindoDesde,
  minutosNoDia,
  registrarChecagem,
} from '../lib/dias.mjs';
import { cortarIncidentes, incidentesRecentes, partesDaDuracao } from '../lib/incidentes.mjs';
import { dataDeAssuncao, diaDeAssuncao, horaDeAssuncao, inicioDoDia, somarDias } from '../lib/tempo.mjs';

test('o dia é o de Assunção, também na virada', () => {
  assert.equal(diaDeAssuncao('2026-11-24T02:30:00Z'), '2026-11-23');
  assert.equal(diaDeAssuncao('2026-11-24T03:00:00Z'), '2026-11-24');
  assert.equal(horaDeAssuncao('2026-11-24T02:30:00Z'), '23:30');
  assert.equal(dataDeAssuncao('2026-11-24T02:30:00Z'), '23/11/2026');
  assert.equal(new Date(inicioDoDia('2026-11-24')).toISOString(), '2026-11-24T03:00:00.000Z');
  assert.equal(somarDias('2026-03-01', -1), '2026-02-28');
});

test('a checagem cai no dia de Assunção; sem dado não entra em feitas', () => {
  const dias = {};
  registrarChecagem(dias, 'app', 'ok', '2026-11-24T02:30:00Z');
  registrarChecagem(dias, 'app', 'degradado', '2026-11-24T02:35:00Z');
  registrarChecagem(dias, 'app', 'fora', '2026-11-24T02:40:00Z');
  registrarChecagem(dias, 'app', 'sem_dado', '2026-11-24T02:45:00Z');
  registrarChecagem(dias, 'app', 'ok', '2026-11-24T03:05:00Z');
  assert.deepEqual(dias.app['2026-11-23'], { feitas: 3, ok: 1, degradado: 1, fora: 1, minutos_fora: 0 });
  assert.equal(dias.app['2026-11-24'].feitas, 1);
});

test('disponibilidade: (ok + degradado) / feitas, 2 casas com vírgula; sem checagem, —', () => {
  assert.equal(disponibilidade([{ feitas: 288, ok: 281, degradado: 5, fora: 2, minutos_fora: 10 }]), '99,30 %');
  assert.equal(disponibilidade([{ feitas: 2000, ok: 1999, degradado: 0, fora: 1 }]), '99,95 %');
  assert.equal(disponibilidade([{ feitas: 288, ok: 288, degradado: 0, fora: 0 }]), '100,00 %');
  assert.equal(disponibilidade([]), '—');
  assert.equal(disponibilidade([{ feitas: 0, ok: 0, degradado: 0, fora: 0 }]), '—');
  // Somada nos dias: 3 fora em 576.
  assert.equal(
    disponibilidade([
      { feitas: 288, ok: 288, degradado: 0, fora: 0 },
      { feitas: 288, ok: 280, degradado: 5, fora: 3 },
    ]),
    '99,47 %',
  );
});

test('as quatro cores, com a borda dos 30 min; cinza só sem checagem (D21)', () => {
  const dia = (extra) => ({ feitas: 288, ok: 288, degradado: 0, fora: 0, minutos_fora: 0, ...extra });
  assert.equal(corDoDia({ registro: dia({ minutos_fora: 30 }) }), 'vermelha');
  assert.equal(corDoDia({ registro: dia({ minutos_fora: 29 }) }), 'amarela');
  assert.equal(corDoDia({ registro: dia({ minutos_fora: 1 }) }), 'amarela');
  assert.equal(corDoDia({ registro: dia(), temDegradado: true }), 'amarela');
  assert.equal(corDoDia({ registro: dia() }), 'verde');
  // D21: a regra dos 50 % saiu; o dia com poucas checagens e sem incidente é verde.
  assert.equal(corDoDia({ registro: dia({ feitas: 143, ok: 143 }) }), 'verde');
  assert.equal(corDoDia({ registro: dia({ feitas: 1, ok: 1 }) }), 'verde');
  // D21, a borda: com uma `ok`, a falha isolada sem incidente não pinta.
  assert.equal(corDoDia({ registro: dia({ feitas: 2, ok: 1, fora: 1 }) }), 'verde');
  // Sem nenhuma `ok`: vermelha com alguma `fora`; amarela só com `degradado`.
  assert.equal(corDoDia({ registro: dia({ feitas: 2, ok: 0, fora: 2 }) }), 'vermelha');
  assert.equal(corDoDia({ registro: dia({ feitas: 1, ok: 0, fora: 1 }) }), 'vermelha');
  assert.equal(corDoDia({ registro: dia({ feitas: 3, ok: 0, degradado: 3 }) }), 'amarela');
  assert.equal(corDoDia({ registro: dia({ feitas: 1, ok: 0, degradado: 1 }) }), 'amarela');
  // Sem `ok`, com `fora` e `degradado` juntos: a `fora` vence.
  assert.equal(corDoDia({ registro: dia({ feitas: 2, ok: 0, fora: 1, degradado: 1 }) }), 'vermelha');
  // Cinza: o dia sem nenhuma checagem feita.
  assert.equal(corDoDia({ registro: undefined }), 'cinza');
  assert.equal(corDoDia({ registro: dia({ feitas: 0, ok: 0 }) }), 'cinza');
  // Vermelha e amarela vêm antes de cinza.
  assert.equal(corDoDia({ registro: dia({ feitas: 10, minutos_fora: 45 }) }), 'vermelha');
  assert.equal(corDoDia({ registro: dia({ feitas: 10, ok: 8, fora: 2, minutos_fora: 12 }) }), 'amarela');
  assert.equal(corDoDia({ registro: dia({ feitas: 10, ok: 10 }), temDegradado: true }), 'amarela');
  assert.equal(corDoDia({ registro: undefined, temDegradado: true }), 'amarela');
  assert.equal(corDoDia({ registro: dia({ feitas: 0, ok: 0, minutos_fora: 30 }) }), 'vermelha');
});

test('esperadas: 288 por dia; hoje, só as que já deviam ter acontecido', () => {
  const agora = '2026-11-23T21:00:00Z'; // 18:00 em Assunção
  assert.equal(esperadasNoDia('2026-11-22', agora), 288);
  assert.equal(esperadasNoDia('2026-11-23', agora), 216);
});

test('D21: o dia de hoje com 1 checagem ok sai verde; o dia sem checagem, cinza', () => {
  const agora = '2026-11-24T13:02:00Z';
  const dias = {};
  registrarChecagem(dias, 'app', 'ok', agora);
  const hoje = diaDeAssuncao(agora);
  assert.equal(corDoDia({ registro: dias.app[hoje] }), 'verde');
  assert.equal(corDoDia({ registro: dias.app[somarDias(hoje, -1)] }), 'cinza');
  // Uma leitura sem dado não conta como checagem feita.
  const soSemDado = {};
  registrarChecagem(soSemDado, 'app', 'sem_dado', agora);
  assert.equal(corDoDia({ registro: soSemDado.app[hoje] }), 'cinza');
});

test('D21: medindo desde: conta os dias com checagem feita; 6 medem, 7 dão o percentual', () => {
  const r = (feitas) => ({ feitas, ok: feitas, degradado: 0, fora: 0, minutos_fora: 0 });
  const porDia = {};
  for (let n = 0; n < 6; n += 1) porDia[somarDias('2026-11-24', -n)] = r(n === 5 ? 1 : 288);
  // Um dia mais velho com feitas 0 (só leituras sem dado) não conta nem vira o «desde».
  porDia['2026-11-10'] = r(0);
  assert.deepEqual(medindoDesde(porDia), { dias: 6, desde: '2026-11-19' });
  assert.ok(medindoDesde(porDia).dias < DIAS_PARA_PERCENTUAL, '6 dias: ainda medindo');
  porDia['2026-11-12'] = r(3);
  assert.deepEqual(medindoDesde(porDia), { dias: 7, desde: '2026-11-12' });
  assert.ok(medindoDesde(porDia).dias >= DIAS_PARA_PERCENTUAL, '7 dias: o percentual');
  assert.equal(DIAS_PARA_PERCENTUAL, 7);
  assert.deepEqual(medindoDesde({}), { dias: 0, desde: null });
  assert.deepEqual(medindoDesde(undefined), { dias: 0, desde: null });
});

test('minutos fora: só incidentes «fora» da linha, recortados no dia; aberto conta até agora', () => {
  const incidentes = [
    // 02:40Z a 03:20Z: 20 min no dia 23 (até 00:00 de Assunção) e 20 no dia 24.
    { tipo: 'fora', linhas: ['app'], inicio: '2026-11-24T02:40:00Z', fim: '2026-11-24T03:20:00Z' },
    // manual sobreposto: não conta duas vezes.
    { tipo: 'fora', linhas: ['app', 'login'], inicio: '2026-11-24T02:50:00Z', fim: '2026-11-24T02:55:00Z' },
    { tipo: 'degradado', linhas: ['app'], inicio: '2026-11-24T05:00:00Z', fim: '2026-11-24T09:00:00Z' },
    { tipo: 'fora', linhas: ['banco'], inicio: '2026-11-24T10:00:00Z', fim: null },
  ];
  const agora = '2026-11-24T10:35:00Z';
  assert.equal(minutosNoDia(incidentes, 'app', '2026-11-23', agora), 20);
  assert.equal(minutosNoDia(incidentes, 'app', '2026-11-24', agora), 20);
  assert.equal(minutosNoDia(incidentes, 'login', '2026-11-23', agora), 5);
  assert.equal(minutosNoDia(incidentes, 'banco', '2026-11-24', agora), 35);
  const dias = { app: { '2026-11-23': { feitas: 288, ok: 284, degradado: 0, fora: 4, minutos_fora: 0 } } };
  atualizarMinutosFora(dias, incidentes, agora);
  assert.equal(dias.app['2026-11-23'].minutos_fora, 20);
});

test('corte dos 90 dias: o mais velho sai', () => {
  const agora = '2026-11-23T21:00:00Z';
  const dias = { app: {} };
  for (let n = 0; n < 92; n += 1) dias.app[somarDias('2026-11-23', -n)] = { feitas: 1, ok: 1, degradado: 0, fora: 0, minutos_fora: 0 };
  cortarDias(dias, agora);
  const chaves = Object.keys(dias.app).sort();
  assert.equal(chaves.length, 90);
  assert.equal(chaves[0], '2026-08-26');
  assert.equal(chaves.at(-1), '2026-11-23');
});

test('corte de 1 ano pelo início; aberto nunca sai', () => {
  const agora = '2026-11-23T21:00:00Z';
  const lista = [
    { id: 'velho', inicio: '2025-11-23T20:59:00Z', fim: '2025-11-23T21:30:00Z' },
    { id: 'no-limite', inicio: '2025-11-23T21:00:00Z', fim: '2025-11-23T21:30:00Z' },
    { id: 'aberto-velho', inicio: '2025-01-01T00:00:00Z', fim: null },
  ];
  assert.deepEqual(
    cortarIncidentes(lista, agora).map((i) => i.id),
    ['no-limite', 'aberto-velho'],
  );
});

test('a página lista os de 90 dias mais os abertos, do mais novo ao mais velho', () => {
  const agora = '2026-11-23T21:00:00Z';
  const lista = [
    { id: 'a', inicio: '2026-08-01T00:00:00Z', fim: '2026-08-01T01:00:00Z' },
    { id: 'b', inicio: '2026-11-01T00:00:00Z', fim: '2026-11-01T01:00:00Z' },
    { id: 'c', inicio: '2026-07-01T00:00:00Z', fim: null },
    { id: 'd', inicio: '2026-11-20T00:00:00Z', fim: '2026-11-20T00:10:00Z' },
  ];
  assert.deepEqual(
    incidentesRecentes(lista, agora).map((i) => i.id),
    ['d', 'b', 'c'],
  );
});

test('duração: min, h e min, d e h; aberto conta até agora', () => {
  const i = (inicio, fim) => ({ inicio, fim });
  assert.deepEqual(partesDaDuracao(i('2026-11-23T10:00:00Z', '2026-11-23T10:59:00Z')), { forma: 'min', d: 0, h: 0, m: 59 });
  assert.deepEqual(partesDaDuracao(i('2026-11-23T10:00:00Z', '2026-11-23T12:05:00Z')), { forma: 'h_min', d: 0, h: 2, m: 5 });
  assert.deepEqual(partesDaDuracao(i('2026-11-21T10:00:00Z', '2026-11-23T13:00:00Z')), { forma: 'd_h', d: 2, h: 3, m: 0 });
  assert.equal(partesDaDuracao(i('2026-11-23T20:00:00Z', null), '2026-11-23T20:45:00Z').m, 45);
});
