import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PDFDocument } from 'pdf-lib';
import { extrairPaginasPdf } from '../pdf/pdf';
import { PrismaService } from '../prisma/prisma.service';
import {
  conferirArquivo,
  DocumentosRhService,
  lerDataUrl,
  soDigitos,
} from './documentos.service';
import {
  aReceberDoRecibo,
  donoNaFolha,
  naoAtualiza,
  type FuncionarioDaFolha,
} from './recibos.a-receber';
import { chaveDoNome, lerRecibos, type ReciboLido } from './recibos.parse';

/** O tipo com que o recibo entra na pasta. Fixo: é o que o mês seguinte procura. */
export const TIPO_RECIBO = 'Recibo de pagamento';

/**
 * A subpasta que recebe os recibos dentro da pasta de cada um.
 *
 * Doze papéis por ano soltos entre o contrato e os exames afogam a pasta de
 * quem tem três anos de casa. A divisória nasce no primeiro recibo e é a mesma
 * em todos os meses seguintes.
 */
export const SUBPASTA_DOS_RECIBOS = 'Recibos de pagamento';

/**
 * O PDF de recibos da folha, separado por pessoa.
 *
 * Todo mês a contabilidade manda um arquivo só com a folha inteira — uma página
 * por empregado. Guardado assim, ele responde "onde está a folha de julho?" e
 * não responde "onde está o recibo do Fulano?", que é a pergunta que se faz
 * dois anos depois, quando ele reclama de um valor.
 *
 * Aqui o arquivo é lido, cortado por dono e posto na pasta de cada um. Nada é
 * gravado antes de alguém conferir: a leitura devolve o que achou e para quem
 * vai, e é a tela que confirma. Um recibo na pasta errada é pior que um recibo
 * fora da pasta.
 */
@Injectable()
export class RecibosDaFolhaService {
  private readonly logger = new Logger(RecibosDaFolhaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documentos: DocumentosRhService,
  ) {}

  /**
   * Lê o PDF e diz o que achou. Não grava nada.
   *
   * Devolve, para cada recibo, a pasta que ele acha ser a dona — por CPF
   * primeiro, que é o que não muda de grafia, e por nome quando não há CPF.
   */
  async analisar(arquivoDataUrl: string) {
    const conteudo = pdfDaDataUrl(arquivoDataUrl);
    const paginas = await extrairPaginasPdf(new Uint8Array(conteudo));
    const leitura = lerRecibos(paginas);

    if (leitura.recibos.length === 0) {
      throw new BadRequestException(
        'Não achei nenhum recibo neste PDF. Ele precisa ser o arquivo de ' +
          'recibos de pagamento da contabilidade, com um empregado por página.',
      );
    }
    if (!leitura.competencia) {
      throw new BadRequestException(
        'Não achei a competência impressa no PDF, e sem ela o recibo entraria ' +
          'na pasta sem dizer de que mês é.',
      );
    }

    const pastas = await this.pastasParaCasar();
    const jaGuardados = await this.prisma.documentoRh.findMany({
      where: { tipo: TIPO_RECIBO, competencia: leitura.competencia },
      select: { pastaId: true, pasta: { select: { paiId: true } } },
    });
    /*
     * O recibo mora na subpasta, e quem a tela mostra é a pasta da pessoa: o
     * "já guardado" tem de subir um nível, ou o mesmo mês entraria de novo a
     * cada vez que o arquivo fosse lido.
     */
    const jaTem = new Set(
      jaGuardados.map((d) => d.pasta.paiId ?? d.pastaId),
    );
    const atualizaAReceber = await this.eDoMesMaisNovo(leitura.competencia);
    const funcionarios = await this.funcionariosDaFolha();

    return {
      competencia: leitura.competencia,
      competenciaEscrita: leitura.competenciaEscrita,
      totalDePaginas: paginas.length,
      paginasSemDono: leitura.paginasSemDono,
      /**
       * O líquido vira o "A receber na folha" ao guardar. Recibo de um mês
       * mais velho que o último separado não troca: o valor de agora é o do
       * mês mais novo.
       */
      atualizaAReceber,
      itens: leitura.recibos.map((r) => {
        const pasta = casar(r, pastas);
        const aReceber = aReceberDoRecibo(
          r.liquido,
          donoNaFolha(r.cpf, pasta?.funcionarioId ?? null, funcionarios),
          atualizaAReceber,
        );
        return {
          ...r,
          pastaId: pasta?.id ?? null,
          pastaNome: pasta?.nome ?? null,
          /** Como esta pasta foi encontrada, para a tela poder discordar. */
          casouPor: pasta?.por ?? null,
          /** Este mês já está guardado nesta pasta: entraria repetido. */
          jaGuardado: pasta ? jaTem.has(pasta.id) : false,
          /** O "A receber na folha" de agora do dono do recibo. */
          aReceberAtual: aReceber.antes,
          /** O que ele passa a ser ao guardar. Null = fica como está. */
          aReceberNovo: aReceber.depois,
          /** Por que não muda, ou por que muda sem a folha usar. */
          aReceberAviso: aReceber.aviso,
        };
      }),
    };
  }

