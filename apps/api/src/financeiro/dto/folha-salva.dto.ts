import { IsIn, IsObject, Matches } from 'class-validator';

/** Qual folha: o pagamento e o mês trabalhado. */
export class QueryFolhaSalvaDto {
  @IsIn(['DIA_25', 'QUINTO_DIA'])
  modo!: string;

  @Matches(/^\d{4}-\d{2}$/, { message: 'mesTrabalhado deve estar no formato AAAA-MM' })
  mesTrabalhado!: string;
}

/** A folha do mês como ficou na tela: as mudanças de cada pessoa. */
export class SalvarFolhaDto extends QueryFolhaSalvaDto {
  @IsObject()
  ajustes!: Record<string, unknown>;
}
