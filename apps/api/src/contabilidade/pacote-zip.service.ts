import { Injectable, Logger } from '@nestjs/common';
import type { ItemDoPacote } from '@prisma/client';
import { Readable } from 'node:stream';
import { ZipFile } from 'yazl';
import { lerDataUrl, extensaoDoTipo, tipoPeloConteudo } from '../arquivos/data-url';
import { gerarReciboPdf } from '../assinaturas/recibo.pdf';
import { DespesasService } from '../contas-abertas/despesas.service';
import { PrismaService } from '../prisma/prisma.service';
import { limparNome, semRepetir } from '../rh/pasta-em-zip.service';
import { ConfiguracaoContabilService } from './configuracao.service';
import { diaBr } from './ixc-leitura';
import { pastaDoItem } from './itens';
import type { DadosDasSaidas } from './leitor.service';
import { PacoteContabilService, type ItemNaTela } from './pacote.service';
import { montarPlanilha, type Aba } from './planilha';
import { relatorioDoCaixaFisico, relatorioDoSaldoDoCaixa, type CaixaNoPeriodo } from './relatorios/caixa';
import {
  planilhaDePagamentos,
  relatorioDeDescontos,
  type Comprovante,
  type Pagamento,
  type SituacaoDoComprovante,
} from './relatorios/pagamentos';
import type { Relatorio } from './relatorios/relatorio';

/** A situação do item, como o índice do zip a escreve. */
const SITUACAO: Record<string, string> = {
  pronto: 'Pronto',
  atencao: 'Pronto, com observação',
  nao_teve: 'Não teve no período',
  falta: 'FALTA',
  lendo: 'Lendo o IXC',
  erro: 'ERRO na leitura',
};

/**
 * O pacote do período num zip só: uma pasta por item do papel, com o número
 * dele, e dentro o que a contabilidade pediu — a planilha lida do IXC, o que
 * veio do banco, e o papel de cada pagamento.
 *
 * Zip e não rar: o Windows abre zip sem programa nenhum, e o escritório do
 * outro lado também. Sem compressão nos arquivos que já são comprimidos (PDF,
 * foto) — ver a pasta do RH, que faz o mesmo.
 */
@Injectable()
export class PacoteZipService {
  private readonly logger = new Logger(PacoteZipService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pacotes: PacoteContabilService,
    private readonly configuracao: ConfiguracaoContabilService,
    private readonly despesas: DespesasService,
  ) {}

  // -------------------------------------------------------------------------
  // A planilha de um item
  // -------------------------------------------------------------------------

  /** As abas de um item, prontas para virar .xlsx. Null = o item não tem planilha. */
  async abasDoItem(pacoteId: string, item: number): Promise<{ nome: string; abas: Aba[] } | null> {
    const pacote = await this.prisma.pacoteContabil.findUnique({ where: { id: pacoteId } });
    if (!pacote) return null;
    const de = pacote.de.toISOString().slice(0, 10);
    const ate = pacote.ate.toISOString().slice(0, 10);
    const periodo = `${diaBr(de).replace(/\//g, '-')} a ${diaBr(ate).replace(/\//g, '-')}`;
    const linhas = await this.prisma.itemDoPacote.findMany({ where: { pacoteId } });
    const linha = (n: number, chave = '') => linhas.find((l) => l.item === n && l.chave === chave);
    const relatorio = (l: ItemDoPacote | undefined) => (l?.dados as { relatorio?: Relatorio } | null)?.relatorio ?? null;

    if ([5, 6, 7, 12, 15, 16, 17, 19].includes(item)) {
      const r = relatorio(linha(item));
      return r ? { nome: r.arquivo, abas: r.abas } : null;
    }

    if ([8, 13, 14, 18, 20].includes(item)) {
      const saidas = linha(8)?.dados as DadosDasSaidas | null | undefined;
      if (!saidas) return null;
      const lidoEm = new Date(saidas.lidoEm);
      if (item === 20) {
        const r = relatorioDeDescontos({ de, ate, lidoEm, pagamentos: saidas.pagamentos });
        return { nome: r.arquivo, abas: r.abas };
      }
      const cfg = await this.configuracao.obter();
      const lista =
        item === 8 ? saidas.pagamentos : this.pacotes.recorte(saidas.pagamentos, item === 13 ? 'lucros' : item === 14 ? 'link' : 'doacoes', cfg);
      const comprovantes = await this.pacotes.comprovantes(pacoteId, saidas);
      const titulo =
        item === 8 ? 'Pagamentos do período' : item === 13 ? 'Distribuição de lucros' : item === 14 ? 'Compra de link' : 'Doações';
      return {
        nome: `${titulo} ${periodo}`,
        abas: planilhaDePagamentos({ titulo, de, ate, lidoEm, pagamentos: lista, comprovantes }),
      };
    }

    if (item === 9) {
      const contas = linhas.filter((l) => l.item === 9 && l.chave.startsWith('conta:') && relatorio(l));
      if (contas.length === 0) return null;
      // Uma planilha com todas as contas: cada conta em abas com o nome dela.
      const abas = contas.flatMap((l) => {
        const r = relatorio(l)!;
        const conta = r.arquivo.replace(/^Conciliacao /, '');
        return r.abas.map((a) => ({ ...a, nome: `${conta.slice(0, 14)} - ${a.nome}` }));
      });
      return { nome: `Conciliacao bancaria ${periodo}`, abas };
    }

    if (item === 10 || item === 11) {
      const caixas = this.pacotes.caixasComInformado(linha);
      if (!caixas) return null;
      const r =
        item === 10 ? relatorioDoCaixaFisico({ de, ate, caixas }) : relatorioDoSaldoDoCaixa({ ate, caixas });
      return { nome: r.arquivo, abas: r.abas };
    }

    return null;
  }

