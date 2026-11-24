// D8: o incidente à mão (abrir, atualizar, resolver). Erro de entrada lança ErroDeEntrada.
import { linhaPorFato } from './dias.mjs';
import { idDoIncidente } from './incidentes.mjs';
import { termoProibido } from './vazamento.mjs';

export const TITULO_MAX = 120;
export const TEXTO_MAX = 1000;
const ACOES = ['abrir', 'atualizar', 'resolver'];
const TIPOS = ['fora', 'degradado'];
const ESTADOS_ABERTOS = ['investigando', 'identificado', 'monitorando'];

// Controle (C0 e DEL), direção (U+061C, U+202A–U+202E, U+2066–U+2069), largura zero e invisíveis
// (U+00AD, U+200B–U+200F, U+2060, U+FEFF), separadores U+2028 e U+2029 e as etiquetas U+E0000–U+E007F.
// Com a flag `u` a comparação é por code point (a faixa das etiquetas fica fora do BMP).
// Nos textos só a quebra de linha (\n) é aceita; nos títulos, nenhum.
const PROIBIDOS_NO_TITULO =
  /[\u0000-\u001F\u007F\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}]/u;
const PROIBIDOS_NO_TEXTO =
  /[\u0000-\u0009\u000B-\u001F\u007F\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}]/u;

export class ErroDeEntrada extends Error {}

function limpo(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

function falhar(mensagem) {
  throw new ErroDeEntrada(mensagem);
}

function codigo(caractere) {
  return `U+${caractere.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
}

// As mensagens nunca ecoam o texto livre: só o nome do campo, o código do caractere ou o termo da lista.
function conferirTexto(nome, valor, maximo, proibidos) {
  if (!valor) falhar(`Falta o campo ${nome}.`);
  if ([...valor].length > maximo) falhar(`O campo ${nome} passa de ${maximo} caracteres.`);
  if (/[<>]/.test(valor)) falhar(`O campo ${nome} não pode ter HTML (os sinais < e > são recusados).`);
  const invisivel = valor.match(proibidos);
  if (invisivel) falhar(`O campo ${nome} tem um caractere de controle ou invisível (${codigo(invisivel[0])}).`);
  const termo = termoProibido(valor);
  if (termo) {
    falhar(`O campo ${nome} contém ${JSON.stringify(termo)}: endereço ou nome técnico não vai à página pública.`);
  }
  return valor;
}

function conferirPar(entrada, prefixo, maximo) {
  const proibidos = prefixo === 'titulo' ? PROIBIDOS_NO_TITULO : PROIBIDOS_NO_TEXTO;
  return {
    'pt-BR': conferirTexto(`${prefixo}_pt`, limpo(entrada[`${prefixo}_pt`]), maximo, proibidos),
    'es-PY': conferirTexto(`${prefixo}_es`, limpo(entrada[`${prefixo}_es`]), maximo, proibidos),
  };
}

function conferirEstadoAberto(estado) {
  if (estado === 'resolvido') falhar('Para resolver, use a ação «resolver».');
  if (!ESTADOS_ABERTOS.includes(estado)) {
    falhar(`Estado inválido: use ${ESTADOS_ABERTOS.join(', ')}.`);
  }
  return estado;
}

function conferirLinhas(texto, config) {
  const validas = config.linhas.filter((l) => !l.pendente).map((l) => l.id);
  const ids = texto
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) falhar(`Falta o campo linhas (ids separados por vírgula: ${validas.join(', ')}).`);
  for (const id of ids) {
    if (!validas.includes(id)) falhar(`Linha desconhecida: ${JSON.stringify(id)}. Use ${validas.join(', ')}.`);
  }
  if (new Set(ids).size !== ids.length) falhar('O campo linhas repete uma linha.');
  return ids;
}

function acharAberto(incidentes, id, config) {
  if (!id) falhar('Falta o campo id.');
  const sufixos = ['manual', ...config.linhas.map((l) => l.id)].join('|');
  if (!new RegExp(`^\\d{8}-\\d{4}-(${sufixos})$`).test(id)) {
    falhar('O id não está no formato AAAAMMDD-HHMM-<linha ou manual>.');
  }
  const incidente = incidentes.find((i) => i.id === id);
  if (!incidente) falhar(`Não existe incidente com o id ${id}.`);
  if (incidente.fim !== null) falhar(`O incidente ${id} já está resolvido.`);
  return incidente;
}

// `entrada`: { acao, id, linhas, tipo, estado, titulo_pt, titulo_es, texto_pt, texto_es } (textos).
// `instante`: a hora (ISO). -> a nova lista de incidentes.
export function aplicarAcaoManual({ incidentes, entrada, config, instante }) {
  const lista = structuredClone(incidentes);
  const acao = limpo(entrada.acao);
  if (!ACOES.includes(acao)) falhar(`Ação inválida: use ${ACOES.join(', ')}.`);

  if (acao === 'abrir') {
    if (limpo(entrada.id)) falhar('Ao abrir, o campo id fica vazio: ele é gerado.');
    const linhas = conferirLinhas(limpo(entrada.linhas), config);
    const tipo = limpo(entrada.tipo);
    if (!TIPOS.includes(tipo)) falhar(`Tipo inválido: use ${TIPOS.join(' ou ')}.`);
    // D11: o máximo da linha por fato (o satélite) é degradado.
    const porFato = linhas.filter((id) => linhaPorFato(config.linhas.find((l) => l.id === id)));
    if (tipo === 'fora' && porFato.length > 0) {
      falhar(`A linha ${porFato.join(', ')} não fica fora do ar: use o tipo degradado (ou abra outro incidente para ela).`);
    }
    const estado = conferirEstadoAberto(limpo(entrada.estado));
    const titulo = conferirPar(entrada, 'titulo', TITULO_MAX);
    const texto = conferirPar(entrada, 'texto', TEXTO_MAX);
    const id = idDoIncidente(instante, 'manual');
    if (lista.some((i) => i.id === id)) {
      falhar(`Já existe um incidente com o id ${id}. Espere um minuto e tente de novo.`);
    }
    lista.push({
      id,
      linhas,
      tipo,
      inicio: instante,
      fim: null,
      origem: 'manual',
      titulo,
      atualizacoes: [{ em: instante, estado, texto }],
    });
    return lista;
  }

  const incidente = acharAberto(lista, limpo(entrada.id), config);

  if (acao === 'atualizar') {
    const estado = conferirEstadoAberto(limpo(entrada.estado));
    const temTitulo = limpo(entrada.titulo_pt) || limpo(entrada.titulo_es);
    const titulo = temTitulo ? conferirPar(entrada, 'titulo', TITULO_MAX) : null;
    const texto = conferirPar(entrada, 'texto', TEXTO_MAX);
    if (titulo) incidente.titulo = titulo;
    incidente.atualizacoes.push({ em: instante, estado, texto });
    return lista;
  }

  // resolver
  const texto = conferirPar(entrada, 'texto', TEXTO_MAX);
  incidente.fim = instante;
  incidente.atualizacoes.push({ em: instante, estado: 'resolvido', texto });
  return lista;
}
