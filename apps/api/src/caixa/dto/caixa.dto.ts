import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ENotaDoCaixa } from './nota-do-caixa';

const numeroOuIndefinido = ({ value }: { value: unknown }) =>
  value === '' || value == null ? undefined : Number(value);

export class PeriodoDoCaixaDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'A data inicial precisa estar no formato AAAA-MM-DD.',
  })
  de!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'A data final precisa estar no formato AAAA-MM-DD.',
  })
  ate!: string;
}

/**
 * O retrato do lançamento, que a tela manda junto ao conferir ou fotografar.
 *
 * É o que faz existir um histórico pesquisável meses depois: sem ele, achar um
 * pagamento antigo exigiria varrer o IXC mês a mês, que é a leitura que já
 * derrubou esta página.
 */
class RetratoDoLancamentoDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'A data do lançamento precisa estar no formato AAAA-MM-DD.',
  })
  dataLancamento?: string;

  @IsOptional()
  @Transform(numeroOuIndefinido)
  @IsNumber()
  valor?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  historico?: string;
}

export class ConferirLancamentoDto extends RetratoDoLancamentoDto {
  @IsOptional()
  @IsBoolean()
  conferido?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  observacao?: string;
}

/**
 * Tirar (ou devolver) um lançamento da conta do saldo esperado da gaveta.
 *
 * É para a saída de acerto: a que foi criada no IXC só para corrigir um saldo
 * que já estava errado lá, de um dinheiro que saiu da gaveta antes por outro
 * caminho.
 */
export class ForaDaGavetaDto extends RetratoDoLancamentoDto {
  @IsBoolean()
  fora!: boolean;

  /** Obrigatório ao tirar — a validação do "por quê" mora no serviço. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  motivo?: string;
}

/**
 * Mais uma nota para um lançamento: a foto, ou o PDF (ver `nota-do-caixa`).
 *
 * O campo continua `notaFoto` por ser o nome que a tela e o banco já usam; o
 * que vem nele é o data URL de um ou de outro.
 */
export class AnexarNotaDto extends RetratoDoLancamentoDto {
  @IsString()
  @ENotaDoCaixa()
  notaFoto!: string;
}

export class NotaDto {
  /** Data URL da foto ou do PDF. `null` tira a nota que estava lá. */
  @IsOptional()
  @IsString()
  @ENotaDoCaixa()
  notaFoto?: string | null;
}

/** Dinheiro que sai do caixa com alguém para pagar algo na rua. */
export class EntregarDinheiroDto {
  @IsInt()
  @Transform(numeroOuIndefinido)
  caixaId!: number;

  @IsString()
  @MinLength(2, { message: 'Diga com quem o dinheiro está.' })
  @MaxLength(120)
  pessoa!: string;

  @Transform(numeroOuIndefinido)
  @IsNumber()
  @Min(0.01, { message: 'O valor precisa ser maior que zero.' })
  valor!: number;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'A data da entrega precisa estar no formato AAAA-MM-DD.',
  })
  entregueEm?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  motivo?: string;
}

/**
 * A despesa que a prestação lança: onde o dinheiro da rua foi gasto.
 *
 * Sem ela o gasto fica sabido só aqui, e o caixa do IXC segue sem saber que
 * aquele dinheiro saiu — é a nota que existe na gaveta e não existe no
 * financeiro. Com ela, o gasto vira conta a pagar criada, aprovada e baixada
 * no caixa de onde o dinheiro saiu.
 */
export class DespesaDaPrestacaoDto {
  /** Quem recebeu, entre os fornecedores que já existem no IXC. */
  @Transform(numeroOuIndefinido)
  @IsInt({ message: 'Escolha o fornecedor da nota.' })
  @Min(1)
  idFornecedorIxc!: number;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  fornecedorNome!: string;

  /** O que foi comprado. Vira a observação do título no IXC. */
  @IsString()
  @MinLength(3, { message: 'Diga em que o dinheiro foi gasto.' })
  @MaxLength(500)
  descricao!: string;

  /**
   * Dia em que o dinheiro saiu (AAAA-MM-DD). Vazio = o dia da entrega.
   *
   * Quase sempre está no passado: quem levou dinheiro na segunda só senta para
   * prestar contas na sexta, e a saída no IXC tem de cair na segunda, ou o
   * caixa daquela semana não bate.
   */
  @IsOptional()
  @IsISO8601()
  pagoEm?: string;

