// D4: o estado de uma linha e quando o incidente automático abre, muda de tipo ou fecha.

export const LIMITE_FORA = 2;
export const LIMITE_DEGRADADO = 3;
export const LIMITE_BOAS = 2;

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
export function zerarSerie(linha) {
  return { ...linhaVazia(), estado: linha.estado ?? 'sem_dado' };
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
