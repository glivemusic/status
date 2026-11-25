// O que vai ao site: só o que a página usa (decisão da sessão principal, item 1).
import { entradasDeLinhas, linhaPorFato } from './dias.mjs';

const CAMPOS_DO_DIA = ['feitas', 'ok', 'degradado', 'fora', 'minutos_fora'];

// Linha pendente só aparece com dados de exemplo.
export function linhasVisiveis(config, exemplo) {
  return config.linhas.filter((l) => exemplo || !l.pendente);
}

// D17: com dados reais, a linha `em_breve` vai só com o nome e a marca, sem estado nem dias (o que o ramo
// ainda tiver dela é ignorado). Com os dados de exemplo ela vai como as outras, para reservar o lugar.
export function linhaEmBreve(linha, exemplo) {
  return !exemplo && linha.em_breve === true;
}

export function visaoDoEstado(config, estado) {
  const exemplo = estado?.exemplo === true;
  const visao = {};
  if (exemplo) {
    visao.exemplo = true;
    visao.agora = estado.agora;
  }
  visao.verificado_em = estado?.verificado_em ?? null;
  visao.linhas = linhasVisiveis(config, exemplo).map((l) => {
    const nome = { 'pt-BR': l.nome['pt-BR'], 'es-PY': l.nome['es-PY'] };
    if (linhaEmBreve(l, exemplo)) return { id: l.id, nome, em_breve: true };
    const linha = {
      id: l.id,
      nome,
      estado: estado?.linhas?.[l.id]?.estado ?? 'sem_dado',
    };
    // D11: a página precisa do intervalo (previstos por dia) e do `verificado_em` do último fato.
    if (linhaPorFato(l)) {
      linha.intervalo_s = l.intervalo_s;
      linha.verificado_em = estado?.linhas?.[l.id]?.verificado_em ?? null;
    }
    // D24: a linha fora do estado geral leva a marca (só o booleano, só quando o config a tem).
    if (l.fora_do_geral === true) linha.fora_do_geral = true;
    return linha;
  });
  return visao;
}

export function visaoDosDias(config, dias, exemplo) {
  const ids = new Set(
    linhasVisiveis(config, exemplo)
      .filter((l) => !linhaEmBreve(l, exemplo))
      .map((l) => l.id),
  );
  const visao = exemplo ? { exemplo: true } : {};
  for (const [linha, porDia] of entradasDeLinhas(dias ?? {})) {
    if (!ids.has(linha)) continue;
    visao[linha] = {};
    for (const dia of Object.keys(porDia).sort()) {
      const r = porDia[dia];
      visao[linha][dia] = Object.fromEntries(CAMPOS_DO_DIA.map((c) => [c, Number(r[c]) || 0]));
    }
  }
  return visao;
}

function par(valor) {
  return { 'pt-BR': String(valor?.['pt-BR'] ?? ''), 'es-PY': String(valor?.['es-PY'] ?? '') };
}

export function visaoDosIncidentes(incidentes, exemplo) {
  const lista = (incidentes ?? []).map((i) => ({
    id: i.id,
    linhas: [...i.linhas],
    tipo: i.tipo,
    inicio: i.inicio,
    fim: i.fim ?? null,
    origem: i.origem,
    titulo: par(i.titulo),
    atualizacoes: i.atualizacoes.map((a) => ({ em: a.em, estado: a.estado, texto: par(a.texto) })),
  }));
  return exemplo ? { exemplo: true, incidentes: lista } : { incidentes: lista };
}
