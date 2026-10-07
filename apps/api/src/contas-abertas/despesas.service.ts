import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ContaPagar } from '@prisma/client';
import { ContasPagarService } from '../financeiro/contas-pagar.service';
import { CategoriasService } from './categorias.service';
import { CriarDespesaDto } from './dto/despesa.dto';
import { PagamentosService } from './pagamentos.service';
import {
  conferirArquivo,
  emMegabytes,
  extensaoDoTipo,
  lerDataUrl,
  tipoPeloConteudo,
} from '../arquivos/data-url';
import { IxcClient } from '../ixc/ixc.client';
import { parseIxcId } from '../ixc/ixc.parse';
import { PrismaService } from '../prisma/prisma.service';

/** O que aconteceu ao dar por paga a conta recém-lançada. */
export interface BaixaDoLancamento {
  /** Quantas contas ficaram quitadas no IXC. */
  pagas: number;
  /** Quantas se tentou baixar — passa de uma quando é parcelado. */
  tentadas: number;
  /** Total que o IXC deu por pago. */
  valor: number;
  /** Dia que ficou registrado na baixa (AAAA-MM-DD). */
  data: string;
  /** O que não saiu como esperado. Vazio = correu tudo bem. */
  avisos: string[];
}

/** O que aconteceu ao lançar uma despesa à mão. */
export interface DespesaLancada {
  /** A primeira conta criada — a única, quando não é parcelado. */
  conta: ContaPagar;
  /** Todas as contas criadas: uma por parcela. */
  contas: ContaPagar[];
  /**
   * Por que a etiqueta não ficou, quando não ficou. A conta já existe no IXC
   * nesse caso — o que falta é só a classificação daqui, e ela se resolve na
   * própria lista de contas em aberto.
   */
  avisoCategoria: string | null;
  /** Null quando o lançamento não pediu para já sair pago. */
  baixa: BaixaDoLancamento | null;
  /**
   * As notas da conta paga de uma vez, na ordem em que vieram — é por estes
   * números que a tela manda a foto de cada uma. Vazio na conta comum.
   */
  partes?: Array<{ id: string }>;
}

/** Uma nota guardada aqui, como a tela a lista: sem o arquivo. */
export interface NotaGuardada {
  id: string;
  /** "Strada · Manutenção — troca de óleo": o que se lê no botão. */
  rotulo: string;
  /** A nota da conta de onde ela é. */
  parteId: string;
  createdAt: Date;
}

/**
 * Lançar uma conta a pagar à mão, sem passar pela folha.
 *
 * Fica no módulo de contas em aberto porque é dali que ela nasce, na tela em
 * que se olha o que a empresa deve. O trabalho pesado continua no
 * `ContasPagarService` — é o mesmo caminho até o `fn_apagar` que a folha usa,
 * com a mesma auditoria e o mesmo acompanhamento do pagamento.
 */
@Injectable()
export class DespesasService {
  private readonly logger = new Logger(DespesasService.name);

