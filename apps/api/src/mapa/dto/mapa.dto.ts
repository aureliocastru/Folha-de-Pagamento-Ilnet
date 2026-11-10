import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** Quem anda com um rastreador. Os dois vazios desfazem a ligação. */
export class VincularRastreadorDto {
  /** `funcionarios.id` do IXC. */
  @IsOptional()
  @IsInt()
  @Min(1)
  tecnicoIxcId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  equipe?: string | null;

  /** O nome do veículo no rastreador, como a tela o viu. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nomeDoVeiculo?: string | null;
}
