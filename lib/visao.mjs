// O que vai ao site: só o que a página usa (decisão da sessão principal, item 1).
import { entradasDeLinhas } from './dias.mjs';

const CAMPOS_DO_DIA = ['feitas', 'ok', 'degradado', 'fora', 'minutos_fora'];

// Linha pendente só aparece com dados de exemplo.
export function linhasVisiveis(config, exemplo) {
  return config.linhas.filter((l) => exemplo || !l.pendente);
}

export function visaoDoEstado(config, estado) {
  const exemplo = estado?.exemplo === true;
  const visao = {};
  if (exemplo) {
    visao.exemplo = true;
    visao.agora = estado.agora;
  }
  visao.verificado_em = estado?.verificado_em ?? null;
  visao.linhas = linhasVisiveis(config, exemplo).map((l) => ({
    id: l.id,
    nome: { 'pt-BR': l.nome['pt-BR'], 'es-PY': l.nome['es-PY'] },
    estado: estado?.linhas?.[l.id]?.estado ?? 'sem_dado',
  }));
  return visao;
}

export function visaoDosDias(config, dias, exemplo) {
  const ids = new Set(linhasVisiveis(config, exemplo).map((l) => l.id));
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