  constructor(
    private readonly contasPagar: ContasPagarService,
    private readonly categorias: CategoriasService,
    private readonly pagamentos: PagamentosService,
    private readonly ixc: IxcClient,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * As notas que um título já tem, lidas do IXC.
   *
   * É a mesma lista que a aba "Arquivos" da tela dele mostra — e é ela que
   * responde "a nota subiu mesmo?", que é a pergunta de quem acabou de anexar.
   */
  async notas(idFnApagar: number): Promise<NotaDoTitulo[]> {
    const res = await this.ixc.list<Record<string, unknown>>(
      'fn_apagar_arquivos',
      {
        qtype: 'fn_apagar_arquivos.id_apagar',
        query: String(idFnApagar),
        oper: '=',
        rp: 50,
        sortname: 'fn_apagar_arquivos.id',
        sortorder: 'desc',
      },
    );

    return res.registros
      .map((raw) => {
        const id = parseIxcId(raw.id);
        if (id === null) return null;
        return {
          id,
          descricao: textoOuNull(raw.descricao) ?? 'Nota',
          extensao: (textoOuNull(raw.extensao) ?? '').replace('.', ''),
          data: textoOuNull(raw.data) ?? textoOuNull(raw.data_cadastro),
          usuario: textoOuNull(raw.usuario) ?? textoOuNull(raw.id_usuario),
        };
      })
      .filter((n): n is NotaDoTitulo => n !== null);
  }

  /**
   * O conteúdo de uma nota, para a tela abrir.
   *
   * O webservice devolve o arquivo em base64, e a coleção do IXC não diz em que
   * campo — por isso ele é procurado: o primeiro texto grande que se pareça com
   * base64 é o arquivo, em qualquer nível da resposta (ela às vezes vem dentro
   * de `registros`). Não achando, o erro repete o que o IXC disse e quais
   * campos vieram, que é o que permite acertar isto sem adivinhar de novo.
   *
   * O `id` daqui é o do arquivo. A coleção do IXC, porém, mostra esta mesma
   * chamada com o id do **título** (`{{id_apagar}}`) — e é assim que ela
   * atende em algumas versões. Por isso, falhando pelo arquivo, tenta-se pelo
   * título; mas só quando ele tem uma nota só, senão o que voltaria poderia
   * ser a nota errada, que é pior que erro nenhum.
   */
  async baixarNota(
    id: number,
    extensao?: string,
    idFnApagar?: number,
  ): Promise<{ conteudo: Buffer; tipo: string; nome: string }> {
    let lido = await this.lerArquivoDoIxc({ id: String(id) });

    if (!lido.arquivo && idFnApagar) {
      const notas = await this.notas(idFnApagar);
      if (notas.length === 1 && notas[0].id === id) {
        this.logger.log(
          `Download da nota ${id}: o IXC não a deu pelo id do arquivo; ` +
            `tentando pelo título ${idFnApagar}.`,
        );
        lido = await this.lerArquivoDoIxc({ id: String(idFnApagar) });
      }
    }

    if (!lido.arquivo) {
      this.logger.warn(
        `Download da nota ${id}: o arquivo não veio (${lido.comoVeio}` +
          `${lido.dito ? `; IXC: ${lido.dito}` : ''}).`,
      );
      // O que veio vai na frase: é o que deixa acertar isto pelo print da
      // tela, sem depender de alguém abrir o log do servidor.
      throw new BadRequestException(
        (lido.dito
          ? `O IXC recusou o download desta nota: ${lido.dito}. `
          : `O IXC respondeu sem o arquivo (${lido.comoVeio}). `) +
          'Abra a nota pela aba "Arquivos" do título, no IXC.',
      );
    }

    const conteudo = lido.arquivo;
    // O conteúdo diz o que é; a extensão do IXC é o palpite de quem anexou —
    // e nesta base ela diz "PDF" até para a foto tirada pela câmera.
    const pelosBytes = tipoPeloConteudo(conteudo);
    const ext = pelosBytes
      ? extensaoDoTipo(pelosBytes)
      : (extensao || 'pdf').toLowerCase().replace('.', '');
    return {
      conteudo,
      tipo: pelosBytes ?? TIPO_POR_EXTENSAO[ext] ?? 'application/octet-stream',
      nome: `nota-${id}.${ext}`,
    };
  }

  /**
   * O que o download do IXC devolveu: o arquivo, quando veio; e, quando não,
   * o que veio no lugar.
   *
   * São três jeitos de o arquivo chegar, e o webservice não diz qual usa: o
   * arquivo cru, que os primeiros bytes reconhecem; o base64 dentro de um
   * JSON, em qualquer galho dele; e o base64 solto. O "não achei" de antes era
   * o primeiro jeito sendo lido como se fosse o segundo.
   */
  private async lerArquivoDoIxc(
    corpo: Record<string, string>,
  ): Promise<{ arquivo: Buffer | null; dito: string | null; comoVeio: string }> {
    const { tipo, conteudo } = await this.ixc.baixar('fn_apagar_arquivos_download', corpo);

    if (tipoPeloConteudo(conteudo)) return { arquivo: conteudo, dito: null, comoVeio: '' };

    const texto = conteudo.toString('utf8');
    let json: unknown = null;
    try {
      json = JSON.parse(texto);
    } catch {
      // Não era JSON: pode ser o base64 solto, logo abaixo.
    }

    if (json && typeof json === 'object') {
      const base64 = acharBase64(json);
      if (base64) {
        return { arquivo: Buffer.from(base64, 'base64'), dito: null, comoVeio: '' };
      }
      const campos = Object.keys(json as Record<string, unknown>);
      return {
        arquivo: null,
        dito: mensagemDoIxc(json as Record<string, unknown>),
        comoVeio: `JSON com ${campos.length ? campos.slice(0, 8).join(', ') : 'nada'}`,
      };
    }

    const solto = acharBase64(texto.trim());
    if (solto) return { arquivo: Buffer.from(solto, 'base64'), dito: null, comoVeio: '' };

    const inicio = texto.slice(0, 40).replace(/[^\x20-\x7e]/g, '·');
    return {
      arquivo: null,
      dito: null,
      comoVeio: `${tipo || 'sem tipo'}, ${conteudo.length} bytes, começando por "${inicio}"`,
    };
  }

  /**
   * Anexa a nota ao título, no próprio IXC.
   *
   * O papel fica onde a conta está, e não numa gaveta deste app: quem abrir o
   * título por lá — para conferir, para estornar, para responder ao contador —
   * acha a nota no mesmo lugar, sem saber que este sistema existe. O IXC tem o
   * recurso pronto para isso (`fn_apagar_arquivos`), e é ele que a tela dele
   * lista na aba de arquivos.
   *
   * Aceita imagem e PDF: é foto de cupom, digitalização de nota e print de
   * comprovante que entram aqui.
   */
  async anexarNota(
    idFnApagar: number,
    dados: { arquivo: string; nome?: string; descricao?: string },
  ): Promise<{ anexado: true; nome: string }> {
    const arquivo = lerDataUrl(dados.arquivo);
    conferirArquivo(
      arquivo,
      TIPOS_DE_NOTA,
      LIMITE_DA_NOTA,
      'A nota entra como PDF ou imagem.',
    );

    const nome = nomeDoAnexo(dados.nome, arquivo.tipo);
    await this.ixc.upload(
      'fn_apagar_arquivos',
      'arquivo',
      { nome, tipo: arquivo.tipo, conteudo: arquivo.conteudo },
      {
        id_apagar: String(idFnApagar),
        // A descrição é o que aparece na lista de arquivos do título no IXC.
        descricao: (dados.descricao?.trim() || 'Nota').slice(0, 100),
      },
    );

    this.logger.log(
      `Nota "${nome}" (${emMegabytes(arquivo.conteudo.length)}) anexada ao ` +
        `título ${idFnApagar} no IXC.`,
    );
    return { anexado: true, nome };
  }

  /** As despesas que não chegaram ao IXC, para a tela poder mostrá-las. */
  naoEnviadas() {
    return this.contasPagar.despesasNaoEnviadas();
  }

  async lancar(
    dto: CriarDespesaDto,
    usuarioId?: string,
    usuarioNome?: string,
  ): Promise<DespesaLancada> {
    const hoje = hojeUtc();
    const emissao = dto.dataEmissao ? dataUtc(dto.dataEmissao) : hoje;

    // Conferido antes de ir ao IXC: um veículo que não existe mais (apagado em
    // outra aba) viraria uma conta lançada lá e sem vínculo aqui, em silêncio.
    if (dto.veiculoId) {
      const veiculo = await this.prisma.veiculo.findUnique({
        where: { id: dto.veiculoId },
        select: { id: true },
      });
      if (!veiculo) {
        throw new BadRequestException(
          'O veículo escolhido não existe mais. Escolha outro — nada foi lançado.',
        );
      }
    }

    const notas = await this.conferirNotas(dto);

    /** O que é igual em todas as parcelas. */
    const comum = {
      idFornecedorIxc: dto.idFornecedorIxc,
      fornecedorNome: dto.fornecedorNome.trim(),
      dataEmissao: emissao,
      contaContabil: dto.contaContabil,
      contaPagamento: dto.contaPagamento,
      tipoPagamentoIxc: dto.tipoPagamento,
      numeroNota: dto.numeroNota,
      chavePix: dto.chavePix,
      tipoChavePix: dto.tipoChavePix,
      // Com várias notas, a conta não é de um veículo: quem conta é cada nota.
      // Com os dois, a ficha somaria o mesmo dinheiro duas vezes.
      veiculoId: notas ? null : (dto.veiculoId ?? null),
    };

    let lancada: DespesaLancada;
    if (!dto.parcelas?.length) {
      const conta = await this.contasPagar.criarDespesa(
        {
          ...comum,
          valor: dto.valor,
          dataVencimento: dto.dataVencimento ? dataUtc(dto.dataVencimento) : hoje,
          observacao: notas
            ? await this.observacaoComNotas(dto.observacao.trim(), notas)
            : dto.observacao.trim(),
          codigoBarras: dto.codigoBarras,
          documento: dto.documento,
        },
        usuarioId,
      );

      const gravadas = notas
        ? await this.gravarNotas(conta, notas)
        : { partes: [], aviso: null };
      const avisos = [
        await this.etiquetar(conta, dto.categoriaId ?? null, usuarioId),
        gravadas.aviso,
      ].filter((a): a is string => !!a);

      lancada = {
        conta,
        contas: [conta],
        avisoCategoria: avisos.length ? avisos.join(' ') : null,
        baixa: null,
        partes: gravadas.partes,
      };
    } else {
      lancada = await this.lancarParcelas(dto, comum, usuarioId);
    }

    // A baixa vem por último e nunca derruba o lançamento: a conta já existe no
    // IXC a esta altura, e desfazê-la para "cancelar" a baixa que falhou
    // deixaria o pior dos dois mundos — nada registrado aqui e um título órfão
    // lá. Não dando, quem lançou recebe o aviso e paga pela lista, onde o botão
    // faz exatamente esta mesma chamada.
    if (!dto.jaPaga) return lancada;

    return {
      ...lancada,
      baixa: await this.darPorPaga(lancada.contas, dto, usuarioNome),
    };
  }

  /**
   * As notas da conta, conferidas antes de qualquer coisa ir ao IXC.
   *
   * A divisão que não fecha é recusada aqui, e não remendada: um centavo a
   * mais numa nota é um centavo a menos em outra, e os relatórios passariam a
   * contar uma história que o papel não conta. Veículo ou categoria apagados
   * em outra aba também param tudo — a nota ficaria sem o que ela diz ser.
   */
  private async conferirNotas(
    dto: CriarDespesaDto,
  ): Promise<NonNullable<CriarDespesaDto['notas']> | null> {
    const notas = dto.notas?.length ? dto.notas : (dto.porVeiculo ?? []);
    if (notas.length === 0) return null;

    if (dto.parcelas?.length) {
      throw new BadRequestException(
        'A conta com várias notas vai num pagamento só — não dá para ' +
          'parcelá-la. Nada foi lançado.',
      );
    }

    const soma = centavos(notas.reduce((t, n) => t + n.valor, 0));
    if (Math.abs(soma - centavos(dto.valor)) > 0.005) {
      throw new BadRequestException(
        `As notas somam ${reais(soma)} e a conta é de ${reais(dto.valor)}. ` +
          'Confira os valores — nada foi lançado.',
      );
    }

    const veiculos = [...new Set(notas.map((n) => n.veiculoId).filter((v): v is string => !!v))];
    if (
      veiculos.length > 0 &&
      (await this.prisma.veiculo.count({ where: { id: { in: veiculos } } })) !== veiculos.length
    ) {
      throw new BadRequestException(
        'Um dos veículos escolhidos não existe mais. Escolha outro — nada foi lançado.',
      );
    }

    const categorias = [
      ...new Set(notas.map((n) => n.categoriaId).filter((c): c is string => !!c)),
    ];
    if (
      categorias.length > 0 &&
      (await this.prisma.categoriaDespesa.count({ where: { id: { in: categorias } } })) !==
        categorias.length
    ) {
      throw new BadRequestException(
        'Uma das categorias escolhidas não existe mais. Escolha outra — nada foi lançado.',
      );
    }
    return notas;
  }

  /**
   * A observação do título com o detalhamento das notas.
   *
   * No IXC a conta paga de uma vez é um título só, e é a observação dele que
   * diz o que se pagou: quem abre o título por lá — o financeiro, o contador —
   * tem de ler cada nota sem vir até aqui. Uma linha por nota, com o veículo,
   * o que foi, a categoria e o valor; o texto escrito na tela vai em cima, e o
   * total embaixo.
   */
  private async observacaoComNotas(
    texto: string,
    notas: NonNullable<CriarDespesaDto['notas']>,
  ): Promise<string> {
    const ids = (campo: 'veiculoId' | 'categoriaId') => [
      ...new Set(notas.map((n) => n[campo]).filter((v): v is string => !!v)),
    ];
    const [veiculos, categorias] = await Promise.all([
      this.prisma.veiculo.findMany({
        where: { id: { in: ids('veiculoId') } },
        select: { id: true, apelido: true },
      }),
      this.prisma.categoriaDespesa.findMany({
        where: { id: { in: ids('categoriaId') } },
        select: { id: true, nome: true },
      }),
    ]);
    const apelido = new Map(veiculos.map((v) => [v.id, v.apelido]));
    const categoria = new Map(categorias.map((c) => [c.id, c.nome]));

    const linhas = notas.map((n, i) => {
      const doVeiculo = n.veiculoId ? apelido.get(n.veiculoId) : undefined;
      const daCategoria = n.categoriaId ? categoria.get(n.categoriaId) : undefined;
      const oQue = [doVeiculo, n.descricao?.trim()].filter(Boolean).join(' — ');
      const nome = oQue
        ? daCategoria
          ? `${oQue} (${daCategoria})`
          : oQue
        : (daCategoria ?? 'Nota');
      return `${i + 1}. ${nome}: ${reais(centavos(n.valor))}`;
    });
    const total = centavos(notas.reduce((t, n) => t + n.valor, 0));
    return [texto, ...linhas, `Total: ${reais(total)}`].join('\n');
  }

  /**
   * Grava as notas, com a conta já no IXC.
   *
   * Falhar aqui não derruba o lançamento, como a etiqueta: a conta existe lá e
   * apagá-la seria pior. Quem lançou recebe o aviso.
   */
  private async gravarNotas(
    conta: ContaPagar,
    notas: NonNullable<CriarDespesaDto['notas']>,
  ): Promise<{ partes: Array<{ id: string }>; aviso: string | null }> {
    try {
      // Uma a uma, numa transação: a tela precisa dos números na ordem em que
      // mandou as notas, para saber de quem é cada foto.
      const partes = await this.prisma.$transaction(
        notas.map((n) =>
          this.prisma.parteDaConta.create({
            data: {
              contaPagarId: conta.id,
              veiculoId: n.veiculoId || null,
              categoriaId: n.categoriaId || null,
              valor: centavos(n.valor),
              descricao: n.descricao?.trim() || null,
            },
            select: { id: true },
          }),
        ),
      );
      return { partes, aviso: null };
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Conta ${conta.id} foi lançada, mas as notas dela não ficaram: ${motivo}`,
      );
      return {
        partes: [],
        aviso:
          `A conta foi lançada no IXC, mas a divisão pelas notas não ficou ` +
          `gravada (${motivo}). Avise quem cuida do sistema.`,
      };
    }
  }

  /**
   * A foto (ou o PDF) de uma das notas de uma conta paga de uma vez.
   *
   * Fica guardada aqui e sobe também para o título no IXC, onde quem abrir a
   * conta por lá a encontra. É daqui que ela abre nesta casa: com várias no
   * mesmo título, o webservice desta base não devolve uma por uma — pedido o
   * arquivo, ele não acha; pedido o título, ele não sabe qual.
   *
   * O IXC recusar não perde a foto: ela já está guardada, e o aviso volta.
   */
  async anexarNotaDaParte(
    parteId: string,
    dados: { arquivo: string; nome?: string; descricao?: string },
  ): Promise<{ guardada: true; aviso: string | null }> {
    const parte = await this.prisma.parteDaConta.findUnique({
      where: { id: parteId },
      select: { id: true, conta: { select: { idFnApagarIxc: true } } },
    });
    if (!parte) throw new NotFoundException('Esta nota não existe mais.');

    conferirArquivo(
      lerDataUrl(dados.arquivo),
      TIPOS_DE_NOTA,
      LIMITE_DA_NOTA,
      'A nota entra como PDF ou imagem.',
    );
    await this.prisma.fotoDaNota.create({
      data: { parteId, foto: dados.arquivo },
    });

    const idFnApagar = parte.conta.idFnApagarIxc;
    if (!idFnApagar) {
      return {
        guardada: true,
        aviso: 'A nota ficou guardada aqui, mas a conta não tem número do IXC para recebê-la lá.',
      };
    }
    try {
      await this.anexarNota(idFnApagar, dados);
      return { guardada: true, aviso: null };
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      return {
        guardada: true,
        aviso: `A nota ficou guardada aqui, mas não subiu para o IXC: ${motivo}`,
      };
    }
  }

  /** As notas guardadas de um título, sem os arquivos. */
  async notasGuardadas(
    filtro: { idFnApagar: number } | { parteId: string },
  ): Promise<NotaGuardada[]> {
    const fotos = await this.prisma.fotoDaNota.findMany({
      where:
        'parteId' in filtro
          ? { parteId: filtro.parteId }
          : { parte: { conta: { idFnApagarIxc: filtro.idFnApagar } } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        createdAt: true,
        parte: {
          select: {
            id: true,
            descricao: true,
            veiculo: { select: { apelido: true } },
            categoria: { select: { nome: true } },
          },
        },
      },
    });
    return fotos
      .filter((f) => f.parte)
      .map((f) => ({
        id: f.id,
        parteId: f.parte!.id,
        createdAt: f.createdAt,
        rotulo:
          [
            [f.parte!.veiculo?.apelido, f.parte!.categoria?.nome].filter(Boolean).join(' · '),
            f.parte!.descricao,
          ]
            .filter(Boolean)
            .join(' — ') || 'Nota',
      }));
  }

  /** O arquivo de uma nota guardada, como chegou: data URL. */
  async notaGuardada(id: string): Promise<{ foto: string }> {
    const f = await this.prisma.fotoDaNota.findUnique({
      where: { id },
      select: { foto: true, parteId: true },
    });
    if (!f?.foto || !f.parteId) throw new NotFoundException('Esta nota não existe mais.');
    return { foto: f.foto };
  }

  /**
   * Dá por pagas as contas que acabaram de ser criadas — aprovação na auditoria
   * e baixa no IXC, na data em que o dinheiro saiu de fato.
   *
   * É o caminho de quem pagou o boleto pelo aplicativo do banco e só depois veio
   * lançar. Sem isto o lançamento nasce em aberto, alguém tem de lembrar de
   * voltar para aprová-lo e baixá-lo, e enquanto isso a conta fica na fila de
   * pagamento como se ainda devesse — que é como o mesmo dinheiro sai duas
   * vezes.
   *
   * Parcelado, todas as parcelas são baixadas: quem marca "já foi paga" num
   * lançamento parcelado está registrando um acerto que já saiu inteiro.
   */
  private async darPorPaga(
    contas: ContaPagar[],
    dto: CriarDespesaDto,
    usuarioNome?: string,
  ): Promise<BaixaDoLancamento> {
    const data =
      dto.dataPagamento ??
      dto.dataVencimento ??
      new Date().toISOString().slice(0, 10);

    const baixa: BaixaDoLancamento = {
      pagas: 0,
      tentadas: contas.length,
      valor: 0,
      data,
      avisos: [],
    };

    for (const [i, conta] of contas.entries()) {
      const comoChamar =
        contas.length > 1 ? `A parcela ${i + 1} de ${contas.length}` : 'A conta';

      if (!conta.idFnApagarIxc) {
        baixa.avisos.push(
          `${comoChamar} não recebeu número do IXC, então não deu para dá-la ` +
            'por paga. Ela continua em aberto lá.',
        );
        continue;
      }

      try {
        const r = await this.pagamentos.pagar(
          conta.idFnApagarIxc,
          {
            contaPagamento: dto.contaPagamento,
            data,
            // Sem histórico próprio: quem monta é a baixa, no formato do
            // IXC ("Pag. Fulano - doc.: 9"). O texto que ia aqui — "Pago
            // antes do lançamento — <observação>" — não é o que o IXC
            // escreve, e um pagamento feito daqui tem de ser indistinguível
            // de um feito na tela dele. A observação já está no título.
            // O dinheiro saiu antes de o título existir: não há pagamento do
            // banco a esperar, nem na conta que ele costuma pagar.
            jaSaiu: true,
          },
          usuarioNome,
        );

        if (r.paga) {
          baixa.pagas += 1;
          baixa.valor += r.valor;
        } else {
          baixa.avisos.push(
            `${comoChamar} foi aprovada no IXC, mas ele não a deu por paga. ` +
              'Confira por lá antes de considerar essa conta quitada.',
          );
        }
        baixa.avisos.push(...r.avisos.map((a) => `${comoChamar}: ${a}`));
      } catch (err) {
        const motivo = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Conta ${conta.id} foi lançada, mas a baixa não saiu: ${motivo}`,
        );
        baixa.avisos.push(
          `${comoChamar} foi lançada no IXC, mas não ficou paga (${motivo}). ` +
            'Pague-a pela lista de contas em aberto.',
        );
      }
    }

