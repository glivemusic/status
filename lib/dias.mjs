// D5: os dias, a disponibilidade e a cor da barra.
import { intervalos } from './incidentes.mjs';
import { diaDeAssuncao, emMs, fimDoDia, inicioDoDia, somarDias } from './tempo.mjs';

export const DIAS_GUARDADOS = 90;
export const INTERVALO_PADRAO_S = 5 * 60;
const MINUTO = 60_000;
const DIA_S = 86_400;

// D11: a linha com `intervalo_s` no config conta por fato distinto (a série, o dia e a cor seguem D11).
export function linhaPorFato(linha) {
  return Number.isFinite(linha?.intervalo_s) && linha.intervalo_s > 0;
}

export function intervaloDaLinha(linha) {
  return linhaPorFato(linha) ? linha.intervalo_s : INTERVALO_PADRAO_S;
}

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

// Uma a cada `intervalo_s` (5 min: 288 por dia; 2 h: 12, D11);
// no dia de hoje, as que já deviam ter acontecido até agora.
export function esperadasNoDia(dia, agora, intervaloS = INTERVALO_PADRAO_S) {
  const porDia = Math.floor(DIA_S / intervaloS);
  const hoje = diaDeAssuncao(agora);
  if (dia < hoje) return porDia;
  if (dia > hoje) return 0;
  const passadas = Math.floor((emMs(agora) - inicioDoDia(dia)) / (intervaloS * 1000));
  return Math.min(porDia, Math.max(0, passadas));
}

// (ok + degradado) / feitas, somado nos registros, com 2 casas (truncadas) e vírgula: '99,95 %'.
// Na linha por fato (D11), degradado não conta como no ar: ok / feitas.
// Sem nenhuma checagem: '—'.
export function disponibilidade(registros, { porFato = false } = {}) {
  let feitas = 0;
  let bons = 0;
  for (const r of registros) {
    if (!r) continue;
    feitas += r.feitas;
    bons += porFato ? r.ok : r.ok + r.degradado;
  }
  if (feitas === 0) return '—';
  const centesimos = Math.floor((bons * 10_000) / feitas);
  const inteiro = Math.floor(centesimos / 100);
  const casas = String(centesimos % 100).padStart(2, '0');
  return `${inteiro},${casas} %`;
}

// A cor do dia, nesta ordem: vermelha, amarela, cinza, verde.
// D21: cinza só no dia sem nenhuma checagem feita; com uma que seja, e sem incidente, verde (a regra dos 50 % saiu).
// Na linha por fato (D11) não há vermelha: amarela só com incidente degradado no dia.
export function corDoDia({ registro, temDegradado = false, porFato = false }) {
  const minutos = porFato ? 0 : (registro?.minutos_fora ?? 0);
  if (minutos >= 30) return 'vermelha';
  if (temDegradado || minutos > 0) return 'amarela';
  if ((registro?.feitas ?? 0) === 0) return 'cinza';
  return 'verde';
}

// D21: com menos de 7 dias medidos, a página mostra «—» e «medindo desde {data}» no lugar do percentual.
export const DIAS_PARA_PERCENTUAL = 7;

// Os dias de `porDia` ({ 'AAAA-MM-DD': registro }) com checagem feita. -> { dias, desde } (`desde`: o primeiro
// deles, ou null sem nenhum).
export function medindoDesde(porDia) {
  const medidos = Object.keys(porDia ?? {})
    .filter((dia) => (porDia[dia]?.feitas ?? 0) > 0)
    .sort();
  return { dias: medidos.length, desde: medidos[0] ?? null };
}
