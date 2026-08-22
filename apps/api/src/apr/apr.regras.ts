import { CategoriaItemApr, GravidadeApr, RespostaRelato } from '@prisma/client';

/**
 * O que falta para uma APR poder liberar o serviço.
 *
 * Está separado do serviço, e sem banco no meio, por dois motivos. O primeiro é
 * poder testar: são as regras que decidem se uma equipe sobe no poste, e elas
 * merecem prova. O segundo é a tela — ela roda a mesma conferência enquanto se
 * preenche, para o técnico saber o que falta antes de apertar o botão, e não
 * depois de o servidor recusar.
 *
 * A régua toda é o papel. O que ele pede em quadradinho, aqui é exigência;
 * o único acréscimo é a providência de quem responde "Não" ao relato — no papel
 * essa resposta vai embora sem deixar rastro do que foi feito a respeito.
 */

export interface RespostaParaConferir {
  categoria: CategoriaItemApr;
  texto: string;
  marcado: boolean;
  resposta: RespostaRelato | null;
  detalhe: string | null;
  /** Do item de origem: marcar abre um campo de texto. */
  pedeDetalhe: boolean;
  /** Do item de origem: responder "Não" obriga a dizer o que foi feito. */
  exigeProvidencia: boolean;
}

export interface ExecutanteParaConferir {
  nome: string;
  assinadoEm: Date | null;
}

export interface AprParaConferir {
  local: string;
  coordenador: string;
  descricaoEtapas: string;
  gravidade: GravidadeApr | null;
  respostas: RespostaParaConferir[];
  executantes: ExecutanteParaConferir[];
}

/** Quantas letras de descrição já contam como uma etapa descrita. */
const MINIMO_DA_DESCRICAO = 15;

/**
 * As pendências, em português, na ordem em que a tela as mostra.
 *
 * Devolve a lista inteira, e não a primeira: quem está na beira da estrada não
 * pode descobrir o que falta uma pendência por vez.
 */
export function pendenciasParaLiberar(apr: AprParaConferir): string[] {
  const pendencias: string[] = [];

  if (!apr.local.trim()) pendencias.push('Diga onde é o serviço.');
  if (!apr.coordenador.trim()) {
    pendencias.push('Diga quem coordena a equipe.');
  }
  if (apr.descricaoEtapas.trim().length < MINIMO_DA_DESCRICAO) {
    pendencias.push(
      'Descreva a atividade por etapas — é o campo que diz o que a equipe ' +
        'foi fazer.',
    );
  }
  if (!apr.gravidade) {
    pendencias.push('Escolha o potencial de gravidade.');
  }

  pendencias.push(...pendenciasDasMarcacoes(apr.respostas));
  pendencias.push(...pendenciasDoRelato(apr.respostas));
  pendencias.push(...pendenciasDaEquipe(apr.executantes));

  return pendencias;
}

/** As categorias que não podem ficar todas em branco, e o que dizer de cada. */
const EXIGIDAS: { categoria: CategoriaItemApr; falta: string }[] = [
  {
    categoria: CategoriaItemApr.NORMA,
    falta: 'Marque as normas envolvidas no processo.',
  },
  {
    categoria: CategoriaItemApr.ATIVIDADE,
    falta: 'Marque a atividade que vai ser executada.',
  },
  {
    categoria: CategoriaItemApr.RISCO,
    falta:
      'Marque ao menos um risco da atividade. Uma análise de risco sem risco ' +
      'nenhum marcado não analisou nada.',
  },
  {
    categoria: CategoriaItemApr.PROTECAO,
    falta: 'Marque os EPIs e EPCs de uso obrigatório neste serviço.',
  },
];

function pendenciasDasMarcacoes(respostas: RespostaParaConferir[]): string[] {
  const pendencias: string[] = [];

  for (const { categoria, falta } of EXIGIDAS) {
    const marcou = respostas.some((r) => r.categoria === categoria && r.marcado);
    if (!marcou) pendencias.push(falta);
  }

  // "Outros, quais?" marcado e em branco é a marcação que não diz nada.
  for (const r of respostas) {
    if (r.marcado && r.pedeDetalhe && !r.detalhe?.trim()) {
      pendencias.push(`Você marcou "${r.texto}" — escreva quais.`);
    }
  }

  return pendencias;
}

function pendenciasDoRelato(respostas: RespostaParaConferir[]): string[] {
  const pendencias: string[] = [];
  const relato = respostas.filter(
    (r) => r.categoria === CategoriaItemApr.RELATO,
  );

  const semResposta = relato.filter((r) => !r.resposta);
  if (semResposta.length > 0) {
    pendencias.push(
      semResposta.length === 1
        ? `Responda: "${semResposta[0].texto}"`
        : `Faltam ${semResposta.length} perguntas do relato situacional.`,
    );
  }

  for (const r of relato) {
    if (
      r.resposta === RespostaRelato.NAO &&
      r.exigeProvidencia &&
      !r.detalhe?.trim()
    ) {
      pendencias.push(
        `Você respondeu "Não" em "${r.texto}" — escreva o que foi feito a ` +
          'respeito.',
      );
    }
  }

  return pendencias;
}

function pendenciasDaEquipe(executantes: ExecutanteParaConferir[]): string[] {
  if (executantes.length === 0) {
    return ['Diga quem vai executar o serviço.'];
  }

  const semAssinar = executantes.filter((e) => !e.assinadoEm);
  if (semAssinar.length === 0) return [];

  return [
    semAssinar.length === 1
      ? `Falta ${semAssinar[0].nome} assinar.`
      : `Faltam ${semAssinar.length} assinaturas: ` +
        `${semAssinar.map((e) => primeiroNome(e.nome)).join(', ')}.`,
  ];
}

/**
 * Os riscos que a equipe marcou, para o resumo da lista.
 *
 * Quem olha a lista de APRs do dia não vai abrir uma por uma: o que se procura
 * de relance é o serviço que marcou choque elétrico.
 */
export function riscosMarcados(respostas: RespostaParaConferir[]): string[] {
  return respostas
    .filter((r) => r.categoria === CategoriaItemApr.RISCO && r.marcado)
    .map((r) => r.texto);
}

/**
 * As perguntas do relato respondidas com "Não" — o que o supervisor procura.
 *
 * É a informação mais cara do documento e a que mais se perde no papel: fica
 * num quadradinho no meio da terceira folha.
 */
export function relatosNegativos(
  respostas: RespostaParaConferir[],
): { pergunta: string; providencia: string | null }[] {
  return respostas
    .filter(
      (r) =>
        r.categoria === CategoriaItemApr.RELATO &&
        r.resposta === RespostaRelato.NAO,
    )
    .map((r) => ({ pergunta: r.texto, providencia: r.detalhe?.trim() || null }));
}

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome;
}
