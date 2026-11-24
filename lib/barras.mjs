// D19: as barras dos dias na página. Quantas aparecem, a data curta do nome de cada dia e a navegação por
// teclado (um único ponto de parada por linha: as setas mudam o dia).
import { preencher } from './texto.mjs';
import { DIAS_GUARDADOS } from './dias.mjs';

// Abaixo de 48rem a página mostra só os últimos 30 dias; o percentual continua o dos 90.
export const DIAS_NO_CELULAR = 30;

export function quantasBarras(estreita) {
  return estreita ? DIAS_NO_CELULAR : DIAS_GUARDADOS;
}

// O índice do dia depois da tecla, entre 0 e `total - 1`, ou null se a tecla não é das barras ou se `atual` não é
// um dia do grupo (o foco está fora dele). Esquerda e direita andam um dia (param na ponta); Home vai ao mais velho
// e End a hoje.
export function diaPelaTecla(atual, tecla, total) {
  if (!Number.isInteger(total) || total <= 0 || !Number.isInteger(atual) || atual < 0 || atual >= total) return null;
  switch (tecla) {
    case 'ArrowLeft':
      return Math.max(0, atual - 1);
    case 'ArrowRight':
      return Math.min(total - 1, atual + 1);
    case 'Home':
      return 0;
    case 'End':
      return total - 1;
    default:
      return null;
  }
}

// 'AAAA-MM-DD' -> '23 de nov.', com o modelo do catálogo ('{d} de {mes}') e os 12 meses separados por espaço.
export function diaCurto(dia, modelo, meses) {
  const [, m, d] = dia.split('-').map(Number);
  return preencher(modelo, { d, mes: meses.split(' ')[m - 1] ?? '' });
}
