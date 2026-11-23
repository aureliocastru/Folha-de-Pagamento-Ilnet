-- As revisões do veículo: o registro do que se trocou em cada uma, com
-- quantidade e preço. Só consulta — nada aqui vira conta a pagar.
CREATE TABLE "revisoes_do_veiculo" (
    "id" TEXT NOT NULL,
    "veiculo_id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "medidor" DECIMAL(10,1),
    "oficina" TEXT,
    "observacao" TEXT,
    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "revisoes_do_veiculo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "itens_da_revisao" (
    "id" TEXT NOT NULL,
    "revisao_id" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "quantidade" DECIMAL(10,3) NOT NULL DEFAULT 1,
    "preco" DECIMAL(12,2),
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "itens_da_revisao_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "revisoes_do_veiculo_veiculo_id_data_idx" ON "revisoes_do_veiculo"("veiculo_id", "data");
CREATE INDEX "itens_da_revisao_revisao_id_idx" ON "itens_da_revisao"("revisao_id");

ALTER TABLE "revisoes_do_veiculo" ADD CONSTRAINT "revisoes_do_veiculo_veiculo_id_fkey" FOREIGN KEY ("veiculo_id") REFERENCES "veiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "itens_da_revisao" ADD CONSTRAINT "itens_da_revisao_revisao_id_fkey" FOREIGN KEY ("revisao_id") REFERENCES "revisoes_do_veiculo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
