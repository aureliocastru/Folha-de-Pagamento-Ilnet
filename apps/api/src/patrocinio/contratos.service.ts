import {
  BadRequestException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ModoAssinatura, OrigemDoContrato } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { conferirArquivo, extensaoDoTipo, lerDataUrl } from '../arquivos/data-url';
import { AssinarDto } from '../assinaturas/dto/assinatura.dto';
import { ConfigFinanceiraService } from '../financeiro/config-financeira.service';
import { PrismaService } from '../prisma/prisma.service';
import { gerarContratoPdf } from './contrato.pdf';
import { CONTRATO_PADRAO } from './contrato.texto';
import { GuardarEscaneadoDto } from './dto/patrocinio.dto';
import { CONTRATO_NA_LISTA, LIMITE_DO_ARQUIVO } from './patrocinio.service';

/**
 * Quanto tempo o link fica de pé sem ninguém assinar. Mais que a semana do
 * recibo da diária: o recibo se assina na hora em que o dinheiro muda de mão,
 * e o contrato a pessoa lê com calma — às vezes passa pelo pai, pelo técnico.
 */
export const VALIDADE_DO_LINK_DIAS = 15;

/** O papel escaneado: PDF ou foto. */
const TIPOS_DO_ESCANEADO = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
]);

/**
 * O contrato como a tela pública o mostra: o que a pessoa precisa ler para
 * saber o que está assinando, e nada do cadastro além disso — a página abre
 * sem login.
 */
export interface ContratoPublico {
  empresa: { nome: string; cnpj: string | null };
  patrocinado: { nome: string; cpfCnpj: string | null; projeto: string | null };
  /** O nome que a tela sugere para quem assina: o responsável, ou o próprio. */
  quemAssina: string;
  valorMensal: string | null;
  inicio: Date | null;
  fim: Date | null;
  texto: string;
  /** Já assinado: a tela vira comprovante em vez de formulário. */
  assinado: boolean;
  assinadoEm: Date | null;
  assinaturaPng: string | null;
  nomeAssinante: string | null;
  modo: ModoAssinatura;
}

/**
 * Os contratos de patrocínio: o link que o patrocinado novo assina na tela, e
 * o papel escaneado do patrocínio de antes.
 *
 * O link segue o desenho do recibo da diária (`AssinaturasService`), com uma
 * diferença de propósito: contrato assinado não se coleta de novo. Renovar é
 * outro contrato, com outra data — e o de antes continua guardado, porque ele
 * é o que valeu no período dele.
 */
@Injectable()
export class ContratosDePatrocinioService {
  private readonly logger = new Logger(ContratosDePatrocinioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigFinanceiraService,
  ) {}

  /**
   * Abre o link de assinatura — ou renova o que já estava aberto.
   *
   * O contrato é montado agora e congelado: o texto padrão de hoje, o nome, o
   * valor e a vigência do cadastro, e quem patrocina. Corrigir o cadastro
   * depois não muda o que a pessoa leu; para isso, gera-se o link de novo
   * antes de ela assinar.
   *
   * Havendo um link aberto (ninguém assinou), ele é reaproveitado com outro
   * token: é o "perdi o link, manda de novo", e também o "corrigi o valor".
   * Duas vias abertas para o mesmo patrocinado só confundiriam quem recebe.
   */
  async gerarLink(patrocinadoId: string, usuarioId?: string) {
    const p = await this.prisma.patrocinado.findUnique({
      where: { id: patrocinadoId },
      include: {
        contratos: {
          where: { origem: OrigemDoContrato.LINK, assinadoEm: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true },
        },
      },
    });
    if (!p) throw new NotFoundException('Patrocinado não encontrado.');

    const cfg = await this.config.obter();
    const retrato = {
      token: novoToken(),
      expiraEm: daquiADias(VALIDADE_DO_LINK_DIAS),
      texto: CONTRATO_PADRAO,
      nomePatrocinado: p.nome,
      cpfPatrocinado: p.cpfCnpj,
      projeto: p.projeto,
      valorMensal: p.valorMensal,
      inicio: p.inicio,
      fim: p.fim,
      empresaNome: cfg.empresaNome.trim() || 'ILNET',
      empresaCnpj: cfg.empresaCnpj.trim() || null,
      criadoPor: usuarioId ?? null,
    };

    const aberto = p.contratos[0];
    const contrato = aberto
      ? await this.prisma.contratoDePatrocinio.update({
          where: { id: aberto.id },
          data: retrato,
          select: CONTRATO_NA_LISTA,
        })
      : await this.prisma.contratoDePatrocinio.create({
          data: { ...retrato, patrocinadoId, origem: OrigemDoContrato.LINK },
          select: CONTRATO_NA_LISTA,
        });

    this.logger.log(
      `Link de contrato ${aberto ? 'renovado' : 'aberto'} para o patrocinado ${patrocinadoId} ` +
        `(contrato ${contrato.id}).`,
    );
    return contrato;
  }

