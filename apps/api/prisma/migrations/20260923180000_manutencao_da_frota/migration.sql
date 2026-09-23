-- A manutenção da frota: o que cada veículo troca de tempos em tempos, e o
-- histórico das trocas.
ALTER TABLE "veiculos" ADD COLUMN "manutencao_iniciada" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "itens_de_manutencao" (
    "id" TEXT NOT NULL,
    "veiculo_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "intervalo_medidor" INTEGER,
    "intervalo_meses" INTEGER,
    "ultima_troca_medidor" DECIMAL(10,1),
    "ultima_troca_em" DATE,
    "observacao" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "itens_de_manutencao_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "trocas_de_manutencao" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "medidor" DECIMAL(10,1),
    "data" DATE NOT NULL,
    "observacao" TEXT,
    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trocas_de_manutencao_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "itens_de_manutencao_veiculo_id_idx" ON "itens_de_manutencao"("veiculo_id");
CREATE INDEX "trocas_de_manutencao_item_id_data_idx" ON "trocas_de_manutencao"("item_id", "data");

ALTER TABLE "itens_de_manutencao" ADD CONSTRAINT "itens_de_manutencao_veiculo_id_fkey" FOREIGN KEY ("veiculo_id") REFERENCES "veiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trocas_de_manutencao" ADD CONSTRAINT "trocas_de_manutencao_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "itens_de_manutencao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
