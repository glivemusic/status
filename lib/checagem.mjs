// Uma execução da checagem: chama os alvos, atualiza estado, dias e incidentes.
// Tudo de fora (fetch, relógio, espera, catálogo) entra por parâmetro.
import { checarAlvo } from './classificar.mjs';
import { atualizarMinutosFora, cortarDias, linhaPorFato, registrarChecagem } from './dias.mjs';
import { aplicarChecagem, aplicarFato, linhaVazia, zerarSerie } from './estado.mjs';
import { CHAVES_DO_SATELITE, cortarIncidentes, fecharAutomatico, novoIncidenteAutomatico } from './incidentes.mjs';
import { emMs } from './tempo.mjs';

export const PUBLICAR_A_CADA_MS = 15 * 60_000;

// `estado`: o estado.json; `dias`: o dias.json; `incidentes`: a lista de incidentes.
// -> { estado, dias, incidentes, publicar, resultados, repetidas }
// `repetidas`: as linhas por fato (D11) cuja leitura não contou (mesmo fato ou sem dado).
export async function executarChecagem({ config, estado, dias, incidentes, fetch, relogio, esperar, textos }) {
  const instante = new Date(relogio()).toISOString();
  const novoEstado = structuredClone(estado ?? {});
  novoEstado.linhas ??= {};
  const novosDias = structuredClone(dias ?? {});
  let lista = structuredClone(incidentes ?? []);

  const linhas = config.linhas.filter((l) => !l.pendente);
  const resultados = {};
  const fatos = {};
  for (const alvo of linhas.filter((l) => l.url)) {
    const dependentes = linhas.filter((l) => l.alvo === alvo.id);
    const saida = await checarAlvo(alvo, dependentes, { fetch, relogio, esperar });
    Object.assign(resultados, saida.resultados);
    Object.assign(fatos, saida.fatos);
  }

  let houveEvento = false;
  const repetidas = [];
  for (const l of linhas) {
    const porFato = linhaPorFato(l);
    let atual = novoEstado.linhas[l.id] ?? linhaVazia();
    let aberto = atual.incidente ? lista.find((i) => i.id === atual.incidente) : undefined;
    if (atual.incidente && (!aberto || aberto.fim !== null)) {
      // O automático foi resolvido à mão (ou sumiu): o próximo problema abre um novo.
      atual = zerarSerie(atual);
      aberto = undefined;
    }

    const resultado = resultados[l.id] ?? 'sem_dado';
    let linha;
    let evento;
    if (porFato) {
      // D11: conta o fato, não a leitura; o dia é o do `verificado_em` do fato.
      const fato = fatos[l.id] ?? null;
      const aplicado = aplicarFato(atual, resultado, fato);
      ({ linha, evento } = aplicado);
      if (aplicado.contou) registrarChecagem(novosDias, l.id, resultado, fato);
      else repetidas.push(l.id);
    } else {
      ({ linha, evento } = aplicarChecagem(atual, resultado, instante, aberto?.tipo ?? null));
      registrarChecagem(novosDias, l.id, resultado, instante);
    }

    if (evento?.acao === 'abrir') {
      const novo = novoIncidenteAutomatico({
        linha: l.id,
        nome: l.nome,
        tipo: evento.tipo,
        inicio: evento.inicio,
        instante,
        textos,
        chaves: porFato ? CHAVES_DO_SATELITE : null,
      });
      lista.push(novo);
      linha.incidente = novo.id;
      houveEvento = true;
    } else if (evento?.acao === 'mudar_tipo') {
      aberto.tipo = evento.tipo;
      houveEvento = true;
    } else if (evento?.acao === 'fechar') {
      fecharAutomatico(aberto, evento.fim, instante, textos);
      linha.incidente = null;
      houveEvento = true;
    }

    novoEstado.linhas[l.id] = linha;
  }

  lista = cortarIncidentes(lista, instante);
  cortarDias(novosDias, instante);
  atualizarMinutosFora(novosDias, lista, instante);

  novoEstado.verificado_em = instante;
  const ultimo = novoEstado.publicado_em ? emMs(novoEstado.publicado_em) : null;
  const publicar = houveEvento || ultimo === null || emMs(instante) - ultimo > PUBLICAR_A_CADA_MS;
  if (publicar) novoEstado.publicado_em = instante;

  return { estado: novoEstado, dias: novosDias, incidentes: lista, publicar, resultados, repetidas };
}
