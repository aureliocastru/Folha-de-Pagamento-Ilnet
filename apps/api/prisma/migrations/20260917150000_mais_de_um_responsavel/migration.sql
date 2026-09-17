-- Mais de um responsavel por veiculo.
--
-- O carro que e de dois, a maquina que troca de operador, o galao que mais de
-- um leva ao posto: com uma coluna so, pôr o segundo nome tirava o primeiro --
-- e quem saiu perdia o veiculo no portal. Agora a ligacao e uma tabela, e cada
-- um dos responsaveis ve e abastece o mesmo veiculo.

CREATE TABLE "veiculo_responsaveis" (
    "veiculo_id" TEXT NOT NULL,
    "funcionario_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "veiculo_responsaveis_pkey" PRIMARY KEY ("veiculo_id", "funcionario_id")
);

CREATE INDEX "veiculo_responsaveis_funcionario_id_idx"
  ON "veiculo_responsaveis"("funcionario_id");

ALTER TABLE "veiculo_responsaveis"
  ADD CONSTRAINT "veiculo_responsaveis_veiculo_id_fkey"
  FOREIGN KEY ("veiculo_id") REFERENCES "veiculos"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "veiculo_responsaveis"
  ADD CONSTRAINT "veiculo_responsaveis_funcionario_id_fkey"
  FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Quem ja era responsavel continua sendo: cada veiculo nasce na tabela nova
-- com o nome que estava na coluna velha.
INSERT INTO "veiculo_responsaveis" ("veiculo_id", "funcionario_id")
SELECT "id", "responsavel_id" FROM "veiculos" WHERE "responsavel_id" IS NOT NULL;

ALTER TABLE "veiculos" DROP CONSTRAINT "veiculos_responsavel_id_fkey";
ALTER TABLE "veiculos" DROP COLUMN "responsavel_id";
