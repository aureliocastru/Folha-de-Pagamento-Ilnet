-- Os implementos da fazenda (grade, roçadeira, carreta…): uma ferramenta que não
-- anda nem bebe — não tem km, horímetro nem combustível. Só se quer saber o que
-- já se gastou nele e o que se consertou, e isso sai da conta a pagar lançada com
-- ele marcado, como no veículo. Por isso vive na mesma tabela, como um tipo.
ALTER TYPE "TipoVeiculo" ADD VALUE 'IMPLEMENTO' BEFORE 'OUTRO';
