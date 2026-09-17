-- O horimetro anda de decimo em decimo.
--
-- O painel da maquina marca 1252.6 -- mil duzentas e cinquenta e duas horas e
-- trinta e seis minutos --, e a coluna era inteira: os seis minutos sumiam a
-- cada abastecimento, e a media de litros por hora saia torta por causa disso.
-- Uma casa decimal e exatamente o que o ponteiro mostra.
ALTER TABLE "abastecimentos"
  ALTER COLUMN "horimetro" TYPE DECIMAL(10,1);