  /**
   * Guarda o contrato físico de um patrocínio que já existia antes do link.
   *
   * Conta como assinado na hora: o papel existe e foi assinado à mão. A data é
   * a escrita nele, quando se sabe.
   */
  async guardarEscaneado(patrocinadoId: string, dto: GuardarEscaneadoDto, usuarioId?: string) {
    const p = await this.prisma.patrocinado.findUnique({ where: { id: patrocinadoId } });
    if (!p) throw new NotFoundException('Patrocinado não encontrado.');

    const arquivo = lerDataUrl(dto.arquivo);
    conferirArquivo(
      arquivo,
      TIPOS_DO_ESCANEADO,
      LIMITE_DO_ARQUIVO,
      'O contrato escaneado entra em PDF ou como foto.',
    );

    const contrato = await this.prisma.contratoDePatrocinio.create({
      data: {
        patrocinadoId,
        origem: OrigemDoContrato.ESCANEADO,
        nomePatrocinado: p.nome,
        assinadoEm: dto.assinadoEm ? new Date(`${dto.assinadoEm}T12:00:00.000Z`) : null,
        arquivoNome: dto.arquivoNome.trim(),
        arquivoTipo: arquivo.tipo,
        arquivoTamanho: arquivo.conteudo.length,
        arquivo: new Uint8Array(arquivo.conteudo),
        criadoPor: usuarioId ?? null,
      },
      select: CONTRATO_NA_LISTA,
    });
    this.logger.log(`Contrato escaneado guardado no patrocinado ${patrocinadoId} (${contrato.id}).`);
    return contrato;
  }

  /** Um contrato, para a janela que espera a assinatura chegar. */
  async doContrato(id: string) {
    const c = await this.prisma.contratoDePatrocinio.findUnique({
      where: { id },
      select: { ...CONTRATO_NA_LISTA, assinaturaPng: true },
    });
    if (!c) throw new NotFoundException('Contrato não encontrado.');
    return c;
  }

  /**
   * O arquivo do contrato: o escaneado como chegou, ou o assinado pelo link
   * montado em PDF a partir do retrato.
   */
  async paraBaixar(id: string): Promise<{ nome: string; tipo: string; conteudo: Buffer }> {
    const c = await this.prisma.contratoDePatrocinio.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Contrato não encontrado.');

    if (c.origem === OrigemDoContrato.ESCANEADO) {
      return {
        nome: c.arquivoNome ?? `contrato-${c.id}.${extensaoDoTipo(c.arquivoTipo ?? '')}`,
        tipo: c.arquivoTipo ?? 'application/octet-stream',
        conteudo: Buffer.from(c.arquivo ?? new Uint8Array()),
      };
    }

    if (!c.assinadoEm || !c.assinaturaPng) {
      throw new BadRequestException(
        'Este contrato ainda não foi assinado — não há o que imprimir.',
      );
    }

    const pdf = await gerarContratoPdf({
      id: c.id,
      empresa: { nome: c.empresaNome ?? 'ILNET', cnpj: c.empresaCnpj },
      patrocinado: {
        nome: c.nomePatrocinado ?? '',
        cpfCnpj: c.cpfPatrocinado,
        projeto: c.projeto,
      },
      valorMensal: c.valorMensal ? Number(c.valorMensal) : null,
      inicio: c.inicio,
      fim: c.fim,
      texto: c.texto ?? CONTRATO_PADRAO,
      assinadoEm: c.assinadoEm,
      assinaturaPng: c.assinaturaPng,
      nomeAssinante: c.nomeAssinante ?? c.nomePatrocinado ?? '',
      modo: c.modo,
      ip: c.ip,
      userAgent: c.userAgent,
    });
    return {
      nome: `contrato-patrocinio-${paraNomeDeArquivo(c.nomePatrocinado ?? c.id)}.pdf`,
      tipo: 'application/pdf',
      conteudo: pdf,
    };
  }

