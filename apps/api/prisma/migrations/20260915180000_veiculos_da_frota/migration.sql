-- Veiculos da frota: a moto, o carro, a maquina, e quanto cada um ja custou.
--
-- O dinheiro gasto neles sai por conta a pagar como qualquer outro. O que faltava
-- era dizer em qual veiculo foi -- a peca da moto do tecnico, a revisao da
-- caminhonete --, para responder "quanto essa moto ja gastou?".

CREATE TYPE "TipoVeiculo" AS ENUM ('MOTO', 'CARRO', 'CAMINHONETE', 'CAMINHAO', 'MAQUINA', 'OUTRO');

CREATE TABLE "veiculos" (
    "id" TEXT NOT NULL,
    "apelido" TEXT NOT NULL,
    "tipo" "TipoVeiculo" NOT NULL DEFAULT 'CARRO',
    "placa" TEXT,
    "modelo" TEXT,
    "ano" INTEGER,
    "observacao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    -- Quem anda com ele e o abastece: e o funcionario que o ve no portal.
    "responsavel_id" TEXT,
    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "veiculos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "veiculos_ativo_idx" ON "veiculos"("ativo");

ALTER TABLE "veiculos"
  ADD CONSTRAINT "veiculos_responsavel_id_fkey"
  FOREIGN KEY ("responsavel_id") REFERENCES "funcionarios"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Abastecimento: controle, nao conta a pagar. O posto manda a fatura da semana
-- com desconto, e e ela que se paga; daqui sai quanto cada veiculo gasta de
-- combustivel, o km de cada ida ao posto e a foto da nota.
CREATE TABLE "abastecimentos" (
    "id" TEXT NOT NULL,
    "veiculo_id" TEXT NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "km" INTEGER NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "funcionario_id" TEXT,
    "usuario_id" TEXT,
    "lancado_por" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abastecimentos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "abastecimentos_veiculo_id_data_idx" ON "abastecimentos"("veiculo_id", "data");

ALTER TABLE "abastecimentos"
  ADD CONSTRAINT "abastecimentos_veiculo_id_fkey"
  FOREIGN KEY ("veiculo_id") REFERENCES "veiculos"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "abastecimentos"
  ADD CONSTRAINT "abastecimentos_funcionario_id_fkey"
  FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- A foto da nota, a parte: a ficha lista os abastecimentos sem carregar imagem.
CREATE TABLE "fotos_dos_abastecimentos" (
    "id" TEXT NOT NULL,
    "abastecimento_id" TEXT NOT NULL,
    "foto" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fotos_dos_abastecimentos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fotos_dos_abastecimentos_abastecimento_id_key"
  ON "fotos_dos_abastecimentos"("abastecimento_id");

ALTER TABLE "fotos_dos_abastecimentos"
  ADD CONSTRAINT "fotos_dos_abastecimentos_abastecimento_id_fkey"
  FOREIGN KEY ("abastecimento_id") REFERENCES "abastecimentos"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Em qual veiculo foi o gasto. Independente da categoria: ela diz com o que
-- (peca, mao de obra), o veiculo diz em qual.
ALTER TABLE "contas_pagar" ADD COLUMN "veiculo_id" TEXT;

ALTER TABLE "contas_pagar"
  ADD CONSTRAINT "contas_pagar_veiculo_id_fkey"
  FOREIGN KEY ("veiculo_id") REFERENCES "veiculos"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "contas_pagar_veiculo_id_idx" ON "contas_pagar"("veiculo_id");
