// Os incidentes: o automático (D4), o corte de 1 ano (D5) e o que a página mostra.
import { emCadaIdioma } from './texto.mjs';
import { emMs, horaDeAssuncao } from './tempo.mjs';

const DIA_MS = 86_400_000;
const MINUTO = 60_000;
export const ANO_MS = 365 * DIA_MS;
export const RECENTES_MS = 90 * DIA_MS;

// 'AAAAMMDD-HHMM-<sufixo>', em UTC.
export function idDoIncidente(instante, sufixo) {
  const iso = new Date(emMs(instante)).toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}-${sufixo}`;
}

// `nome` é o nome da linha nos dois idiomas; `textos` é o catálogo.
export function novoIncidenteAutomatico({ linha, nome, tipo, inicio, instante, textos }) {
  const chave = tipo === 'fora' ? 'incidente.auto_titulo_fora' : 'incidente.auto_titulo_degradado';
  return {
    id: idDoIncidente(inicio, linha),
    linhas: [linha],
    tipo,
    inicio,
    fim: null,
    origem: 'automatico',
    titulo: emCadaIdioma(textos, chave, (idioma) => ({ linha: nome[idioma] })),
    atualizacoes: [
      {
        em: instante,
        estado: 'investigando',
        texto: emCadaIdioma(textos, 'incidente.automatico', { hora: horaDeAssuncao(instante) }),
      },
    ],
  };
}

export function fecharAutomatico(incidente, fim, instante, textos) {
  incidente.fim = fim;
  incidente.atualizacoes.push({
    em: instante,
    estado: 'resolvido',
    texto: emCadaIdioma(textos, 'incidente.auto_resolvido', { hora: horaDeAssuncao(fim) }),
  });
  return incidente;
}

// Guarda 1 ano pelo início; aberto nunca sai.
export function cortarIncidentes(incidentes, agora) {
  const limite = emMs(agora) - ANO_MS;
  return incidentes.filter((i) => i.fim === null || emMs(i.inicio) >= limite);
}

// O que a página lista: início nos últimos 90 dias, mais os abertos; do mais novo ao mais velho.
export function incidentesRecentes(incidentes, agora) {
  const limite = emMs(agora) - RECENTES_MS;
  return incidentes
    .filter((i) => i.fim === null || emMs(i.inicio) >= limite)
    .sort((a, b) => emMs(b.inicio) - emMs(a.inicio));
}

// O estado da última atualização.
export function estadoAtual(incidente) {
  const ultima = incidente.atualizacoes[incidente.atualizacoes.length - 1];
  return ultima ? ultima.estado : 'investigando';
}

// A duração (até agora, se aberto), em partes para o catálogo:
// { forma: 'min' | 'h_min' | 'd_h', d, h, m }.
export function partesDaDuracao(incidente, agora) {
  const fim = incidente.fim === null ? emMs(agora) : emMs(incidente.fim);
  const total = Math.max(0, Math.floor((fim - emMs(incidente.inicio)) / MINUTO));
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  if (total < 60) return { forma: 'min', d: 0, h: 0, m: total };
  if (total < 1440) return { forma: 'h_min', d: 0, h, m };
  return { forma: 'd_h', d, h, m };
}

// Os pedaços [início, fim) em ms dos incidentes de um tipo numa linha (aberto vai até `agora`).
export function intervalos(incidentes, linha, tipo, agora) {
  return incidentes
    .filter((i) => i.tipo === tipo && i.linhas.includes(linha))
    .map((i) => [emMs(i.inicio), i.fim === null ? emMs(agora) : emMs(i.fim)])
    .filter(([a, b]) => b > a);
}
