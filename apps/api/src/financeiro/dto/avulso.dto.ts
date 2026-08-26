import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { FormaPagamento } from '@prisma/client';
import { TIPOS_CHAVE_PIX } from '../../ixc/ixc.financeiro';

/** Cadastro de quem recebe fora da folha: mão de obra, serviço, patrocínio. */
export class CriarBeneficiarioDto {
  @IsString() @MinLength(2) nome!: string;

  @IsOptional() @IsString() cpfCnpj?: string;
  @IsOptional() @IsIn(['F', 'J']) tipoPessoa?: string;
  @IsOptional() @IsString() telefone?: string;
  @IsOptional() @IsString() email?: string;

  @IsOptional() @IsString() chavePix?: string;

  /** Tipo da chave PIX; vazio = deduzir pelo formato. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? null : value))
  @IsIn([...TIPOS_CHAVE_PIX])
  tipoChavePix?: string | null;

  /** Quanto ganha por venda — cliente da empresa também vende e comissiona. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? null : Number(value)))
  @IsNumber()
  @Min(0)
  valorPorVenda?: number | null;

  @IsOptional() @IsEnum(FormaPagamento) formaPagamento?: FormaPagamento;

  @IsOptional() @IsString() observacoes?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  cidadeIxc?: number;

  /**
   * Fornecedor do IXC a reaproveitar. Vem da tela quando a pessoa foi avisada
   * de que aquele CPF/CNPJ já existe lá e escolheu usar o cadastro que existe.
   */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  idFornecedorIxc?: number;

  /** A pessoa foi avisada e mesmo assim quer um fornecedor novo no IXC. */
  @IsOptional() @IsBoolean() fornecedorNovoNoIxc?: boolean;
}

export class UpdateBeneficiarioDto extends CriarBeneficiarioDto {
  @IsOptional() @IsString() @MinLength(2) declare nome: string;
  @IsOptional() @IsBoolean() ativo?: boolean;
}

/**
 * Um pagamento avulso: o serviço, a comissão das vendas que a pessoa fechou e
 * o extra do trabalho por fora. Tudo somado sai num pagamento só — ver
 * `pagamento.calc`, compartilhado com a diária.
 */
export class PagarAvulsoDto {
  /**
   * De qual módulo saiu este pagamento — é o que decide em que relatório ele
   * conta. Vazio = folha, que é quem não precisa dizer nada.
   *
   * É da tela, e não do cadastro: a mesma pessoa pode receber pela folha (uma
   * comissão de venda, que vai para o gráfico de vendas) e pelo Contas a Pagar
   * (um serviço prestado, que é despesa da empresa).
   */
  @IsOptional() @IsString() modulo?: string;

  /** Dia do pagamento (AAAA-MM-DD). Vazio = hoje. */
  @IsOptional() @IsISO8601() data?: string;

  /** O trabalho contratado. Zero quando o acerto é só de comissão. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  valorServico?: number;

  /** Quantas vendas a pessoa fechou no período que este pagamento cobre. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  vendas?: number;

  /** Quanto cada venda paga. Vazio = o do cadastro. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  valorPorVenda?: number;

  /** Trabalho por fora que rendeu um troco a mais no mesmo acerto. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  valorExtra?: number;

  @IsOptional() @IsString() descricaoExtra?: string;

  /** O que foi feito — vira observação no IXC e histórico no caixa. */
  @IsString() @MinLength(3) descricao!: string;

  /** Vazio = a forma habitual do cadastro. */
  @IsOptional() @IsEnum(FormaPagamento) forma?: FormaPagamento;

  /**
   * Como o IXC vai pagar: "Pix", "Boleto", "Transferência". Vazio = o padrão
   * das Configurações.
   *
   * Existe porque nem todo fornecedor recebe por PIX — empresa costuma mandar
   * boleto —, e antes disso o pagamento a quem não tinha chave simplesmente não
   * saía: a tela exigia a chave para deixar gerar.
   */
  @IsOptional() @IsString() @MaxLength(40) tipoPagamento?: string;

  /** Vazio = a conta contábil de avulsos da configuração. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  contaContabil?: number;

  /**
   * Chave PIX a usar neste pagamento. Vazio = a do cadastro. O que vier aqui
   * fica gravado no cadastro, para não ter de digitar de novo.
   */
  @IsOptional() @IsString() chavePix?: string;

  /** Tipo da chave; também fica gravado no cadastro. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : value))
  @IsIn([...TIPOS_CHAVE_PIX])
  tipoChavePix?: string;
}

export class QueryPagamentosAvulsosDto {
  @IsOptional() @IsString() beneficiarioId?: string;

  /** "contas-pagar" para ver os de lá; qualquer outra coisa, os da folha. */
  @IsOptional() @IsString() modulo?: string;
}

/** Fornecedor do IXC escolhido na lista, para ganhar cadastro aqui. */
export class VincularFornecedorIxcDto {
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  idFornecedorIxc!: number;

  /**
   * De qual tela veio. Decide em que lista o cadastro novo aparece.
   *
   * Só vale para o cadastro que nasce agora: o que já existe fica com a origem
   * que tem. Quem manda no relatório é a origem do pagamento.
   */
  @IsOptional() @IsString() modulo?: string;
}

export class QueryFornecedorIxcDto {
  @IsString() @MinLength(3) cpfCnpj!: string;
}

/** O que a tela pode mudar no cadastro de fornecedor do próprio IXC. */
export class EditarFornecedorIxcDto {
  /**
   * Como a pessoa é conhecida ("Deda pedreiro"). Texto vazio limpa o apelido,
   * que é uma edição legítima — por isso não há `MinLength` aqui.
   *
   * O teto é a largura usual da coluna no IXC; quem manda a palavra final sobre
   * o que cabe é ele, e a recusa dele sobe para a tela.
   */
  @IsOptional() @IsString() @MaxLength(150) nomeFantasia?: string;
}
