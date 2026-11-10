-- Mapa de servico: qual tecnico anda com cada rastreador da frota.
--
-- O rastreador nao sabe quem esta no carro, e o campo do IXC para isso
-- (funcionarios.rastreador) esta vazio. No ILNET Service Map a ligacao era um
-- arquivo no servidor (config/vinculos.json); aqui ela e guardada no banco e
-- feita pela tela de Rastreadores.

-- CreateTable
CREATE TABLE "rastreadores_dos_tecnicos" (
    "dispositivo_id" TEXT NOT NULL,
    "nome_do_veiculo" TEXT,
    "tecnico_ixc_id" INTEGER,
    "tecnico_nome" TEXT,
    "equipe" TEXT,
    "atualizado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rastreadores_dos_tecnicos_pkey" PRIMARY KEY ("dispositivo_id")
);

-- CreateIndex
CREATE INDEX "rastreadores_dos_tecnicos_tecnico_ixc_id_idx" ON "rastreadores_dos_tecnicos"("tecnico_ixc_id");
