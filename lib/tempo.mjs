// O dia e a hora de Assunção, pelo Intl (sem tabela de fuso).
// Todo instante entra como texto ISO ou como milissegundos.

const FUSO = 'America/Asuncion';

const formatador = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function emMs(instante) {
  return typeof instante === 'number' ? instante : Date.parse(instante);
}

function partes(instante) {
  const p = {};
  for (const { type, value } of formatador.formatToParts(new Date(emMs(instante)))) p[type] = value;
  return p;
}

// 'AAAA-MM-DD' do dia de Assunção.
export function diaDeAssuncao(instante) {
  const p = partes(instante);
  return `${p.year}-${p.month}-${p.day}`;
}

// 'HH:mm' de Assunção.
export function horaDeAssuncao(instante) {
  const p = partes(instante);
  return `${p.hour}:${p.minute}`;
}

// 'AAAA-MM-DD' -> 'dd/mm/aaaa'.
export function formatarDia(dia) {
  const [a, m, d] = dia.split('-');
  return `${d}/${m}/${a}`;
}

// 'dd/mm/aaaa' do dia de Assunção.
export function dataDeAssuncao(instante) {
  return formatarDia(diaDeAssuncao(instante));
}

export function somarDias(dia, n) {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

// Quanto a hora de Assunção está à frente do UTC, em ms, naquele instante.
function deslocamento(ms) {
  const p = partes(ms);
  const comoUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return comoUtc - Math.floor(ms / 1000) * 1000;
}

// O instante (ms UTC) da meia-noite de Assunção que abre o dia.
export function inicioDoDia(dia) {
  const [a, m, d] = dia.split('-').map(Number);
  const base = Date.UTC(a, m - 1, d);
  let t = base - deslocamento(base);
  t = base - deslocamento(t);
  return t;
}

export function fimDoDia(dia) {
  return inicioDoDia(somarDias(dia, 1));
}
