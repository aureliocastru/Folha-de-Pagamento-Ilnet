-- A categoria de despesa ganha uma mae.
--
-- O cadastro era plano: trinta e poucos nomes soltos ("Compra de veiculos",
-- "Manutencao de veiculos", "Combustivel"), e o dashboard desenhava uma barra
-- para cada um. Trinta barras nao respondem "quanto custa a frota?" -- a
-- resposta esta espalhada em tres delas, e quem le tem de somar de cabeca.
--
-- Um nivel so, de proposito. A coluna aponta para a propria tabela: quem tem
-- pai_id preenchido e subcategoria, quem nao tem e categoria. Nada muda para
-- quem ja estava classificado -- a etiqueta continua sendo a mesma linha, e o
-- que se ganha e o agrupamento por cima dela.
--
-- ON DELETE RESTRICT: apagar a mae deixaria as filhas orfas em silencio, e um
-- grupo que some sozinho e numero que muda sozinho no relatorio.
ALTER TABLE "categorias_despesa" ADD COLUMN "pai_id" TEXT;

ALTER TABLE "categorias_despesa"
  ADD CONSTRAINT "categorias_despesa_pai_id_fkey"
  FOREIGN KEY ("pai_id") REFERENCES "categorias_despesa"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "categorias_despesa_pai_id_idx" ON "categorias_despesa"("pai_id");
