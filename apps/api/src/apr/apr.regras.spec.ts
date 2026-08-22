import { CategoriaItemApr, GravidadeApr, RespostaRelato } from '@prisma/client';
import {
  pendenciasParaLiberar,
  relatosNegativos,
  riscosMarcados,
  type AprParaConferir,
  type RespostaParaConferir,
} from './apr.regras';

/**
 * São as regras que decidem se uma equipe sobe no poste. O que se prova aqui é
 * que nenhuma APR incompleta passa, e que quem preenche descobre tudo o que
 * falta de uma vez — não uma pendência por vez, de pé na beira da estrada.
 */

function marcacao(
  categoria: CategoriaItemApr,
  texto: string,
  extra: Partial<RespostaParaConferir> = {},
): RespostaParaConferir {
  return {
    categoria,
    texto,
    marcado: false,
    resposta: null,
    detalhe: null,
    pedeDetalhe: false,
    exigeProvidencia: false,
    ...extra,
  };
}

/** Uma APR completa, para os testes tirarem uma peça de cada vez. */
function aprCompleta(): AprParaConferir {
  return {
    local: 'Rua das Palmeiras, poste 42',
    coordenador: 'Werick Castro',
    descricaoEtapas:
      'Isolar a área, amarrar a escada, subir com trava-quedas e emendar a CTO.',
    gravidade: GravidadeApr.ALTA,
    respostas: [
      marcacao(CategoriaItemApr.NORMA, 'NR-35', { marcado: true }),
      marcacao(CategoriaItemApr.ATIVIDADE, 'Manutenção de Redes', {
        marcado: true,
      }),
      marcacao(CategoriaItemApr.RISCO, 'Quedas de altura', { marcado: true }),
      marcacao(CategoriaItemApr.PROTECAO, 'Capacete com jugular', {
        marcado: true,
      }),
      marcacao(CategoriaItemApr.RELATO, 'As condições atmosféricas são favoráveis?', {
        resposta: RespostaRelato.SIM,
        exigeProvidencia: true,
      }),
    ],
    executantes: [
      { nome: 'João da Silva', assinadoEm: new Date('2026-08-21T09:00:00Z') },
    ],
  };
}

