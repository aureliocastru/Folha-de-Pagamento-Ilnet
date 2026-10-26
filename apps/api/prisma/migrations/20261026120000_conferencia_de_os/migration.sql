-- A conferência das OS fechadas, pelo chefe do almoxarifado: o veredito, de
-- quem, e o retrato do que se viu. A OS é do IXC e continua sendo lida de lá.
CREATE TYPE "SituacaoDaConferencia" AS ENUM ('CONFERIDA', 'PROBLEMA', 'RESOLVIDA');

CREATE TABLE "conferencias_de_os" (
    "id" TEXT NOT NULL,
    "os_ixc_id" INTEGER NOT NULL,
    "dia" TEXT NOT NULL,
    "tecnico_ixc_id" INTEGER NOT NULL,
    "tecnico" TEXT,
    "cliente" TEXT,
    "assunto" TEXT,
    "situacao" "SituacaoDaConferencia" NOT NULL,
    "teve_problema" BOOLEAN NOT NULL DEFAULT false,
    "motivo" TEXT,
    "observacao" TEXT,
    "sinais" JSONB,
    "conferida_por" TEXT NOT NULL,
    "conferida_em" TIMESTAMP(3) NOT NULL,
    "resposta_do_tecnico" TEXT,
    "respondida_em" TIMESTAMP(3),
    "resolucao" TEXT,
    "resolvida_por" TEXT,
    "resolvida_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conferencias_de_os_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conferencias_de_os_os_ixc_id_key" ON "conferencias_de_os"("os_ixc_id");

CREATE INDEX "conferencias_de_os_dia_idx" ON "conferencias_de_os"("dia");

CREATE INDEX "conferencias_de_os_situacao_idx" ON "conferencias_de_os"("situacao");

CREATE INDEX "conferencias_de_os_tecnico_ixc_id_situacao_idx" ON "conferencias_de_os"("tecnico_ixc_id", "situacao");