  /**
   * Corta o PDF e guarda cada pedaço na pasta que foi confirmada.
   *
   * O arquivo volta inteiro nesta segunda ida de propósito: guardar o PDF do
   * meio do caminho em algum lugar do servidor entre uma chamada e outra seria
   * inventar estado para economizar 200 KB de rede.
   */
  async guardar(
    arquivoDataUrl: string,
    competencia: string,
    itens: Array<{ paginas: number[]; pastaId: string; nome: string }>,
    arquivoNome: string,
    usuarioId?: string,
  ) {
    const conteudo = pdfDaDataUrl(arquivoDataUrl);
    const original = await PDFDocument.load(conteudo, {
      ignoreEncryption: true,
    });

    /*
     * O líquido de cada recibo é relido do próprio PDF, e não aceito da tela:
     * é dinheiro que vai para a folha, e quem diz quanto é o papel. O CPF
     * também, porque é ele que diz de quem é o dinheiro.
     */
    const leitura = lerRecibos(
      await extrairPaginasPdf(new Uint8Array(conteudo)),
    );
    if (leitura.competencia && leitura.competencia !== competencia) {
      throw new BadRequestException(
        `Este PDF é de ${leitura.competencia.slice(5)}/${leitura.competencia.slice(0, 4)}, ` +
          'e não do mês que a tela mandou. Escolha o arquivo de novo.',
      );
    }
    if (itens.length === 0 && leitura.recibos.length === 0) {
      throw new BadRequestException('Nenhum recibo foi marcado para guardar.');
    }

    /*
     * O lote nasce antes dos documentos porque é ele que os marca.
     *
     * Separar um mês toca vinte e três pastas de uma vez, e o engano (mês
     * errado, arquivo errado) só aparece depois de tudo guardado. Com o lote,
     * desfazer é um clique; sem ele, seria caçar vinte e três documentos em
     * vinte e três pastas diferentes.
     */
    const lote = await this.prisma.loteDeRecibos.create({
      data: {
        competencia,
        arquivoNome: arquivoNome.trim().slice(0, 255) || 'recibos.pdf',
        quantidade: 0,
        criadoPor: usuarioId ?? null,
      },
    });

    const guardados: Array<{ pasta: string; nome: string }> = [];
    const pulados: Array<{ nome: string; motivo: string }> = [];
    /** A pasta que a tela escolheu para cada página — o plano B do dono. */
    const pastaDaPagina = new Map<number, string>();
    const atualizaAReceber = await this.eDoMesMaisNovo(competencia, lote.id);
    const trocados: Array<{
      funcionarioId: string;
      nome: string;
      antes: string | null;
      depois: string;
    }> = [];

    for (const item of itens) {
      const paginas = [...new Set(item.paginas)].sort((a, b) => a - b);
      if (paginas.some((p) => p < 1 || p > original.getPageCount())) {
        pulados.push({ nome: item.nome, motivo: 'página fora do arquivo' });
        continue;
      }

      const pasta = await this.prisma.pastaRh.findUnique({
        where: { id: item.pastaId },
        select: { id: true, nome: true, funcionarioId: true },
      });
      if (!pasta) {
        pulados.push({ nome: item.nome, motivo: 'a pasta não existe mais' });
        continue;
      }
      if (pasta.funcionarioId) {
        for (const p of paginas) pastaDaPagina.set(p, pasta.funcionarioId);
      }

      /*
       * O recibo não entra solto na pasta da pessoa: vai para a divisória dos
       * recibos, criada na primeira vez e reusada em todos os meses seguintes.
       * Pasta que já é a divisória (alguém escolheu a subpasta na mão) fica
       * onde está, para não virar "Recibos" dentro de "Recibos".
       */
      const destinoId =
        pasta.nome.toLowerCase() === SUBPASTA_DOS_RECIBOS.toLowerCase()
          ? pasta.id
          : await this.documentos.garantirSubpasta(
              pasta.id,
              SUBPASTA_DOS_RECIBOS,
            );

      const recorte = await PDFDocument.create();
      const copiadas = await recorte.copyPages(
        original,
        paginas.map((p) => p - 1),
      );
      for (const p of copiadas) recorte.addPage(p);
      const bytes = await recorte.save();

      const mes = competencia.slice(5, 7);
      const ano = competencia.slice(0, 4);
      try {
        await this.prisma.documentoRh.create({
          data: {
            pastaId: destinoId,
            loteId: lote.id,
            titulo: `Recibo de pagamento ${mes}/${ano}`,
            tipo: TIPO_RECIBO,
            competencia,
            // O dia impresso é o do fechamento da folha, que não vem no papel;
            // o mês é o que identifica o documento, e ele está na competência.
            emitidoEm: null,
            arquivoNome: `recibo-${competencia}-${arquivoAmigavel(item.nome)}.pdf`,
            arquivoTipo: 'application/pdf',
            arquivoTamanho: bytes.length,
            // O `save()` do pdf-lib devolve `Uint8Array` sobre um buffer
            // genérico, e a coluna `Bytes` do Prisma quer um sobre
            // `ArrayBuffer`. Copiar aqui é o preço de não brigar com a
            // tipagem por um documento de algumas centenas de KB.
            arquivo: new Uint8Array(bytes),
            criadoPor: usuarioId ?? null,
          },
        });
        guardados.push({ pasta: pasta.nome, nome: item.nome });
      } catch (err) {
        /*
         * O índice único (pasta + tipo + competência) é a rede de segurança:
         * subir o mesmo PDF duas vezes é o engano mais provável deste fluxo, e
         * ele não pode encher a pasta de recibos repetidos do mesmo mês.
         */
        const repetido =
          err instanceof Error && /Unique constraint/i.test(err.message);
        pulados.push({
          nome: item.nome,
          motivo: repetido
            ? `já havia um recibo de ${mes}/${ano} na pasta`
            : 'o banco recusou',
        });
        if (!repetido) this.logger.warn(`Recibo de ${item.nome}: ${err}`);
        continue;
      }
    }

    /*
     * O "A receber na folha": de todo recibo do PDF, e não só dos que entraram
     * na pasta agora. O recibo já guardado no mês, a linha desmarcada e a pasta
     * feita à mão eram três jeitos de o valor ficar o velho sem aviso — e o
     * valor é da folha, não da pasta. O líquido dele é o que era digitado à mão
     * a partir deste papel.
     */
    const semAtualizar: Array<{ nome: string; motivo: string }> = [];
    const semCarteira: string[] = [];
    if (atualizaAReceber) {
      const funcionarios = await this.funcionariosDaFolha();
      const pastas = await this.pastasParaCasar();
      const jaTrocado = new Set<string>();
      for (const r of leitura.recibos) {
        const daPasta =
          pastaDaPagina.get(r.paginas[0]) ?? casar(r, pastas)?.funcionarioId ?? null;
        const a = aReceberDoRecibo(
          r.liquido,
          donoNaFolha(r.cpf, daPasta, funcionarios),
          true,
        );
        if (naoAtualiza(a.motivo)) {
          semAtualizar.push({ nome: r.nome, motivo: a.aviso! });
          continue;
        }
        if (a.motivo === 'sem-carteira') semCarteira.push(r.nome);
        const id = a.funcionarioId;
        if (a.depois === null || !id || jaTrocado.has(id)) continue;
        try {
          await this.prisma.funcionario.update({
            where: { id },
            data: { valorAReceberFolha: new Prisma.Decimal(a.depois) },
          });
          jaTrocado.add(id);
          trocados.push({
            funcionarioId: id,
            nome: r.nome,
            antes: a.antes === null ? null : a.antes.toFixed(2),
            depois: a.depois.toFixed(2),
          });
        } catch (err) {
          semAtualizar.push({ nome: r.nome, motivo: 'o banco recusou' });
          this.logger.warn(`A receber de ${r.nome}: ${err}`);
        }
      }
    }

    /*
     * Lote sem nada dentro não vira linha no histórico: um "desfazer" que não
     * desfaz nada é ruído na única lista que serve para consertar engano. O
     * lote que só trocou o "A receber" fica — é ele que o devolve.
     */
    if (guardados.length === 0 && trocados.length === 0) {
      await this.prisma.loteDeRecibos.delete({ where: { id: lote.id } });
    } else {
      await this.prisma.loteDeRecibos.update({
        where: { id: lote.id },
        data: {
          quantidade: guardados.length,
          aReceberTrocado: trocados.map(({ funcionarioId, antes, depois }) => ({
            funcionarioId,
            antes,
            depois,
          })),
        },
      });
    }

    this.logger.log(
      `Recibos de ${competencia}: ${guardados.length} guardado(s), ` +
        `${pulados.length} pulado(s), ${trocados.length} "a receber" trocado(s).`,
    );
    return {
      competencia,
      loteId: guardados.length > 0 || trocados.length > 0 ? lote.id : null,
      guardados,
      pulados,
      /** De quem o "A receber na folha" passou a ser o líquido do recibo. */
      aReceber: trocados.map(({ nome, antes, depois }) => ({ nome, antes, depois })),
      /** Recibos cujo dono ficou com o valor velho, e por quê. */
      semAtualizar,
      /** Atualizados, mas sem carteira assinada: a folha não usa o valor. */
      semCarteira,
      atualizaAReceber,
    };
  }

