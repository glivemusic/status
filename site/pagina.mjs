// A página de status. Texto vindo dos JSON entra só por textContent ou atributo.
import { TEXTOS } from './textos.mjs';
import { preencher } from './lib/texto.mjs';
import {
  dataDeAssuncao,
  diaDeAssuncao,
  formatarDia,
  horaDeAssuncao,
  emMs,
  minutosDesde,
  somarDias,
} from './lib/tempo.mjs';
import {
  DIAS_GUARDADOS,
  DIAS_PARA_PERCENTUAL,
  corDoDia,
  disponibilidade,
  linhaPorFato,
  medindoDesde,
  temIncidenteDegradadoNoDia,
} from './lib/dias.mjs';
import { estadoAtual, incidentesRecentes, partesDaDuracao } from './lib/incidentes.mjs';
import { estadoGeral, estadosDoGeral } from './lib/geral.mjs';
import { diaCurto, diaPelaTecla, quantasBarras } from './lib/barras.mjs';

const IDIOMAS = ['pt-BR', 'es-PY'];
const $ = (id) => document.getElementById(id);
// D19: abaixo de 48rem, 30 barras (o mesmo limite do CSS).
const ESTREITA = typeof matchMedia === 'function' ? matchMedia('(max-width: 47.99rem)') : null;

let idioma = idiomaInicial();
let dados = { estado: { verificado_em: null, linhas: [] }, dias: {}, incidentes: [] };
// Quem fecha cada dica aberta (Esc em qualquer lugar da página).
let fechadores = [];

function idiomaInicial() {
  const pedido = new URLSearchParams(location.search).get('lang');
  if (IDIOMAS.includes(pedido)) return pedido;
  return (navigator.language || '').toLowerCase().startsWith('es') ? 'es-PY' : 'pt-BR';
}

function t(chave, valores) {
  return preencher(TEXTOS[idioma][chave] ?? '', valores);
}

function el(tag, classe, texto) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