describe('pendenciasParaLiberar', () => {
  it('não reclama de uma APR completa', () => {
    expect(pendenciasParaLiberar(aprCompleta())).toEqual([]);
  });

  it('exige ao menos um risco marcado', () => {
    const apr = aprCompleta();
    apr.respostas = apr.respostas.filter(
      (r) => r.categoria !== CategoriaItemApr.RISCO,
    );

    expect(pendenciasParaLiberar(apr)).toEqual([
      expect.stringContaining('risco'),
    ]);
  });

  it.each([
    [CategoriaItemApr.NORMA, 'normas'],
    [CategoriaItemApr.ATIVIDADE, 'atividade'],
    [CategoriaItemApr.PROTECAO, 'EPIs'],
  ])('exige marcação em %s', (categoria, trecho) => {
    const apr = aprCompleta();
    apr.respostas = apr.respostas.filter((r) => r.categoria !== categoria);

    expect(pendenciasParaLiberar(apr)).toEqual([
      expect.stringContaining(trecho),
    ]);
  });

  it('não deixa passar ferramenta em branco — ela não é exigida', () => {
    // O papel não obriga a marcar ferramenta: há serviço que se faz com a mão.
    const apr = aprCompleta();
    expect(pendenciasParaLiberar(apr)).toEqual([]);
  });

  it('cobra o "quais?" de quem marcou "Outros"', () => {
    const apr = aprCompleta();
    apr.respostas.push(
      marcacao(CategoriaItemApr.RISCO, 'Outros, quais?', {
        marcado: true,
        pedeDetalhe: true,
      }),
    );

    expect(pendenciasParaLiberar(apr)).toEqual([
      'Você marcou "Outros, quais?" — escreva quais.',
    ]);
  });

  it('aceita "Outros" quando o campo foi preenchido', () => {
    const apr = aprCompleta();
    apr.respostas.push(
      marcacao(CategoriaItemApr.RISCO, 'Outros, quais?', {
        marcado: true,
        pedeDetalhe: true,
        detalhe: 'Cão solto no terreno vizinho',
      }),
    );

    expect(pendenciasParaLiberar(apr)).toEqual([]);
  });

  it('nomeia a pergunta quando falta só uma do relato', () => {
    const apr = aprCompleta();
    apr.respostas.push(
      marcacao(CategoriaItemApr.RELATO, 'O piso é resistente e plano?'),
    );

    expect(pendenciasParaLiberar(apr)).toEqual([
      'Responda: "O piso é resistente e plano?"',
    ]);
  });

  it('conta as perguntas quando falta mais de uma', () => {
    const apr = aprCompleta();
    apr.respostas.push(
      marcacao(CategoriaItemApr.RELATO, 'Primeira?'),
      marcacao(CategoriaItemApr.RELATO, 'Segunda?'),
    );

    expect(pendenciasParaLiberar(apr)).toEqual([
      'Faltam 2 perguntas do relato situacional.',
    ]);
  });

  it('cobra a providência de quem respondeu "Não"', () => {
    const apr = aprCompleta();
    apr.respostas.push(
      marcacao(CategoriaItemApr.RELATO, 'A área foi isolada?', {
        resposta: RespostaRelato.NAO,
        exigeProvidencia: true,
      }),
    );

    expect(pendenciasParaLiberar(apr)).toEqual([
      expect.stringContaining('o que foi feito a respeito'),
    ]);
  });

  it('não cobra providência quando o item foi dispensado dela', () => {
    const apr = aprCompleta();
    apr.respostas.push(
      marcacao(CategoriaItemApr.RELATO, 'A área foi isolada?', {
        resposta: RespostaRelato.NAO,
        exigeProvidencia: false,
      }),
    );

    expect(pendenciasParaLiberar(apr)).toEqual([]);
  });

  it('"Não se aplica" não pede providência nenhuma', () => {
    const apr = aprCompleta();
    apr.respostas.push(
      marcacao(CategoriaItemApr.RELATO, 'As escadas estão travadas?', {
        resposta: RespostaRelato.NAO_SE_APLICA,
        exigeProvidencia: true,
      }),
    );

    expect(pendenciasParaLiberar(apr)).toEqual([]);
  });

  it('exige equipe', () => {
    const apr = aprCompleta();
    apr.executantes = [];

    expect(pendenciasParaLiberar(apr)).toEqual([
      'Diga quem vai executar o serviço.',
    ]);
  });

  it('nomeia quem falta assinar quando é um só', () => {
    const apr = aprCompleta();
    apr.executantes = [{ nome: 'Maria Souza', assinadoEm: null }];

    expect(pendenciasParaLiberar(apr)).toEqual(['Falta Maria Souza assinar.']);
  });

  it('lista os primeiros nomes quando falta mais de um', () => {
    const apr = aprCompleta();
    apr.executantes = [
      { nome: 'Maria Souza', assinadoEm: null },
      { nome: 'Pedro Lima', assinadoEm: null },
      { nome: 'Ana Reis', assinadoEm: new Date() },
    ];

    expect(pendenciasParaLiberar(apr)).toEqual([
      'Faltam 2 assinaturas: Maria, Pedro.',
    ]);
  });

  it('cobra a descrição das etapas quando ela é curta demais', () => {
    const apr = aprCompleta();
    apr.descricaoEtapas = 'subir';

    expect(pendenciasParaLiberar(apr)).toEqual([
      expect.stringContaining('etapas'),
    ]);
  });

  it('cobra a gravidade', () => {
    const apr = aprCompleta();
    apr.gravidade = null;

    expect(pendenciasParaLiberar(apr)).toEqual([
      'Escolha o potencial de gravidade.',
    ]);
  });

  it('devolve tudo o que falta de uma vez, e não a primeira pendência', () => {
    const apr: AprParaConferir = {
      local: '',
      coordenador: '',
      descricaoEtapas: '',
      gravidade: null,
      respostas: [],
      executantes: [],
    };

    // Local, coordenador, etapas, gravidade, as quatro categorias e a equipe.
    expect(pendenciasParaLiberar(apr)).toHaveLength(9);
  });
});

describe('riscosMarcados', () => {
  it('devolve só os riscos, e só os marcados', () => {
    const respostas = [
      marcacao(CategoriaItemApr.RISCO, 'Choque elétrico', { marcado: true }),
      marcacao(CategoriaItemApr.RISCO, 'Chuva'),
      marcacao(CategoriaItemApr.PROTECAO, 'Escada', { marcado: true }),
    ];

    expect(riscosMarcados(respostas)).toEqual(['Choque elétrico']);
  });
});

describe('relatosNegativos', () => {
  it('junta a pergunta com a providência de quem respondeu "Não"', () => {
    const respostas = [
      marcacao(CategoriaItemApr.RELATO, 'A área foi isolada?', {
        resposta: RespostaRelato.NAO,
        detalhe: 'Isolamos com cones logo depois',
      }),
      marcacao(CategoriaItemApr.RELATO, 'O clima está bom?', {
        resposta: RespostaRelato.SIM,
      }),
    ];

    expect(relatosNegativos(respostas)).toEqual([
      {
        pergunta: 'A área foi isolada?',
        providencia: 'Isolamos com cones logo depois',
      },
    ]);
  });

  it('providência em branco vira nulo, e não uma frase vazia', () => {
    const respostas = [
      marcacao(CategoriaItemApr.RELATO, 'A área foi isolada?', {
        resposta: RespostaRelato.NAO,
        detalhe: '   ',
      }),
    ];

    expect(relatosNegativos(respostas)[0].providencia).toBeNull();
  });
});