    this.logger.log(
      `Lançamento já pago: ${baixa.pagas}/${baixa.tentadas} conta(s) baixadas ` +
        `no IXC em ${data}.`,
    );
    return baixa;
  }

  /**
   * A nota em vezes: uma conta a pagar por parcela no IXC.
   *
   * As parcelas vão uma a uma, e o que já entrou fica de pé se a seguinte
   * falhar. Desfazer as anteriores seria pior: elas já existem no IXC, e o
   * conserto de "faltou a parcela 4" é lançar a 4 — enquanto o de "sumiram as
   * três primeiras" é conferir seis registros do outro lado.
   */
  private async lancarParcelas(
    dto: CriarDespesaDto,
    comum: Record<string, unknown>,
    usuarioId?: string,
  ): Promise<DespesaLancada> {
    const parcelas = dto.parcelas!;
    const criadas: ContaPagar[] = [];
    const avisos: string[] = [];

    for (const [i, parcela] of parcelas.entries()) {
      // "3/6" na observação é o que permite reconhecer a parcela na lista do
      // IXC, onde todas aparecem com o mesmo fornecedor e o mesmo texto. Num
      // consórcio já em andamento a numeração vem pronta da tela, porque ali a
      // primeira a lançar pode ser a 13 de 120.
      const numero = parcela.rotulo || `${i + 1}/${parcelas.length}`;
      const observacao = `${dto.observacao.trim()} (${numero})`.slice(0, 500);

      try {
        const conta = await this.contasPagar.criarDespesa(
          {
            ...(comum as Parameters<
              typeof this.contasPagar.criarDespesa
            >[0]),
            valor: parcela.valor,
            dataVencimento: dataUtc(parcela.dataVencimento),
            observacao,
            codigoBarras: parcela.codigoBarras ?? null,
            documento: parcela.documento ?? dto.documento ?? null,
          },
          usuarioId,
        );
        criadas.push(conta);

        const aviso = await this.etiquetar(
          conta,
          dto.categoriaId ?? null,
          usuarioId,
        );
        if (aviso) avisos.push(`Parcela ${i + 1}: ${aviso}`);
      } catch (err) {
        const motivo = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Parcela ${i + 1}/${parcelas.length} não foi criada: ${motivo}`,
        );
        avisos.push(
          `A parcela ${i + 1} de ${parcelas.length} não foi criada (${motivo}). ` +
            `As ${criadas.length} anteriores já estão no IXC — lance esta ` +
            'de novo sozinha.',
        );
        break;
      }
    }

    if (criadas.length === 0) {
      throw new BadRequestException(
        avisos[0] ?? 'Nenhuma parcela pôde ser criada.',
      );
    }

    return {
      conta: criadas[0],
      contas: criadas,
      avisoCategoria: avisos.length ? avisos.join(' ') : null,
      baixa: null,
    };
  }

  /**
   * A etiqueta só pode ser gravada depois que o IXC devolve o número do título
   * — é por ele que a classificação se liga ao débito, e ele não existe antes
   * do envio.
   *
   * Falhar aqui não derruba o lançamento: a conta já está no IXC e apagá-la
   * para "desfazer" seria arriscar deixar o registro de lá vivo e o daqui não.
   * Quem lançou recebe o aviso e classifica pela lista, em dois cliques.
   */
  private async etiquetar(
    conta: ContaPagar,
    categoriaId: string | null,
    usuarioId?: string,
  ): Promise<string | null> {
    if (!categoriaId) return null;

    if (!conta.idFnApagarIxc) {
      return (
        'A conta não recebeu número do IXC, então a categoria não pôde ser ' +
        'gravada. Assim que o envio for refeito, classifique pela lista.'
      );
    }

    try {
      await this.categorias.classificar(
        conta.idFnApagarIxc,
        categoriaId,
        usuarioId,
      );
      return null;
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Despesa ${conta.id} foi lançada, mas a categoria não ficou: ${motivo}`,
      );
      return `A conta foi lançada no IXC, mas a categoria não ficou (${motivo}). Escolha-a na lista.`;
    }
  }
}

