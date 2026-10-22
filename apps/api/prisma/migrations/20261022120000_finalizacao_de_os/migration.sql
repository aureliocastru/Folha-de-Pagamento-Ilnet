-- A OS finalizada pelo celular: o passo a passo do técnico e a fila de levá-lo ao IXC.
CREATE TABLE "finalizacoes_de_os" (
    "id" TEXT NOT NULL,
    "registro_id" TEXT NOT NULL,
    "situacao" "SituacaoItemDeOs" NOT NULL DEFAULT 'PENDENTE',
    "tecnico_id" TEXT NOT NULL,
    "tecnico_ixc_id" INTEGER NOT NULL,
    "resposta_id" INTEGER,
    "resposta" TEXT,
    "diagnostico_id" INTEGER,
    "diagnostico" TEXT,
    "relato" TEXT NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    "gera_comissao" BOOLEAN NOT NULL DEFAULT false,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "precisao" INTEGER,
    "gps_em" TIMESTAMP(3),
    "erro" TEXT,
    "aviso" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "gravado_em" TIMESTAMP(3),
    "registrado_por" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finalizacoes_de_os_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "finalizacoes_de_os_registro_id_key" ON "finalizacoes_de_os"("registro_id");

CREATE INDEX "finalizacoes_de_os_situacao_idx" ON "finalizacoes_de_os"("situacao");

CREATE INDEX "finalizacoes_de_os_tecnico_id_gravado_em_idx" ON "finalizacoes_de_os"("tecnico_id", "gravado_em");

ALTER TABLE "finalizacoes_de_os" ADD CONSTRAINT "finalizacoes_de_os_registro_id_fkey" FOREIGN KEY ("registro_id") REFERENCES "registros_de_os"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "finalizacoes_de_os" ADD CONSTRAINT "finalizacoes_de_os_tecnico_id_fkey" FOREIGN KEY ("tecnico_id") REFERENCES "funcionarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
