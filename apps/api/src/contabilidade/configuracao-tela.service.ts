import { BadRequestException, Injectable } from '@nestjs/common';
import { IxcClient } from '../ixc/ixc.client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConfiguracaoContabilService,
  PAPEIS,
  SUGESTAO,
  papelSugerido,
  type Configuracao,
  type PapelDaConta,
  type Selecao,
} from './configuracao.service';
import type { ConfiguracaoDto } from './dto/contabilidade.dto';
import { idDoIxc, lerTudo, texto } from './ixc-leitura';
import { PacoteContabilService } from './pacote.service';

/** O plano de contas do IXC muda pouco: relido a cada dez minutos. */
const VALIDADE_DO_PLANO_MS = 10 * 60 * 1000;

/**
 * A tela de ajustes: o papel de cada conta do IXC e o que conta como lucro,
 * doação e link. É o que a pessoa confirma uma vez e o mês seguinte já usa.
 */
@Injectable()
export class ConfiguracaoService {
  private plano: { em: number; contas: Array<{ id: number; nome: string; tipo: string }> } | null = null;

  constructor(
    private readonly ixc: IxcClient,
    private readonly prisma: PrismaService,
    private readonly configuracao: ConfiguracaoContabilService,
    private readonly pacotes: PacoteContabilService,
  ) {}

  async tela() {
    const cfg = await this.configuracao.obter();
    const [contasCruas, categorias, plano] = await Promise.all([
      lerTudo(this.ixc, { tabela: 'contas', qtype: 'contas.id', query: '0', oper: '>', sortname: 'contas.id' }),
      this.prisma.categoriaDespesa.findMany({
        where: { ativa: true },
        select: { id: true, nome: true, pai: { select: { nome: true } } },
        orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
      }),
      this.planoDeContas(),
    ]);

    const contas = contasCruas
      .map((raw) => {
        const id = idDoIxc(raw.id);
        if (id === null) return null;
        const nome = texto(raw.conta) || `Conta ${id}`;
        const tipo = texto(raw.tipo_conta).toUpperCase();
        const escolhido = cfg.papelDasContas[String(id)];
        return {
          id,
          nome,
          tipo,
          ativa: texto(raw.ativo).toUpperCase() === 'S',
          papel: escolhido ?? papelSugerido({ nome, tipo }),
          sugerido: !escolhido,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort((a, b) => Number(b.ativa) - Number(a.ativa) || a.nome.localeCompare(b.nome, 'pt-BR'));

    const selecoes = await Promise.all(
      (['lucros', 'doacoes', 'link'] as const).map(async (qual) => {
        const s = await this.pacotes.selecao(qual, cfg);
        // A sugestão do plano de contas sai do plano inteiro aqui, e não só
        // dos pagamentos já lidos.
        if (s.sugerida) {
          s.planos = plano.filter((p) => SUGESTAO[qual].test(p.nome)).map((p) => p.id);
        }
        return [qual, s] as const;
      }),
    );

    return {
      contas,
      categorias: categorias.map((c) => ({ id: c.id, nome: c.pai ? `${c.pai.nome} › ${c.nome}` : c.nome })),
      planoDeContas: plano,
      ...Object.fromEntries(selecoes),
    };
  }

  async salvar(dto: ConfiguracaoDto): Promise<Configuracao> {
    const papeis: Record<string, PapelDaConta> = {};
    for (const [id, papel] of Object.entries(dto.papelDasContas ?? {})) {
      if (!/^\d+$/.test(id) || !(PAPEIS as readonly string[]).includes(papel)) {
        throw new BadRequestException(`Papel "${papel}" não existe.`);
      }
      papeis[id] = papel as PapelDaConta;
    }
    const selecao = (s: ConfiguracaoDto['lucros']): Selecao | undefined =>
      s ? { categorias: s.categorias, planos: s.planos, fornecedores: s.fornecedores.map((f) => ({ id: f.id, nome: f.nome })) } : undefined;
    return this.configuracao.salvar({
      ...(dto.papelDasContas ? { papelDasContas: papeis } : {}),
      ...(dto.lucros ? { lucros: selecao(dto.lucros) } : {}),
      ...(dto.doacoes ? { doacoes: selecao(dto.doacoes) } : {}),
      ...(dto.link ? { link: selecao(dto.link) } : {}),
    });
  }

  /**
   * O plano de contas do IXC, menos as contas de cliente (tipo A, uma por
   * cliente — quinze mil): é nele que se escolhe "Sócio1 dividendos" para os
   * lucros e "Link internet" para o link.
   */
  private async planoDeContas(): Promise<Array<{ id: number; nome: string; tipo: string }>> {
    if (this.plano && Date.now() - this.plano.em < VALIDADE_DO_PLANO_MS) return this.plano.contas;
    const crus = await lerTudo(this.ixc, {
      tabela: 'planejamento_analitico',
      qtype: 'planejamento_analitico.id',
      query: '0',
      oper: '>',
      sortname: 'planejamento_analitico.id',
      grid: [{ TB: 'planejamento_analitico.tipo', OP: '!=', P: 'A' }],
    });
    const contas = crus
      .filter((r) => texto(r.ativo).toUpperCase() !== 'N')
      .map((r) => ({ id: idDoIxc(r.id), nome: texto(r.planejamento_analitico), tipo: texto(r.tipo) }))
      .filter((r): r is { id: number; nome: string; tipo: string } => r.id !== null && r.nome !== '')
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    this.plano = { em: Date.now(), contas };
    return contas;
  }
}
