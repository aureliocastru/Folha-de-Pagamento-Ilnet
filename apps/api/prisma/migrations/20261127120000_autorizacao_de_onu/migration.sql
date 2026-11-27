-- Autorizar ONU pela OS (pedido de 27/11/2026).
--
-- O técnico autoriza a ONU na OLT pela tela da OS, do mesmo jeito do botão
-- "Autorizar ONUs" do IXC. O IXC registra a autorização no nome do usuário do
-- token da API; esta tabela guarda quem foi de verdade, por qual OS, e o que a
-- OLT respondeu.

-- CreateEnum
CREATE TYPE "SituacaoAutorizacaoOnu" AS ENUM ('GRAVANDO', 'AUTORIZADA', 'RECUSADA', 'INCERTA');

-- CreateTable
CREATE TABLE "autorizacoes_de_onu" (
    "id" TEXT NOT NULL,
    "os_ixc_id" INTEGER NOT NULL,
    "login_ixc_id" INTEGER NOT NULL,
    "fibra_ixc_id" INTEGER,
    "reaproveitou" BOOLEAN NOT NULL DEFAULT false,
    "mac_anterior" TEXT,
    "olt_ixc_id" INTEGER NOT NULL,
    "olt" TEXT NOT NULL,
    "ponid" TEXT NOT NULL,
    "mac" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "caixa_ixc_id" INTEGER NOT NULL,
    "caixa" TEXT,
    "porta" INTEGER NOT NULL,
    "perfil_ixc_id" INTEGER NOT NULL,
    "perfil" TEXT,
    "vlan" TEXT NOT NULL,
    "situacao" "SituacaoAutorizacaoOnu" NOT NULL DEFAULT 'GRAVANDO',
    "retorno" TEXT,
    "tecnico_id" TEXT NOT NULL,
    "registrado_por" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "autorizacoes_de_onu_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "autorizacoes_de_onu_os_ixc_id_idx" ON "autorizacoes_de_onu"("os_ixc_id");

-- CreateIndex
CREATE INDEX "autorizacoes_de_onu_mac_idx" ON "autorizacoes_de_onu"("mac");

-- AddForeignKey
ALTER TABLE "autorizacoes_de_onu" ADD CONSTRAINT "autorizacoes_de_onu_tecnico_id_fkey" FOREIGN KEY ("tecnico_id") REFERENCES "funcionarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