  async planilhaDoItem(pacoteId: string, item: number): Promise<{ nome: string; conteudo: Buffer } | null> {
    const abas = await this.abasDoItem(pacoteId, item);
    if (!abas) return null;
    return { nome: `${limparNome(abas.nome)}.xlsx`, conteudo: await montarPlanilha(abas.abas) };
  }

  // -------------------------------------------------------------------------
  // O zip inteiro
  // -------------------------------------------------------------------------

  async montar(pacoteId: string): Promise<{ nome: string; corpo: Readable }> {
    const tela = await this.pacotes.abrirNaTela(pacoteId);
    const zip = new ZipFile();
    const saida = zip.outputStream as unknown as Readable;
    const nome = `Contabilidade ${diaBr(tela.de).replace(/\//g, '-')} a ${diaBr(tela.ate).replace(/\//g, '-')}.zip`;

    // Escrito por fora do `await`: o download começa enquanto os arquivos
    // ainda são lidos do banco e do IXC. Ver a pasta do RH.
    void this.encher(zip, pacoteId, tela.itens, tela.de, tela.ate).catch((err) => {
      this.logger.error(`Zip do pacote ${pacoteId} falhou: ${String(err)}`);
      saida.destroy(err instanceof Error ? err : new Error(String(err)));
    });

    await this.pacotes.marcarBaixado(pacoteId);
    return { nome, corpo: saida };
  }

  private async encher(zip: ZipFile, pacoteId: string, itens: ItemNaTela[], de: string, ate: string): Promise<void> {
    const usados = new Set<string>();
    const incluir = (caminho: string, conteudo: Buffer, comprimir = false) =>
      zip.addBuffer(conteudo, semRepetir(caminho, usados), { compress: comprimir });

    // O índice primeiro: é o que se abre para saber o que tem dentro.
    incluir(
      `00 - Situacao do pacote ${diaBr(de).replace(/\//g, '-')} a ${diaBr(ate).replace(/\//g, '-')}.xlsx`,
      await montarPlanilha([
        {
          nome: 'Situação',
          cabecalho: [
            `Documentação mensal — ${diaBr(de)} a ${diaBr(ate)}`,
            `Montado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`,
          ],
          colunas: [
            { titulo: 'Item', tipo: 'inteiro', largura: 6 },
            { titulo: 'O que é', tipo: 'texto', largura: 48 },
            { titulo: 'Situação', tipo: 'texto', largura: 22 },
            { titulo: 'Observação', tipo: 'texto', largura: 70 },
          ],
          linhas: itens.map((i) => [
            i.numero,
            i.titulo,
            SITUACAO[i.estado] ?? i.estado,
            [...i.pendencias, ...i.avisos, i.naoTeve && i.observacao ? i.observacao : ''].filter(Boolean).join(' '),
          ]),
        },
      ]),
      true,
    );

    const linha = await this.prisma.itemDoPacote.findUnique({
      where: { pacoteId_item_chave: { pacoteId, item: 8, chave: '' } },
    });
    const saidas = (linha?.dados ?? null) as DadosDasSaidas | null;
    const comprovantes = saidas ? await this.pacotes.comprovantes(pacoteId, saidas) : new Map<number, SituacaoDoComprovante>();
    const cfg = await this.configuracao.obter();

    for (const item of itens) {
      const pasta = `${limparNome(pastaDoItem(item.numero))}/`;

      if (item.estado === 'nao_teve') {
        incluir(
          `${pasta}Nao teve no periodo.txt`,
          Buffer.from(`Item ${item.numero} — ${item.titulo}\r\nNão teve no período de ${diaBr(de)} a ${diaBr(ate)}.\r\n${item.observacao ?? ''}\r\n`, 'utf8'),
          true,
        );
      }

      const planilha = await this.planilhaDoItem(pacoteId, item.numero);
      if (planilha) incluir(`${pasta}${planilha.nome}`, planilha.conteudo, true);

      // O que veio de fora: cada arquivo com o nome da vaga na frente.
      for (const vaga of item.vagas) {
        for (const a of vaga.arquivos) {
          const conteudo = await this.prisma.arquivoContabil.findUnique({ where: { id: a.id }, select: { conteudo: true } });
          if (!conteudo) continue;
          const prefixo = [vaga.grupo, item.numero === 1 ? null : vaga.rotulo].filter(Boolean).join(' - ');
          incluir(`${pasta}${limparNome(prefixo ? `${prefixo} - ${a.nome}` : a.nome)}`, Buffer.from(conteudo.conteudo));
        }
      }

      // Os comprovantes dos pagamentos, na pasta de cada lista.
      if (saidas && [8, 13, 14, 18].includes(item.numero)) {
        const lista =
          item.numero === 8
            ? saidas.pagamentos
            : this.pacotes.recorte(saidas.pagamentos, item.numero === 13 ? 'lucros' : item.numero === 14 ? 'link' : 'doacoes', cfg);
        for (const p of lista) {
          const s = comprovantes.get(p.idFnApagar);
          for (const [n, c] of (s?.comprovantes ?? []).entries()) {
            const arquivo = await this.lerComprovante(c).catch((e: unknown) => {
              this.logger.warn(`Comprovante ${c.origem}/${c.id} do título ${p.idFnApagar} não veio: ${String(e)}`);
              return null;
            });
            if (!arquivo) continue;
            incluir(`${pasta}Comprovantes/${nomeDoComprovante(p, n, arquivo.extensao)}`, arquivo.conteudo);
          }
        }
      }
    }

    zip.end();
  }