  /**
   * O histórico: cada vez que um arquivo do mês foi separado.
   *
   * Curto de propósito — o que se procura aqui é o lote de ontem, o que acabou
   * de sair errado. O de dois anos atrás não tem mais o que desfazer.
   */
  async lotes() {
    const lotes = await this.prisma.loteDeRecibos.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { _count: { select: { documentos: true } } },
    });

    return lotes.map((l) => ({
      id: l.id,
      competencia: l.competencia,
      arquivoNome: l.arquivoNome,
      /** Quantos entraram naquele dia. */
      quantidade: l.quantidade,
      /**
       * Quantos ainda estão guardados. Menor que o de cima = alguém já apagou
       * documento à mão, e o desfazer vai achar menos do que o lote diz.
       */
      guardados: l._count.documentos,
      criadoPor: l.criadoPor,
      createdAt: l.createdAt,
    }));
  }

  /**
   * Desfaz um lote: apaga de todas as pastas o que ele guardou.
   *
   * As pastas ficam. Uma divisória vazia não atrapalha ninguém, e apagá-la
   * levaria junto o que alguém tivesse posto lá dentro no meio-tempo.
   */
  async desfazer(loteId: string) {
    const lote = await this.prisma.loteDeRecibos.findUnique({
      where: { id: loteId },
      include: { _count: { select: { documentos: true } } },
    });
    if (!lote) {
      throw new BadRequestException('Este lançamento não existe mais.');
    }

    const { count } = await this.prisma.documentoRh.deleteMany({
      where: { loteId },
    });

    /*
     * O "A receber na folha" volta ao que era, de quem ainda está com o valor
     * que este lote pôs. Quem foi mexido à mão depois fica como está: desfazer
     * o lote não pode apagar a correção de alguém.
     */
    let devolvidos = 0;
    const trocados = Array.isArray(lote.aReceberTrocado)
      ? (lote.aReceberTrocado as Array<{
          funcionarioId: string;
          antes: string | null;
          depois: string;
        }>)
      : [];
    for (const t of trocados) {
      const { count: mudou } = await this.prisma.funcionario.updateMany({
        where: { id: t.funcionarioId, valorAReceberFolha: new Prisma.Decimal(t.depois) },
        data: {
          valorAReceberFolha: t.antes === null ? null : new Prisma.Decimal(t.antes),
        },
      });
      devolvidos += mudou;
    }

    await this.prisma.loteDeRecibos.delete({ where: { id: loteId } });

    this.logger.log(
      `Lote de recibos de ${lote.competencia} desfeito: ${count} documento(s) apagados, ` +
        `${devolvidos} "a receber" devolvido(s).`,
    );
    return { competencia: lote.competencia, apagados: count, devolvidos };
  }

  /**
   * Este mês é o mais novo já separado — ou mais novo que todos? Só aí o
   * líquido troca o "A receber na folha": guardar agora o PDF de julho, que
   * ficou esquecido, não pode desfazer o valor de setembro.
   */
  private async eDoMesMaisNovo(competencia: string, foraDoLote?: string): Promise<boolean> {
    const maisNovo = await this.prisma.loteDeRecibos.findFirst({
      where: foraDoLote ? { id: { not: foraDoLote } } : {},
      orderBy: { competencia: 'desc' },
      select: { competencia: true },
    });
    return !maisNovo || competencia >= maisNovo.competencia;
  }

  /** O cadastro da folha, com o que serve para achar o dono de um recibo. */
  private async funcionariosDaFolha(): Promise<FuncionarioDaFolha[]> {
    const funcionarios = await this.prisma.funcionario.findMany({
      select: {
        id: true,
        nome: true,
        cpfCnpj: true,
        ativo: true,
        isentoIcms: true,
        carteiraAssinada: true,
        valorAReceberFolha: true,
      },
    });
    return funcionarios.map((f) => ({
      id: f.id,
      nome: f.nome,
      cpf: soDigitos(f.cpfCnpj),
      ativo: f.ativo,
      naFolha: f.isentoIcms,
      carteiraAssinada: f.carteiraAssinada,
      aReceber: f.valorAReceberFolha === null ? null : Number(f.valorAReceberFolha),
    }));
  }

  /** As pastas com o que serve para reconhecer o dono de um recibo. */
  private async pastasParaCasar(): Promise<PastaParaCasar[]> {
    const pastas = await this.prisma.pastaRh.findMany({
      where: { daEmpresa: false },
      include: {
        funcionario: {
          select: { nome: true, apelido: true, cpfCnpj: true },
        },
      },
    });

    return pastas.map((p) => ({
      id: p.id,
      nome: p.funcionario?.nome ?? p.nome,
      funcionarioId: p.funcionarioId,
      cpf: p.cpf || soDigitos(p.funcionario?.cpfCnpj),
      nomes: [p.nome, p.funcionario?.nome, p.funcionario?.apelido]
        .filter((n): n is string => !!n)
        .map(chaveDoNome),
    }));
  }
}

