// D5: os dias, a disponibilidade e a cor da barra.
import { intervalos } from './incidentes.mjs';
import { diaDeAssuncao, emMs, fimDoDia, inicioDoDia, somarDias } from './tempo.mjs';

export const DIAS_GUARDADOS = 90;
export const ESPERADAS_POR_DIA = 288;
const INTERVALO_MS = 5 * 60_000;
const MINUTO = 60_000;

export function novoDia() {
  return { feitas: 0, ok: 0, degradado: 0, fora: 0, minutos_fora: 0 };
}

// Soma uma checagem no dia de Assunção. `sem_dado` não entra em `feitas`.
export function registrarChecagem(dias, linha, resultado, instante) {
  const dia = diaDeAssuncao(instante);
  const porLinha = (dias[linha] ??= {});
  const registro = (porLinha[dia] ??= novoDia());
  if (resultado === 'ok' || resultado === 'degradado' || resultado === 'fora') {
    registro.feitas += 1;
    registro[resultado] += 1;
  }
  return dias;
}

// Minutos (inteiros) cobertos por incidentes do tipo na linha, dentro do dia de Assunção.
// Pedaços que se sobrepõem contam uma vez só.
export function minutosNoDia(incidentes, linha, dia, agora, tipo = 'fora') {
  const de = inicioDoDia(dia);
  const ate = fimDoDia(dia);
  const pedacos = intervalos(incidentes, linha, tipo, agora)
    .map(([a, b]) => [Math.max(a, de), Math.min(b, ate)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let fimAtual = -Infinity;
  for (const [a, b] of pedacos) {
    const inicio = Math.max(a, fimAtual);
    if (b > inicio) total += b - inicio;
    fimAtual = Math.max(fimAtual, b);
  }
  return Math.floor(total / MINUTO);
}

export function temIncidenteDegradadoNoDia(incidentes, linha, dia, agora) {
  const de = inicioDoDia(dia);
  const ate = fimDoDia(dia);
  return intervalos(incidentes, linha, 'degradado', agora).some(([a, b]) => a < ate && b > de);
}

// Recalcula `minutos_fora` de todos os dias guardados.
export function atualizarMinutosFora(dias, incidentes, agora) {
  for (const [linha, porDia] of entradasDeLinhas(dias)) {
    for (const [dia, registro] of Object.entries(porDia)) {
      registro.minutos_fora = minutosNoDia(incidentes, linha, dia, agora, 'fora');
    }
  }
  return dias;
}

// Ficam os 90 dias que terminam no dia de Assunção de `agora`; o mais velho sai.
export function cortarDias(dias, agora) {
  const primeiro = somarDias(diaDeAssuncao(agora), -(DIAS_GUARDADOS - 1));
  for (const [, porDia] of entradasDeLinhas(dias)) {
    for (const dia of Object.keys(porDia)) if (dia < primeiro) delete porDia[dia];
  }
  return dias;
}

// As linhas de `dias.json` (o campo `exemplo`, quando houver, não é linha).
export function entradasDeLinhas(dias) {
  return Object.entries(dias).filter(([, v]) => v !== null && typeof v === 'object');
}

// 288 por dia; no dia de hoje, as que já deviam ter acontecido até agora.
export function esperadasNoDia(dia, agora) {
  const hoje = diaDeAssuncao(agora);
  if (dia < hoje) return ESPERADAS_POR_DIA;
  if (dia > hoje) return 0;
  const passadas = Math.floor((emMs(agora) - inicioDoDia(dia)) / INTERVALO_MS);
  return Math.min(ESPERADAS_POR_DIA, Math.max(0, passadas));
}

// (ok + degradado) / feitas, somado nos registros, com 2 casas (truncadas) e vírgula: '99,95 %'.
// Sem nenhuma checagem: '—'.
export function disponibilidade(registros) {
  let feitas = 0;
  let bons = 0;
  for (const r of registros) {
    if (!r) continue;
    feitas += r.feitas;
    bons += r.ok + r.degradado;
  }
  if (feitas === 0) return '—';
  const centesimos = Math.floor((bons * 10_000) / feitas);
  const inteiro = Math.floor(centesimos / 100);
  const casas = String(centesimos % 100).padStart(2, '0');
  return `${inteiro},${casas} %`;
}

// A cor do dia, nesta ordem: vermelha, amarela, cinza, verde.
export function corDoDia({ registro, temDegradado = false, esperadas = ESPERADAS_POR_DIA }) {
  const minutos = registro?.minutos_fora ?? 0;
  if (minutos >= 30) return 'vermelha';
  if (temDegradado || minutos > 0) return 'amarela';
  const feitas = registro?.feitas ?? 0;
  if (feitas === 0 || feitas < esperadas / 2) return 'cinza';
  return 'verde';
}
