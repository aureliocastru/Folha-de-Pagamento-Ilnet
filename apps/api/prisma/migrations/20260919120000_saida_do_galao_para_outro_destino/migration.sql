-- A saida de um galao pode ir para o que nao e da frota: a rocadeira, o
-- cortador de grama, o sitio, a fazenda. Nesse caso nao ha veiculo, e quem diz
-- para onde foi e o texto escrito.
ALTER TABLE "abastecimentos" ALTER COLUMN "veiculo_id" DROP NOT NULL;
ALTER TABLE "abastecimentos" ADD COLUMN "outro_destino" TEXT;

-- Um destino ou outro, nunca os dois e nunca nenhum: sem os dois, os litros
-- sairiam do galao para lugar nenhum. E o destino escrito so existe na saida de
-- um galao — a ida ao posto e sempre de um veiculo, com a nota dele.
ALTER TABLE "abastecimentos"
  ADD CONSTRAINT "abastecimentos_veiculo_ou_outro_destino"
  CHECK (
    ("veiculo_id" IS NOT NULL) <> ("outro_destino" IS NOT NULL)
    AND ("outro_destino" IS NULL OR "galao_id" IS NOT NULL)
  );