  /**
   * Tira um contrato da ficha: o link que não serve mais, ou o escaneado que
   * entrou errado. O assinado pelo link fica — ele é a prova do que a pessoa
   * aceitou, e quem o apagasse apagaria a única via.
   */
  async remover(id: string): Promise<void> {
    const c = await this.prisma.contratoDePatrocinio.findUnique({
      where: { id },
      select: { id: true, origem: true, assinadoEm: true },
    });
    if (!c) throw new NotFoundException('Contrato não encontrado.');
    if (c.origem === OrigemDoContrato.LINK && c.assinadoEm) {
      throw new BadRequestException(
        'Contrato assinado não se apaga: ele é a prova do que foi combinado. ' +
          'Para renovar, gere um contrato novo.',
      );
    }
    await this.prisma.contratoDePatrocinio.delete({ where: { id } });
  }

  // --- De quem assina (público, só com o link) ---

  /**
   * Abre o link. Já assinado não é erro: é o comprovante — quem abrir de novo
   * vê o que assinou, em vez de uma tela quebrada.
   */
  async abrirPorToken(token: string): Promise<ContratoPublico> {
    const c = await this.buscarPorToken(token);
    if (!c.assinadoEm && c.expiraEm && c.expiraEm < new Date()) {
      throw new GoneException('Este link venceu. Peça um novo à ILNET.');
    }

    return {
      empresa: { nome: c.empresaNome ?? 'ILNET', cnpj: c.empresaCnpj },
      patrocinado: {
        nome: c.nomePatrocinado ?? c.patrocinado.nome,
        cpfCnpj: c.cpfPatrocinado,
        projeto: c.projeto,
      },
      quemAssina: c.patrocinado.responsavel?.trim() || c.nomePatrocinado || c.patrocinado.nome,
      valorMensal: c.valorMensal?.toString() ?? null,
      inicio: c.inicio,
      fim: c.fim,
      texto: c.texto ?? CONTRATO_PADRAO,
      assinado: c.assinadoEm !== null,
      assinadoEm: c.assinadoEm,
      assinaturaPng: c.assinaturaPng,
      nomeAssinante: c.nomeAssinante,
      modo: c.modo,
    };
  }

  /**
   * Guarda a assinatura. Uma vez só: a gravação é condicional — só pega o
   * contrato com este token e ainda sem assinatura —, então dois toques no
   * botão, ou o link trocado lá dentro no meio da leitura, não viram duas
   * assinaturas nem uma assinatura num texto que a pessoa não leu.
   */
  async assinar(
    token: string,
    dto: AssinarDto,
    origem: { ip?: string; userAgent?: string },
  ): Promise<ContratoPublico> {
    const c = await this.buscarPorToken(token);
    if (c.assinadoEm) throw new BadRequestException('Este contrato já foi assinado.');
    if (c.expiraEm && c.expiraEm < new Date()) {
      throw new GoneException('Este link venceu. Peça um novo à ILNET.');
    }

    const r = await this.prisma.contratoDePatrocinio.updateMany({
      where: { id: c.id, token, assinadoEm: null },
      data: {
        assinaturaPng: dto.assinatura,
        assinadoEm: new Date(),
        modo: dto.modo ?? ModoAssinatura.DESENHADA,
        nomeAssinante:
          dto.nome?.trim() || c.patrocinado.responsavel?.trim() || c.nomePatrocinado || c.patrocinado.nome,
        ip: origem.ip?.slice(0, 60) ?? null,
        userAgent: origem.userAgent?.slice(0, 300) ?? null,
      },
    });
    if (r.count === 0) {
      throw new BadRequestException(
        'Este link acabou de ser trocado ou assinado. Abra o link mais recente.',
      );
    }

    this.logger.log(`Contrato de patrocínio ${c.id} assinado pelo link.`);
    return this.abrirPorToken(token);
  }

  private async buscarPorToken(token: string) {
    const c = await this.prisma.contratoDePatrocinio.findUnique({
      where: { token },
      include: { patrocinado: { select: { nome: true, responsavel: true } } },
    });
    if (!c || c.origem !== OrigemDoContrato.LINK) {
      throw new NotFoundException(
        'Link de contrato não encontrado. Ele pode ter sido substituído por um novo.',
      );
    }
    return c;
  }
}

/** O segredo da URL: 32 bytes sorteados, como o do recibo da diária. */
function novoToken(): string {
  return randomBytes(32).toString('base64url');
}

function daquiADias(dias: number): Date {
  return new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
}

/** "Futsal Unidos" → "futsal-unidos", achável na pasta de downloads. */
export function paraNomeDeArquivo(nome: string): string {
  return (
    nome
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'contrato'
  );
}