interface PastaParaCasar {
  id: string;
  nome: string;
  /** O funcionário da pasta, quando ela é de um. */
  funcionarioId: string | null;
  cpf: string;
  nomes: string[];
}

/**
 * De quem é este recibo.
 *
 * CPF primeiro: é o que a contabilidade e o cadastro escrevem igual. O nome é o
 * plano B, e só vale inteiro — "José da Silva" não casa com "José da Silva
 * Júnior", que é outra pessoa e provavelmente trabalha na mesma casa.
 */
function casar(
  recibo: ReciboLido,
  pastas: PastaParaCasar[],
): (PastaParaCasar & { por: 'cpf' | 'nome' }) | null {
  if (recibo.cpf) {
    const porCpf = pastas.find((p) => p.cpf && p.cpf === recibo.cpf);
    if (porCpf) return { ...porCpf, por: 'cpf' };
  }

  const chave = chaveDoNome(recibo.nome);
  const iguais = pastas.filter((p) => p.nomes.includes(chave));
  // Dois homônimos: quem decide é quem está olhando, não o desempate.
  if (iguais.length === 1) {
    return { ...iguais[0], por: 'nome' };
  }
  return null;
}

/** O PDF de dentro da data URL, conferido como PDF e como tamanho. */
function pdfDaDataUrl(url: string): Buffer {
  const { conteudo, tipoDoArquivo } = lerDataUrl(url);
  conferirArquivo(conteudo, tipoDoArquivo);
  if (tipoDoArquivo !== 'application/pdf') {
    throw new BadRequestException(
      'O arquivo de recibos precisa ser o PDF que a contabilidade manda.',
    );
  }
  return conteudo;
}

/** O nome da pessoa como pedaço de nome de arquivo. */
function arquivoAmigavel(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 60);
}
