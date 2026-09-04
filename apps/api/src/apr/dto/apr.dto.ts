import {
  CategoriaItemApr,
  GravidadeApr,
  ModoAssinatura,
  RespostaRelato,
  StatusApr,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const texto = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Uma marcação do formulário: um risco, um EPI, uma resposta do relato. */
export class RespostaAprDto {
  /**
   * O item do catálogo. É por ele que o texto e a categoria chegam — a tela
   * não os manda de volta.
   *
   * Confiar no texto que volta do navegador seria deixar quem preenche
   * reescrever a pergunta que está respondendo: "As condições atmosféricas são
   * favoráveis? Sim" viraria o que o cliente quisesse. O servidor relê o item e
   * congela a versão dele.
   */
  @IsString()
  itemId!: string;

  /** Para norma, atividade, risco, ferramenta e proteção. */
  @IsOptional()
  @IsBoolean()
  marcado?: boolean;

  /** Para as perguntas do relato situacional. */
  @IsOptional()
  @IsEnum(RespostaRelato)
  resposta?: RespostaRelato;

  /** O "quais?" e a providência de quem respondeu "Não". */
  @IsOptional()
  @Transform(texto)
  @IsString()
  @MaxLength(500)
  detalhe?: string;
}

/** Quem vai executar o serviço. */
export class ExecutanteAprDto {
  /** Do cadastro. Vazio é quem não está nele — o terceirizado do dia. */
  @IsOptional()
  @IsString()
  funcionarioId?: string;

  @Transform(texto)
  @IsString()
  @MinLength(3, { message: 'O nome do executante precisa de ao menos 3 letras' })
  @MaxLength(120)
  nome!: string;

  @IsOptional()
  @Transform(texto)
  @IsString()
  @MaxLength(20)
  cpf?: string;
}

export class CriarAprDto {
  /** Vazio = o modelo padrão (o de trabalho em altura). */
  @IsOptional()
  @IsString()
  modeloId?: string;

  @Transform(texto)
  @IsString()
  @MinLength(3, { message: 'Diga onde é o serviço' })
  @MaxLength(200)
  local!: string;

  @Transform(texto)
  @IsString()
  @MinLength(3, { message: 'Diga quem coordena a equipe' })
  @MaxLength(120)
  coordenador!: string;

  /** "AAAA-MM-DD" — a previsão de execução do papel. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data no formato AAAA-MM-DD' })
  previsaoInicio?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data no formato AAAA-MM-DD' })
  previsaoFim?: string;

  /** Data e hora do começo. Vazio = agora, que é o caso de quem está saindo. */
  @IsOptional()
  @IsISO8601()
  inicioEm?: string;

  @IsOptional()
  @IsISO8601()
  fimEm?: string;

  @IsOptional()
  @Transform(texto)
  @IsString()
  @MaxLength(20000)
  descricaoEtapas?: string;

  @IsOptional()
  @IsEnum(GravidadeApr)
  gravidade?: GravidadeApr;

  /**
   * O formulário inteiro numa tacada. É de propósito: o técnico preenche isto
   * na beira da estrada, e cada ida ao servidor é uma chance de a APR ficar
   * pela metade quando o sinal cai.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(400)
  @ValidateNested({ each: true })
  @Type(() => RespostaAprDto)
  respostas?: RespostaAprDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ExecutanteAprDto)
  executantes?: ExecutanteAprDto[];
}

/**
 * A edição de uma APR que ainda é rascunho, e o encerramento de uma liberada.
 *
 * O modelo não está aqui: trocar o formulário no meio do preenchimento
 * invalidaria todas as respostas já dadas. Quem errou o modelo cancela e abre
 * outra — leva menos tempo que descobrir depois que metade das marcações
 * pertence a outro papel.
 */
export class AtualizarAprDto extends CriarAprDto {
  /** Substitui a equipe inteira. Ausente deixa como está. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ExecutanteAprDto)
  declare executantes?: ExecutanteAprDto[];
}

export class AssinarExecutanteDto {
  /** PNG em data URL, do quadro em que a pessoa assinou. */
  @IsString()
  @MinLength(30, { message: 'A assinatura chegou vazia' })
  assinaturaPng!: string;

  /** Desenhada com o dedo, ou gerada a partir do nome. */
  @IsOptional()
  @IsEnum(ModoAssinatura)
  modo?: ModoAssinatura;
}

export class SupervisaoAprDto {
  @Transform(texto)
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  nome!: string;

  @IsString()
  @MinLength(30, { message: 'A assinatura chegou vazia' })
  assinaturaPng!: string;
}

export class CancelarAprDto {
  @Transform(texto)
  @IsString()
  @MinLength(5, { message: 'Diga por que esta APR está sendo cancelada' })
  @MaxLength(500)
  motivo!: string;
}

/**
 * A prorrogação do papel: o serviço passou do previsto e continua.
 *
 * São duas, no máximo, e cada uma pede o motivo — é o que o formulário
 * impresso já exigia, e é a informação que falta quando alguém pergunta por
 * que a equipe ficou até as onze da noite.
 */
export class ProrrogarAprDto {
  @Transform(texto)
  @IsString()
  @MinLength(5, { message: 'Diga o motivo da prorrogação' })
  @MaxLength(500)
  motivo!: string;

  /** O novo fim previsto, quando se sabe. */
  @IsOptional()
  @IsISO8601()
  fimEm?: string;
}

export class QueryAprDto {
  @IsOptional()
  @IsEnum(StatusApr)
  status?: StatusApr;

  /** Só as que este login abriu. É o que a tela do técnico usa. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  minhas?: boolean;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data no formato AAAA-MM-DD' })
  de?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data no formato AAAA-MM-DD' })
  ate?: string;

  /** Casa com o local, o coordenador, o número e o nome de quem abriu. */
  @IsOptional()
  @Transform(texto)
  @IsString()
  busca?: string;
}

// ---------------------------------------------------------------------------
// O catálogo — o formulário em branco, editado pela tela
// ---------------------------------------------------------------------------

export class ItemAprDto {
  @IsEnum(CategoriaItemApr)
  categoria!: CategoriaItemApr;

  @Transform(texto)
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  textoItem!: string;

  /** Vazio = vai para o fim da categoria. */
  @IsOptional()
  @IsInt()
  @Min(0)
  ordem?: number;

  @IsOptional()
  @IsBoolean()
  pedeDetalhe?: boolean;

  @IsOptional()
  @IsBoolean()
  exigeProvidencia?: boolean;

  /** Já vem marcado na APR nova. Continua desmarcável em campo. */
  @IsOptional()
  @IsBoolean()
  marcadoPorPadrao?: boolean;
}

export class AtualizarItemAprDto {
  @IsOptional()
  @Transform(texto)
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  textoItem?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  ordem?: number;

  @IsOptional()
  @IsBoolean()
  pedeDetalhe?: boolean;

  @IsOptional()
  @IsBoolean()
  exigeProvidencia?: boolean;

  @IsOptional()
  @IsBoolean()
  marcadoPorPadrao?: boolean;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

/** A ordem nova de uma categoria inteira, na sequência em que ficou na tela. */
export class ReordenarItensDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(400)
  @IsString({ each: true })
  ids!: string[];
}

export class AtualizarModeloAprDto {
  @IsOptional()
  @Transform(texto)
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  nome?: string;

  @IsOptional()
  @Transform(texto)
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  titulo?: string;

  @IsOptional()
  @Transform(texto)
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  tipoTrabalho?: string;

  @IsOptional()
  @Transform(texto)
  @IsString()
  @MaxLength(30000)
  orientacoes?: string;

  @IsOptional()
  @Transform(texto)
  @IsString()
  @MaxLength(30000)
  planoResgate?: string;

  @IsOptional()
  @Transform(texto)
  @IsString()
  @MaxLength(300)
  telefonesEmergencia?: string;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;

  /** Marcar aqui desmarca o modelo que era padrão até então. */
  @IsOptional()
  @IsBoolean()
  padrao?: boolean;
}

export class CriarModeloAprDto extends AtualizarModeloAprDto {
  @Transform(texto)
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  declare nome: string;

  @Transform(texto)
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  declare titulo: string;

  @Transform(texto)
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  declare tipoTrabalho: string;

  /**
   * Copiar os itens de um modelo que já existe.
   *
   * Um formulário novo quase nunca nasce em branco: "trabalho em altura com
   * cesto aéreo" é o de altura com meia dúzia de diferenças. Sem isto, cadastrar
   * o segundo modelo custaria as mesmas oitenta linhas de novo — e é assim que
   * um cadastro flexível deixa de ser usado.
   */
  @IsOptional()
  @IsString()
  copiarDe?: string;
}