/**
 * "AAAA-MM-DD" → meia-noite em UTC. As datas desta base são gravadas assim e
 * lidas assim na hora de virar "DD/MM/AAAA" para o IXC; converter pelo fuso
 * local faria a conta lançada de madrugada sair com a data do dia anterior.
 */
function dataUtc(iso: string): Date {
  const [ano, mes, dia] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function centavos(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Em reais, com espaço comum depois do "R$": o formato do Node põe ali um
 * espaço que não quebra, e é este texto que vai para a observação do IXC.
 */
function reais(n: number): string {
  return n
    .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    .replace(/\u00a0/g, ' ');
}

function hojeUtc(): Date {
  const agora = new Date();
  return new Date(
    Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate()),
  );
}

/**
 * O que entra como nota de uma conta a pagar.
 *
 * Papel: cupom fotografado, nota digitalizada, print do comprovante. Planilha e
 * documento do Word ficam de fora — o que se anexa aqui é a prova do gasto, e
 * ela vem em imagem ou PDF.
 */
const TIPOS_DE_NOTA = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
]);

/**
 * Teto da nota. Menor que o do RH de propósito: aqui o arquivo ainda atravessa
 * o webservice do IXC, que é a parte lenta e a que costuma desistir.
 */
const LIMITE_DA_NOTA = 8 * 1024 * 1024;

