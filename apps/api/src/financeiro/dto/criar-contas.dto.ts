import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { OrigemLancamento, TipoLancamento } from '@prisma/client';

export class ItemContaPagarDto {
  @IsOptional() @IsString() funcionarioId?: string;
  @IsOptional() @IsString() beneficiarioAvulsoId?: string;
  @IsOptional() @IsString() diaristaId?: string;

  @IsEnum(TipoLancamento)
  tipo!: TipoLancamento;

  /**
   * De qual módulo esta conta nasceu. Omitido = FOLHA, que é quem chama este
   * caminho na maioria das vezes (salário, adiantamento, bônus, diária).
   * CONTAS_PAGAR some de tudo que é da folha.
   */
  @IsOptional() @IsEnum(OrigemLancamento) origem?: OrigemLancamento;

  @IsNumber() @Min(0.01) valor!: number;

  /** Conta contábil (id_conta). Se omitida, usa o padrão por tipo. */
  @IsOptional() @IsInt() @Min(1) contaContabil?: number;

  /** Conta de pagamento (id_contas). Se omitida, usa a da configuração. */
  @IsOptional() @IsInt() @Min(1) contaPagamento?: number;

  /**
   * fn_apagar.tipo_pagamento desta conta (ex.: "Dinheiro" numa diária paga em
   * mãos). Omitido = o padrão da configuração, hoje "Pix".
   */
  @IsOptional() @IsString() tipoPagamentoIxc?: string;

  @IsOptional() @IsString() observacao?: string;

  /**
   * Quanto deste pagamento é comissão de venda, e de quantas vendas. Vem da
   * folha, no salário. Fica gravado na conta: é a única resposta honesta para
   * "quanto o mês custou em venda" depois que a folha já saiu.
   */
  @IsOptional() @IsInt() @Min(0) vendas?: number;

  @IsOptional() @IsNumber() @Min(0) comissaoVendas?: number;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'competencia deve estar no formato AAAA-MM' })
  competencia?: string;

  /**
   * As férias que este pagamento quita — a lista de férias do Gerar Folha.
   * Só no tipo FERIAS; é o que impede pagar as mesmas férias duas vezes.
   */
  @IsOptional() @IsString() feriasMarcadaId?: string;
}

export class CriarContasPagarDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ItemContaPagarDto)
  itens!: ItemContaPagarDto[];
}