  /** A etiqueta desta casa, para a despesa entrar classificada. */
  @IsOptional()
  @IsUUID()
  categoriaId?: string | null;

  /** Dinheiro, Pix… Vazio = o padrão das Configurações. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  tipoPagamento?: string;

  /** Conta contábil (`id_conta`). Vazio = a de avulsos da configuração. */
  @IsOptional()
  @Transform(numeroOuIndefinido)
  @IsInt()
  @Min(1)
  contaContabil?: number;
}

/**
 * Um acerto da conta de quem levou dinheiro.
 *
 * A entrega raramente se resolve de uma vez: leva 100, traz nota de 50, fica
 * com 50 para a próxima compra, e às vezes sai mais dinheiro da gaveta para
 * completar. Cada um desses é um lançamento, e o saldo da pessoa anda com eles.
 */
export class MovimentoDaRuaDto {
  @IsIn(['NOTA', 'TROCO', 'REFORCO'], {
    message: 'O lançamento é nota, troco ou reforço.',
  })
  tipo!: 'NOTA' | 'TROCO' | 'REFORCO';

  @Transform(numeroOuIndefinido)
  @IsNumber()
  @Min(0.01, { message: 'O valor precisa ser maior que zero.' })
  valor!: number;

  /**
   * Dia em que aconteceu (AAAA-MM-DD). Vazio = hoje.
   *
   * É a data do acontecimento, e não a da digitação: ela decide em que período
   * do caixa este lançamento pesa.
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'A data do lançamento precisa estar no formato AAAA-MM-DD.',
  })
  data?: string;

  /** As fotos ou PDFs da nota: uma nota nem sempre cabe num arquivo só. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: 'No máximo dez arquivos por nota.' })
  @IsString({ each: true })
  @ENotaDoCaixa({ each: true })
  notasFoto?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  observacao?: string;

  /**
   * A conta a pagar desta nota. Vazio = lançamento só registrado aqui, que é o
   * que se faz quando a despesa já foi lançada no IXC por outro caminho.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => DespesaDaPrestacaoDto)
  despesa?: DespesaDaPrestacaoDto;

  /**
   * O dia em que esta despesa já saiu do caixa no IXC, lançada por fora.
   *
   * É o par que faltava do `despesa` vazio. Sem despesa e sem esta data, o
   * acerto desconta a entrega da gaveta e a saída lançada no IXC desconta de
   * novo: o mesmo dinheiro sai duas vezes da conta do saldo. Com ela, o
   * período que a contém soma o gasto de volta, exatamente como faz com a
   * despesa que este app lançou.
   *
   * É a data da saída **no IXC**, e não a do acerto: é ela que decide em que
   * período de lá o desconto aparece.
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'A data da saída no IXC precisa estar no formato AAAA-MM-DD.',
  })
  gastoJaNoIxcEm?: string;
}

export class FecharCaixaDto {
  @IsInt()
  @Transform(numeroOuIndefinido)
  caixaId!: number;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'A data inicial precisa estar no formato AAAA-MM-DD.',
  })
  de!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'A data final precisa estar no formato AAAA-MM-DD.',
  })
  ate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observacao?: string;

  /**
   * Quanto havia na gaveta no início do período.
   *
   * Só faz falta no primeiro fechamento de cada caixa: do segundo em diante, o
   * anterior diz de onde a contagem parte.
   */
  @IsOptional()
  @Transform(numeroOuIndefinido)
  @IsNumber()
  saldoInicial?: number;

  /**
   * Quanto se contou na gaveta ao fechar.
   *
   * Opcional, mas é o número que faz o fechamento valer alguma coisa: sem ele o
   * período fecha pelo cálculo, e cálculo não encontra dinheiro que sumiu nem
   * dinheiro que apareceu.
   */
  @IsOptional()
  @Transform(numeroOuIndefinido)
  @IsNumber()
  @Min(0, { message: 'A gaveta não conta valor negativo.' })
  saldoContado?: number;
}

/** A contagem da gaveta de um fechamento já assinado, corrigida. */
export class ContagemDaGavetaDto {
  @Transform(numeroOuIndefinido)
  @IsNumber({}, { message: 'Diga quanto foi contado na gaveta.' })
  @Min(0, { message: 'A gaveta não conta valor negativo.' })
  saldoContado!: number;
}