/**
 * O nome com que o arquivo chega ao IXC.
 *
 * Print colado não tem nome nenhum, e um arquivo sem extensão no anexo do IXC
 * não abre em lugar nenhum: quem clica lá recebe um binário sem dono. Então o
 * nome sai daqui quando não veio de fora, e a extensão vem do tipo declarado no
 * próprio arquivo.
 */
function nomeDoAnexo(nome: string | undefined, tipo: string): string {
  const ext = extensaoDoTipo(tipo);
  const limpo = (nome ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9.\-_ ]/g, '')
    .trim()
    .slice(0, 80);

  if (!limpo) {
    const agora = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    return `nota-${agora}.${ext}`;
  }
  return limpo.toLowerCase().endsWith(`.${ext}`) ? limpo : `${limpo}.${ext}`;
}

/** O texto de um campo do IXC, ou nada quando ele vem vazio. */
function textoOuNull(valor: unknown): string | null {
  const s = String(valor ?? '').trim();
  return s || null;
}

/** Uma nota anexada a um título, como a aba "Arquivos" do IXC a lista. */
export interface NotaDoTitulo {
  id: number;
  descricao: string;
  /** "png", "pdf" — é o que decide como o navegador abre o arquivo. */
  extensao: string;
  data: string | null;
  usuario: string | null;
}

