import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { FornecedorCotacao } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Um fornecedor com o tamanho da presença dele no catálogo. */
export interface FornecedorComUso extends FornecedorCotacao {
  /** Quantos produtos diferentes ele já cotou. */
  produtos: number;
  /** Em quantos deles ele é o mais barato hoje. */
  maisBaratoEm: number;
  /** Quantas cotações ele tem no histórico. */
  cotacoes: number;
}

/**
 * Quem vende material para a casa.
 *
 * **Não é o fornecedor do IXC.** Lá estão os três mil e duzentos que já
 * receberam dinheiro da empresa — prestador de serviço, concessionária,
 * aluguel, imposto —, e essa lista responde "para quem já pagamos?". Esta aqui
 * é curta e responde outra coisa: "quem tem preço de drop para dar?". Cadastro
 * próprio, um por um, e nenhum vínculo entre as duas.
 */
@Injectable()
export class FornecedoresCotacaoService {
  private readonly logger = new Logger(FornecedoresCotacaoService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listar(opcoes: {
    busca?: string;
    incluirInativos?: boolean;
  }): Promise<FornecedorComUso[]> {
    const busca = opcoes.busca?.trim();

    const fornecedores = await this.prisma.fornecedorCotacao.findMany({
      where: {
        ...(opcoes.incluirInativos ? {} : { ativo: true }),
        ...(busca
          ? {
              OR: [
                { nome: { contains: busca, mode: 'insensitive' } },
                { nomeFantasia: { contains: busca, mode: 'insensitive' } },
                { contato: { contains: busca, mode: 'insensitive' } },
                { cnpj: { contains: busca, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { nome: 'asc' },
    });

    if (fornecedores.length === 0) return [];

    const uso = await this.quantoCadaUmPesa();

    return fornecedores.map((f) => ({
      ...f,
      produtos: uso.produtos.get(f.id) ?? 0,
      cotacoes: uso.cotacoes.get(f.id) ?? 0,
      maisBaratoEm: uso.maisBaratoEm.get(f.id) ?? 0,
    }));
  }

  async criar(dados: Omit<Partial<FornecedorCotacao>, 'id'> & { nome: string }) {
    await this.recusarNomeRepetido(dados.nome);

    const criado = await this.prisma.fornecedorCotacao.create({
      data: {
        nome: dados.nome,
        nomeFantasia: dados.nomeFantasia ?? null,
        cnpj: dados.cnpj ?? null,
        contato: dados.contato ?? null,
        telefone: dados.telefone ?? null,
        email: dados.email ?? null,
        site: dados.site ?? null,
        observacao: dados.observacao ?? null,
      },
    });
    this.logger.log(`Fornecedor de cotação criado: ${criado.nome}`);

    return { ...criado, produtos: 0, cotacoes: 0, maisBaratoEm: 0 };
  }

  async atualizar(
    id: string,
    dados: Partial<Omit<FornecedorCotacao, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<FornecedorComUso> {
    const atual = await this.prisma.fornecedorCotacao.findUnique({
      where: { id },
    });
    if (!atual) throw new NotFoundException('Fornecedor não encontrado');

    if (dados.nome && dados.nome.toLowerCase() !== atual.nome.toLowerCase()) {
      await this.recusarNomeRepetido(dados.nome);
    }

    await this.prisma.fornecedorCotacao.update({ where: { id }, data: dados });

    // Relê pela lista para o uso vir junto — a tela mostra "cota 14 produtos"
    // na mesma linha, e devolver a linha crua a zeraria até a próxima leitura.
    const [atualizado] = await this.listar({ incluirInativos: true, busca: undefined }).then(
      (todos) => todos.filter((f) => f.id === id),
    );
    return atualizado;
  }

  /**
   * Apaga o fornecedor. Com preços cadastrados, só sob pedido explícito.
   *
   * Mesma regra do produto, e pelo mesmo motivo: o banco recusa sozinho e o
   * erro chegaria cru na tela. Aqui a recusa diz quantas cotações se perderiam
   * — e o caminho de todo dia é desativar, que tira o fornecedor das opções
   * novas sem apagar o que ele cobrava.
   */
  async excluir(id: string, comAsCotacoes = false): Promise<void> {
    const fornecedor = await this.prisma.fornecedorCotacao.findUnique({
      where: { id },
      include: { _count: { select: { precos: true } } },
    });
    if (!fornecedor) throw new NotFoundException('Fornecedor não encontrado');

    const quantas = fornecedor._count.precos;
    if (quantas > 0 && !comAsCotacoes) {
      throw new ConflictException(
        `"${fornecedor.nome}" tem ${quantas} ${quantas === 1 ? 'preço cadastrado' : 'preços cadastrados'}. ` +
          'Desative-o para tirá-lo das opções sem perder o histórico, ou confirme para apagar tudo.',
      );
    }

    await this.prisma.$transaction([
      this.prisma.precoDeProduto.deleteMany({ where: { fornecedorId: id } }),
      this.prisma.fornecedorCotacao.delete({ where: { id } }),
    ]);
    this.logger.log(
      `Fornecedor de cotação apagado: ${fornecedor.nome} (${quantas} cotações junto)`,
    );
  }

  /**
   * Quantos produtos cada fornecedor cota, quantas cotações tem, e em quantos
   * itens ele é hoje o mais barato.
   *
   * A última é a que interessa na lista — é ela que diz de quem se compra —, e
   * ela não sai de um `count`: depende de saber, por produto, qual é o preço
   * que vale de cada um. A tabela inteira de preços vem numa consulta só e a
   * conta é feita aqui; é a mesma tabela que a tela de produtos já lê.
   */
  private async quantoCadaUmPesa(): Promise<{
    produtos: Map<string, number>;
    cotacoes: Map<string, number>;
    maisBaratoEm: Map<string, number>;
  }> {
    const precos = await this.prisma.precoDeProduto.findMany({
      select: {
        produtoId: true,
        fornecedorId: true,
        valor: true,
        data: true,
        createdAt: true,
      },
    });

    const cotacoes = new Map<string, number>();
    const produtosPorFornecedor = new Map<string, Set<string>>();
    /** produtoId → (fornecedorId → a cotação que vale dele) */
    const valem = new Map<
      string,
      Map<string, { valor: number; data: string; criadoEm: string }>
    >();

    for (const p of precos) {
      cotacoes.set(p.fornecedorId, (cotacoes.get(p.fornecedorId) ?? 0) + 1);

      const seus = produtosPorFornecedor.get(p.fornecedorId);
      if (seus) seus.add(p.produtoId);
      else produtosPorFornecedor.set(p.fornecedorId, new Set([p.produtoId]));

      const doProduto = valem.get(p.produtoId) ?? new Map();
      valem.set(p.produtoId, doProduto);

      const linha = {
        valor: Number(p.valor),
        data: p.data.toISOString().slice(0, 10),
        criadoEm: p.createdAt.toISOString(),
      };
      const atual = doProduto.get(p.fornecedorId);
      if (
        !atual ||
        linha.data > atual.data ||
        (linha.data === atual.data && linha.criadoEm > atual.criadoEm)
      ) {
        doProduto.set(p.fornecedorId, linha);
      }
    }

    const maisBaratoEm = new Map<string, number>();
    for (const doProduto of valem.values()) {
      let campeao: string | null = null;
      let menor = Number.POSITIVE_INFINITY;
      for (const [fornecedorId, linha] of doProduto) {
        if (linha.valor < menor) {
          menor = linha.valor;
          campeao = fornecedorId;
        }
      }
      // Empate não conta para ninguém: dizer que dois fornecedores são "o mais
      // barato" do mesmo item inflaria os dois com uma vantagem que não existe.
      const empatados = [...doProduto.values()].filter(
        (l) => l.valor === menor,
      ).length;
      if (campeao && empatados === 1) {
        maisBaratoEm.set(campeao, (maisBaratoEm.get(campeao) ?? 0) + 1);
      }
    }

    const produtos = new Map<string, number>();
    for (const [fornecedorId, seus] of produtosPorFornecedor) {
      produtos.set(fornecedorId, seus.size);
    }

    return { produtos, cotacoes, maisBaratoEm };
  }

  private async recusarNomeRepetido(nome: string): Promise<void> {
    const existe = await this.prisma.fornecedorCotacao.findFirst({
      where: { nome: { equals: nome, mode: 'insensitive' } },
      select: { nome: true },
    });
    if (existe) {
      throw new ConflictException(
        `Já existe um fornecedor chamado "${existe.nome}". ` +
          'Dois cadastros do mesmo lugar espalham os preços dele em duas listas.',
      );
    }
  }
}