async function carregar(nome) {
  const r = await fetch(`dados/${nome}.json`, { cache: 'no-store' });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

function agora() {
  return dados.estado.exemplo === true && dados.estado.agora ? emMs(dados.estado.agora) : Date.now();
}

function formatarDuracao(incidente, instante) {
  const p = partesDaDuracao(incidente, instante);
  return t(`duracao.${p.forma}`, p);
}

function desenharTopo() {
  document.documentElement.lang = idioma;
  document.title = `${t('titulo')} · ${t('marca')}`;
  $('marca').textContent = t('marca');
  $('titulo').textContent = t('titulo');
  // D19: o seletor do login, PT-BR e ES-PY, com a opção ativa em aria-pressed.
  // O rótulo visível vai em maiúsculas pelo CSS (e fica fora da árvore); o nome do grupo vem do catálogo, sem
  // caixa alta, para o leitor de tela não ler «IDIOMA».
  $('idioma-rotulo').textContent = t('idioma.rotulo');
  $('idioma').setAttribute('aria-label', t('idioma.rotulo'));
  for (const [id, codigo, chave] of [
    ['idioma-pt', 'pt-BR', 'idioma.pt'],
    ['idioma-es', 'es-PY', 'idioma.es'],
  ]) {
    const botao = $(id);
    botao.textContent = t(chave);
    botao.setAttribute('aria-pressed', String(codigo === idioma));
  }
  $('idioma').hidden = false;

  const aviso = $('aviso');
  aviso.hidden = dados.estado.exemplo !== true;
  $('aviso-texto').textContent = aviso.hidden ? '' : t('exemplo.aviso');
}

function desenharGeral(instante) {
  const estados = estadosDoGeral(dados.estado.linhas);
  const geral = estadoGeral(estados, dados.estado.verificado_em, instante);
  const faixa = $('geral');
  // A classe escolhe a cor e o ícone (os quatro estão no HTML).
  faixa.className = `geral geral-${geral}`;
  $('geral-texto').textContent = t(`geral.${geral}`);
  faixa.hidden = false;
}

// D19: `quantas` barras (90, ou 30 abaixo de 48rem); o percentual é sempre o dos 90 dias.
// D21: com menos de 7 dias medidos nos 90, «—» e «medindo desde {data}» (`medindo`, a data; null com 7 ou mais,
// e também sem nenhum dia medido, que fica com «—» como antes).
function desenharBarras(linha, instante, dica, quantas) {
  const hoje = diaDeAssuncao(instante);
  const porDia = dados.dias[linha.id] ?? {};
  // D11: a linha por fato tem a sua disponibilidade e a sua cor.
  const porFato = linhaPorFato(linha);
  const naJanela = {};
  for (let n = DIAS_GUARDADOS - 1; n >= 0; n -= 1) {
    const dia = somarDias(hoje, -n);
    if (porDia[dia]) naJanela[dia] = porDia[dia];
  }
  const medido = medindoDesde(naJanela);
  const medindo = medido.dias > 0 && medido.dias < DIAS_PARA_PERCENTUAL ? formatarDia(medido.desde) : null;
  const pct = medido.dias < DIAS_PARA_PERCENTUAL ? '—' : disponibilidade(Object.values(naJanela), { porFato });

  const barras = el('div', 'barras');
  barras.setAttribute('role', 'group');
  barras.setAttribute(
    'aria-label',
    medindo ? t('barras.resumo_medindo', { data: medindo }) : t('barras.resumo', { pct }),
  );
  const botoes = [];
  for (let n = quantas - 1; n >= 0; n -= 1) {
    const dia = somarDias(hoje, -n);
    const registro = porDia[dia];
    const cor = corDoDia({
      registro,
      temDegradado: temIncidenteDegradadoNoDia(dados.incidentes, linha.id, dia, instante),
      porFato,
    });
    const data = diaCurto(dia, t('barra.data'), t('meses'));
    const comDado = registro && registro.feitas > 0;
    const valores = comDado
      ? { dia: data, pct: disponibilidade([registro], { porFato }), minutos: registro.minutos_fora }
      : { dia: data };
    const botao = el('button', `barra barra-${cor}`);
    botao.type = 'button';
    // Um único ponto de parada por linha: hoje, até as setas mudarem o dia.
    botao.tabIndex = n === 0 ? 0 : -1;
    botao.setAttribute('aria-label', comDado ? t('barra.nome', valores) : t('barra.sem_dado', valores));
    botao.dataset.dica = comDado ? t('barra.dica', valores) : t('barra.sem_dado', valores);
    botoes.push(botao);
    barras.append(botao);
  }

  // A dica: abre ao passar o mouse, ao tocar e ao focar; fecha com Esc, ao sair o mouse (sem foco) e ao sair o foco.
  let mouseDentro = false;
  function mostrar(i) {
    botoes.forEach((b, j) => b.classList.toggle('barra-escolhida', j === i));
    dica.textContent = botoes[i].dataset.dica;
    dica.hidden = false;
  }
  function fechar() {
    for (const b of botoes) b.classList.toggle('barra-escolhida', false);
    dica.hidden = true;
  }
  function escolher(i) {
    botoes.forEach((b, j) => {
      b.tabIndex = j === i ? 0 : -1;
    });
  }
  fechadores.push(fechar);
  barras.addEventListener('mouseover', (evento) => {
    const i = botoes.indexOf(evento.target);
    mouseDentro = true;
    if (i >= 0) mostrar(i);
  });
  barras.addEventListener('mouseleave', () => {
    mouseDentro = false;
    const foco = botoes.indexOf(document.activeElement);
    if (foco >= 0) mostrar(foco);
    else fechar();
  });
  barras.addEventListener('click', (evento) => {
    const i = botoes.indexOf(evento.target);
    if (i < 0) return;
    escolher(i);
    mostrar(i);
  });
  barras.addEventListener('focusin', (evento) => {
    const i = botoes.indexOf(evento.target);
    if (i < 0) return;
    escolher(i);
    mostrar(i);
  });
  barras.addEventListener('focusout', (evento) => {
    if (!botoes.includes(evento.relatedTarget) && !mouseDentro) fechar();
  });
  barras.addEventListener('keydown', (evento) => {
    const destino = diaPelaTecla(botoes.indexOf(document.activeElement), evento.key, botoes.length);
    if (destino === null) return;
    evento.preventDefault();
    escolher(destino);
    botoes[destino].focus();
  });
  return { barras, pct, medindo };
}

function desenharLinhas(instante) {
  const quantas = quantasBarras(ESTREITA?.matches === true);
  const todas = quantas === DIAS_GUARDADOS;
  $('legenda').textContent = t(todas ? 'barras.legenda' : 'barras.legenda_30');
  fechadores = [];
  const lista = $('linhas');
  lista.replaceChildren();
  for (const linha of dados.estado.linhas) {
    const item = el('li', 'linha');
    const topo = el('div', 'linha-topo');
    const cabeca = el('div', 'linha-cabeca');
    cabeca.append(el('span', 'linha-nome', linha.nome[idioma]));
    // D17: a linha em breve mostra só o nome e o rótulo: sem barras, sem percentual, sem «Verificado há».
    if (linha.em_breve === true) {
      item.classList.add('linha-em_breve');
      topo.append(cabeca, el('span', 'linha-estado estado-em_breve', t('linha.em_breve')));
      item.append(topo);
      lista.append(item);
      continue;
    }
    // D11: «Verificado há {minutos} min», do último fato; sem fato, não mostra.
    const minutos = linhaPorFato(linha) ? minutosDesde(linha.verificado_em, instante) : null;
    if (minutos !== null) cabeca.append(el('span', 'linha-verificado', t('satelite.verificado', { minutos })));
    topo.append(cabeca, el('span', `linha-estado estado-${linha.estado}`, t(`linha.${linha.estado}`)));
    // A dica repete o nome do dia focado, que o leitor de tela já lê: fica fora da árvore de acessibilidade.
    const dica = el('p', 'dica');
    dica.hidden = true;
    dica.setAttribute('aria-hidden', 'true');
    const { barras, pct, medindo } = desenharBarras(linha, instante, dica, quantas);
    // D21: «—» no lugar do percentual e «medindo desde {data}» no lugar de «de disponibilidade» (nas duas larguras).
    const disponivel = medindo
      ? `${pct} ${t('barras.medindo_desde', { data: medindo })}`
      : t(todas ? 'barras.disponibilidade' : 'barras.disponibilidade_90', { pct });
    const rodape = el('div', 'linha-rodape');
    rodape.append(
      el('span', null, t('barras.dias_atras', { n: quantas })),
      el('span', 'linha-pct', disponivel),
      el('span', null, t('barras.hoje')),
    );
    const base = el('div', 'linha-base');
    base.append(rodape, dica);
    item.append(topo, barras, base);
    lista.append(item);
  }
  $('cartao').hidden = false;
}

function quando(instante) {
  return `${dataDeAssuncao(instante)} ${horaDeAssuncao(instante)}`;
}

function desenharIncidentes(instante) {
  $('incidentes-titulo').textContent = t('incidentes.titulo');
  const caixa = $('incidentes');
  caixa.replaceChildren();
  const recentes = incidentesRecentes(dados.incidentes, instante);
  if (recentes.length === 0) {
    caixa.append(el('p', 'incidentes-nenhum', t('incidentes.nenhum')));
  } else {
    const lista = el('ul', 'incidentes-lista');
    for (const i of recentes) {
      const item = el('li', `incidente incidente-${i.fim === null ? 'aberto' : 'fechado'}`);
      item.append(el('h3', 'incidente-titulo', i.titulo[idioma]));
      const meta = el('p', 'incidente-meta');
      meta.append(
        el('span', `incidente-tipo tipo-${i.tipo}`, t(`incidente.tipo_${i.tipo}`)),
        el('span', 'incidente-estado', t(`incidente.${estadoAtual(i)}`)),
        el('span', null, t('incidente.duracao', { duracao: formatarDuracao(i, instante) })),
      );
      item.append(meta);
      const atualizacoes = el('ol', 'atualizacoes');
      for (const a of [...i.atualizacoes].reverse()) {
        const linha = el('li', 'atualizacao');
        const cabeca = el('p', 'atualizacao-cabeca');
        cabeca.append(el('strong', null, t(`incidente.${a.estado}`)), el('time', null, quando(a.em)));
        cabeca.lastChild.dateTime = a.em;
        linha.append(cabeca, el('p', 'atualizacao-texto', a.texto[idioma]));
        atualizacoes.append(linha);
      }
      item.append(atualizacoes);
      lista.append(item);
    }
    caixa.append(lista);
  }
  $('secao-incidentes').hidden = false;
}

function desenharRodape() {
  const v = dados.estado.verificado_em;
  $('atualizado').textContent = t('rodape.atualizado', { hora: v ? horaDeAssuncao(v) : '—' });
  $('contato').textContent = t('rodape.contato');
}

function desenhar() {
  const instante = agora();
  desenharTopo();
  desenharGeral(instante);
  desenharLinhas(instante);
  desenharIncidentes(instante);
  desenharRodape();
}

// A troca de idioma não recarrega: redesenha e atualiza o ?lang=.
$('idioma').addEventListener('click', (evento) => {
  const pedido = evento.target?.dataset?.idioma;
  if (!IDIOMAS.includes(pedido) || pedido === idioma) return;
  idioma = pedido;
  const url = new URL(location.href);
  url.searchParams.set('lang', idioma);
  history.replaceState(null, '', url);
  desenhar();
});

document.addEventListener('keydown', (evento) => {
  if (evento.key === 'Escape') for (const fechar of fechadores) fechar();
});

ESTREITA?.addEventListener?.('change', desenhar);

try {
  const [estado, dias, incidentes] = await Promise.all([carregar('estado'), carregar('dias'), carregar('incidentes')]);
  dados = { estado, dias, incidentes: incidentes.incidentes ?? [] };
} catch {
  // Sem dados: a página mostra «monitoramento atrasado».
}
desenhar();