const TIPO_POR_EXTENSAO: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
};

/**
 * O primeiro campo da resposta que se pareça com um arquivo em base64.
 *
 * Texto longo, só com o alfabeto do base64 e de tamanho múltiplo de quatro. Um
 * id, uma data ou uma mensagem não passam por essa peneira; um arquivo de
 * verdade, sim.
 */
function acharBase64(valor: unknown): string | null {
  // Duas passadas: a estrita primeiro — o tamanho múltiplo de quatro que um
  // base64 inteiro tem — e, não achando, a frouxa. Arquivo com um byte a mais
  // no fim ainda abre; arquivo nenhum, não.
  return procurarBase64(valor, true) ?? procurarBase64(valor, false);
}

function procurarBase64(valor: unknown, estrito: boolean, fundo = 0): string | null {
  if (typeof valor === 'string') {
    if (valor.length < 100) return null;
    const limpo = valor.includes(',') ? valor.slice(valor.indexOf(',') + 1) : valor;
    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(limpo)) return null;
    return !estrito || limpo.replace(/\s/g, '').length % 4 === 0 ? limpo : null;
  }
  // A resposta às vezes traz o arquivo dentro de `registros`, ou de um objeto
  // por linha: o arquivo pode estar em qualquer galho, e não só na raiz.
  if (fundo > 4 || valor === null || typeof valor !== 'object') return null;
  for (const dentro of Object.values(valor as Record<string, unknown>)) {
    const achado = procurarBase64(dentro, estrito, fundo + 1);
    if (achado) return achado;
  }
  return null;
}

/** O que o IXC disse quando não mandou o arquivo — é o que explica o "não deu". */
function mensagemDoIxc(resposta: Record<string, unknown>): string | null {
  for (const campo of ['message', 'mensagem', 'msg', 'erro', 'error']) {
    const valor = resposta[campo];
    if (typeof valor === 'string' && valor.trim()) return valor.trim().slice(0, 200);
  }
  return null;
}