  /** O conteúdo de um comprovante, venha de onde vier. */
  async lerComprovante(c: Comprovante): Promise<{ conteudo: Buffer; tipo: string; extensao: string } | null> {
    switch (c.origem) {
      case 'pacote': {
        const a = await this.prisma.arquivoContabil.findUnique({ where: { id: c.id } });
        if (!a) return null;
        const extensao = (/\.([a-z0-9]{1,5})$/i.exec(a.nome)?.[1] ?? extensaoDoTipo(a.tipo)).toLowerCase();
        return { conteudo: Buffer.from(a.conteudo), tipo: a.tipo, extensao };
      }
      case 'caixa':
      case 'conta': {
        const f = await this.prisma.fotoDaNota.findUnique({ where: { id: c.id }, select: { foto: true } });
        if (!f?.foto) return null;
        const { conteudo, tipo } = lerDataUrl(f.foto);
        const real = tipoPeloConteudo(conteudo) ?? tipo;
        return { conteudo, tipo: real, extensao: extensaoDoTipo(real) };
      }
      case 'rh': {
        const d = await this.prisma.documentoRh.findUnique({
          where: { id: c.id },
          select: { arquivo: true, arquivoTipo: true, arquivoNome: true },
        });
        if (!d) return null;
        const extensao = (/\.([a-z0-9]{1,5})$/i.exec(d.arquivoNome)?.[1] ?? extensaoDoTipo(d.arquivoTipo)).toLowerCase();
        return { conteudo: Buffer.from(d.arquivo), tipo: d.arquivoTipo, extensao };
      }
      case 'recibo': {
        const a = await this.prisma.assinaturaDiaria.findUnique({
          where: { diariaId: c.id },
          include: { diaria: { include: { diarista: true } } },
        });
        if (!a?.assinadoEm || !a.assinaturaPng) return null;
        const pdf = await gerarReciboPdf({
          id: a.id,
          quemPaga: { nome: a.empresaNome, cnpj: a.empresaCnpj },
          quemRecebe: { nome: a.nomeAssinante ?? a.diaria.diarista.nome, cpfCnpj: a.cpfAssinante },
          valor: Number(a.valor),
          descricao: a.descricao,
          detalhamento: a.detalhamento,
          dataDiaria: a.dataDiaria,
          assinadoEm: a.assinadoEm,
          assinaturaPng: a.assinaturaPng,
          modo: a.modo,
          ip: a.ip,
          userAgent: a.userAgent,
        });
        return { conteudo: pdf, tipo: 'application/pdf', extensao: 'pdf' };
      }
      case 'ixc': {
        const [arquivo, titulo, extensao] = c.id.split(':');
        const nota = await this.despesas.baixarNota(Number(arquivo), extensao || undefined, Number(titulo));
        const ext = (/\.([a-z0-9]{1,5})$/i.exec(nota.nome)?.[1] ?? extensaoDoTipo(nota.tipo)).toLowerCase();
        return { conteudo: nota.conteudo, tipo: nota.tipo, extensao: ext };
      }
    }
  }
}

/** "2026-09-02 - Madeireira Lima - R$ 170,00 - titulo 37229.jpg" */
export function nomeDoComprovante(p: Pagamento, n: number, extensao: string): string {
  const valor = p.pago.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sufixo = n > 0 ? ` (${n + 1})` : '';
  return limparNome(`${p.dia} - ${p.fornecedor.slice(0, 50)} - R$ ${valor} - titulo ${p.idFnApagar}${sufixo}.${extensao}`);
}

export type { CaixaNoPeriodo };
