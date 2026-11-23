// D5: dias de Assunção, disponibilidade, cor da barra e cortes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  atualizarMinutosFora,
  corDoDia,
  cortarDias,
  disponibilidade,
  esperadasNoDia,
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

test('as quatro cores, com as bordas de 30 min e de 50 %', () => {
  const dia = (extra) => ({ feitas: 288, ok: 288, degradado: 0, fora: 0, minutos_fora: 0, ...extra });
  assert.equal(corDoDia({ registro: dia({ minutos_fora: 30 }) }), 'vermelha');
  assert.equal(corDoDia({ registro: dia({ minutos_fora: 29 }) }), 'amarela');
  assert.equal(corDoDia({ registro: dia({ minutos_fora: 1 }) }), 'amarela');
  assert.equal(corDoDia({ registro: dia(), temDegradado: true }), 'amarela');
  assert.equal(corDoDia({ registro: dia({ feitas: 143, ok: 143 }), esperadas: 288 }), 'cinza');
  assert.equal(corDoDia({ registro: dia({ feitas: 144, ok: 144 }), esperadas: 288 }), 'verde');
  assert.equal(corDoDia({ registro: undefined }), 'cinza');
  assert.equal(corDoDia({ registro: dia() }), 'verde');
  // Vermelha e amarela vêm antes de cinza.
  assert.equal(corDoDia({ registro: dia({ feitas: 10, minutos_fora: 45 }) }), 'vermelha');
  assert.equal(corDoDia({ registro: dia({ feitas: 10, ok: 8, fora: 2, minutos_fora: 12 }), esperadas: 288 }), 'amarela');
  assert.equal(corDoDia({ registro: dia({ feitas: 10, ok: 10 }), temDegradado: true, esperadas: 288 }), 'amarela');
  assert.equal(corDoDia({ registro: undefined, temDegradado: true, esperadas: 288 }), 'amarela');
});

test('esperadas: 288 por dia; hoje, só as que já deviam ter acontecido', () => {
  const agora = '2026-11-23T21:00:00Z'; // 18:00 em Assunção
  assert.equal(esperadasNoDia('2026-11-22', agora), 288);
  assert.equal(esperadasNoDia('2026-11-23', agora), 216);
  // Hoje, com 110 checagens de 216 esperadas, ainda é verde.
  assert.equal(corDoDia({ registro: { feitas: 110, ok: 110, degradado: 0, fora: 0, minutos_fora: 0 }, esperadas: 216 }), 'verde');
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
