// D4: o estado de uma linha e quando o incidente automático abre, muda de tipo ou fecha.
// D11: a linha por fato (o satélite) tem a sua própria série, em `aplicarFato`.
import { emMs } from './tempo.mjs';

export const LIMITE_FORA = 2;
export const LIMITE_DEGRADADO = 3;
export const LIMITE_BOAS = 2;
export const LIMITE_FATOS_DEGRADADOS = 2;
export const LIMITE_FATOS_BONS = 1;

export function linhaVazia() {
  return {
    estado: 'sem_dado',
    fora_seguidas: 0,
    degradadas_seguidas: 0,
    boas_seguidas: 0,
    serie_inicio: null,
    incidente: null,
  };
}

// Zera a série e solta o incidente (usado quando o automático foi resolvido à mão).
// O último fato contado (D11) fica: a mesma leitura não conta de novo.
export function zerarSerie(linha) {
  const zerada = { ...linhaVazia(), estado: linha.estado ?? 'sem_dado' };
  if (Object.hasOwn(linha, 'verificado_em')) zerada.verificado_em = linha.verificado_em;
  if (Object.hasOwn(linha, 'estado_do_fato')) zerada.estado_do_fato = linha.estado_do_fato;
  return zerada;
}

// O resultado do último fato contado. Linha gravada antes de `estado_do_fato` existir: o estado guardado, se for
// de um fato (ok ou degradado); senão, o da leitura.
function estadoDoUltimoFato(linha, resultado) {
  for (const v of [linha.estado_do_fato, linha.estado]) if (v === 'ok' || v === 'degradado') return v;
  return resultado;
}

// D11: aplica a leitura de uma linha por fato. `verificadoEm` é o do fato (ISO), ou null com `sem_dado`.
// D15: só conta o fato com `verificado_em` (como instante) maior que o maior já contado (guardado em
// `linha.verificado_em`, com o resultado dele em `linha.estado_do_fato`). Na leitura válida de um fato igual ou mais
// velho nada conta (contagem, dia, incidente, `verificado_em`): o estado da linha volta a ser o do último fato
// contado. O `sem_dado` também não conta (a linha fica `sem_dado`).
// -> { linha, evento, contou }, com evento null ou
//    { acao: 'abrir', tipo: 'degradado', inicio } | { acao: 'fechar', fim }. Nunca abre `fora`.
export function aplicarFato(anterior, resultado, verificadoEm) {
  const base = { ...linhaVazia(), verificado_em: null, ...anterior };
  const valido = resultado === 'ok' || resultado === 'degradado';
  const novo = verificadoEm ? emMs(verificadoEm) : NaN;
  if (!valido || !Number.isFinite(novo)) return { linha: { ...base, estado: resultado }, evento: null, contou: false };
  const maior = base.verificado_em ? emMs(base.verificado_em) : NaN;
  if (Number.isFinite(maior) && novo <= maior) {
    return { linha: { ...base, estado: estadoDoUltimoFato(base, resultado) }, evento: null, contou: false };
  }

  const linha = { ...base, estado: resultado, estado_do_fato: resultado };
  const aberto = linha.incidente != null;

  linha.verificado_em = verificadoEm;
  linha.fora_seguidas = 0;
  if (resultado === 'ok') {
    if (linha.boas_seguidas === 0) linha.serie_inicio = verificadoEm;
    linha.boas_seguidas += 1;
    linha.degradadas_seguidas = 0;
    if (aberto && linha.boas_seguidas >= LIMITE_FATOS_BONS) {
      return { linha, evento: { acao: 'fechar', fim: linha.serie_inicio }, contou: true };
    }
    return { linha, evento: null, contou: true };
  }

  if (linha.degradadas_seguidas === 0) linha.serie_inicio = verificadoEm;
  linha.boas_seguidas = 0;
  linha.degradadas_seguidas += 1;
  if (!aberto && linha.degradadas_seguidas >= LIMITE_FATOS_DEGRADADOS) {
    return { linha, evento: { acao: 'abrir', tipo: 'degradado', inicio: linha.serie_inicio }, contou: true };
  }
  return { linha, evento: null, contou: true };
}

// Aplica o resultado de uma checagem à linha.
// `tipoAberto` é o tipo do incidente automático aberto da linha ('fora' | 'degradado'), ou null.
// -> { linha, evento }, com evento null ou:
//    { acao: 'abrir', tipo, inicio } | { acao: 'mudar_tipo', tipo: 'fora' } | { acao: 'fechar', fim }
// Quem chama cria/fecha o incidente e põe o id em `linha.incidente`.
export function aplicarChecagem(anterior, resultado, instante, tipoAberto = null) {
  const linha = { ...linhaVazia(), ...anterior, estado: resultado };
  const aberto = linha.incidente != null;

  if (resultado === 'sem_dado') return { linha, evento: null };

  if (resultado === 'ok') {
    if (linha.boas_seguidas === 0) linha.serie_inicio = instante;
    linha.boas_seguidas += 1;
    linha.fora_seguidas = 0;
    linha.degradadas_seguidas = 0;
    if (aberto && linha.boas_seguidas >= LIMITE_BOAS) {
      return { linha, evento: { acao: 'fechar', fim: linha.serie_inicio } };
    }
    return { linha, evento: null };
  }

  // fora ou degradado
  if (linha.fora_seguidas + linha.degradadas_seguidas === 0) linha.serie_inicio = instante;
  linha.boas_seguidas = 0;
  if (resultado === 'fora') linha.fora_seguidas += 1;
  else linha.degradadas_seguidas += 1;

  if (!aberto) {
    if (linha.degradadas_seguidas === 0 && linha.fora_seguidas >= LIMITE_FORA) {
      return { linha, evento: { acao: 'abrir', tipo: 'fora', inicio: linha.serie_inicio } };
    }
    if (
      linha.degradadas_seguidas > 0 &&
      linha.fora_seguidas + linha.degradadas_seguidas >= LIMITE_DEGRADADO
    ) {
      // A regra de virar «fora» (2 fora na série) já vale na abertura.
      const tipo = linha.fora_seguidas >= LIMITE_FORA ? 'fora' : 'degradado';
      return { linha, evento: { acao: 'abrir', tipo, inicio: linha.serie_inicio } };
    }
    return { linha, evento: null };
  }

  if (tipoAberto === 'degradado' && resultado === 'fora' && linha.fora_seguidas >= LIMITE_FORA) {
    return { linha, evento: { acao: 'mudar_tipo', tipo: 'fora' } };
  }
  return { linha, evento: null };
}
