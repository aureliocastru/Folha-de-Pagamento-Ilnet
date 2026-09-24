-- Ordens de serviço: o que o técnico instala, retira e gasta em cada OS do
-- IXC, e os descartáveis que contam como material de OS.

CREATE TYPE "TipoItemDeOs" AS ENUM ('INSTALADO', 'RETIRADO', 'MATERIAL', 'DIVERGENCIA');

CREATE TYPE "SituacaoItemDeOs" AS ENUM ('PENDENTE', 'GRAVANDO', 'GRAVADO', 'FALHOU', 'CONFERIR');

CREATE TYPE "CondicaoDoRetirado" AS ENUM ('FUNCIONANDO', 'DEFEITO', 'NAO_TESTADO');

CREATE TABLE "registros_de_os" (
    "id" TEXT NOT NULL,
    "os_ixc_id" INTEGER NOT NULL,
    "protocolo" TEXT,
    "assunto" TEXT,
    "cliente_id" INTEGER,
    "cliente" TEXT,
    "contrato_id" INTEGER,
    "endereco" TEXT,
    "filial_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registros_de_os_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "itens_de_os" (
    "id" TEXT NOT NULL,
    "registro_id" TEXT NOT NULL,
    "tipo" "TipoItemDeOs" NOT NULL,
    "situacao" "SituacaoItemDeOs" NOT NULL DEFAULT 'PENDENTE',
    "tecnico_id" TEXT NOT NULL,
    "almox_id" INTEGER NOT NULL,
    "almoxarifado" TEXT NOT NULL,
    "produto_id" INTEGER,
    "descricao" TEXT NOT NULL,
    "unidade" TEXT,
    "quantidade" DECIMAL(18,5) NOT NULL,
    "valor_unitario" DECIMAL(14,4),
    "patrimonio_id" INTEGER,
    "numero_patrimonial" TEXT,
    "mac" TEXT,
    "numero_serie" TEXT,
    "comodato_ixc_id" INTEGER,
    "movimento_ixc_id" INTEGER,
    "condicao" "CondicaoDoRetirado",
    "observacao" TEXT,
    "erro" TEXT,
    "aviso" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "gravado_em" TIMESTAMP(3),
    "recebido_em" TIMESTAMP(3),
    "recebido_por" TEXT,
    "destino_almox_id" INTEGER,
    "destino_almox" TEXT,
    "transferencia_ixc_id" INTEGER,
    "registrado_por" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "itens_de_os_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "materiais_de_os" (
    "id" TEXT NOT NULL,
    "produto_id" INTEGER NOT NULL,
    "descricao" TEXT NOT NULL,
    "unidade" TEXT,
    "aparelho" BOOLEAN NOT NULL DEFAULT false,
    "maximo_por_os" DECIMAL(18,5),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criado_por" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "materiais_de_os_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "almox_do_tecnico" (
    "funcionario_id" TEXT NOT NULL,
    "almox_id" INTEGER NOT NULL,
    "almoxarifado" TEXT NOT NULL,
    "definido_por" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "almox_do_tecnico_pkey" PRIMARY KEY ("funcionario_id")
);

CREATE UNIQUE INDEX "registros_de_os_os_ixc_id_key" ON "registros_de_os"("os_ixc_id");

CREATE INDEX "registros_de_os_created_at_idx" ON "registros_de_os"("created_at");

CREATE INDEX "itens_de_os_registro_id_idx" ON "itens_de_os"("registro_id");

CREATE INDEX "itens_de_os_tipo_situacao_idx" ON "itens_de_os"("tipo", "situacao");

CREATE INDEX "itens_de_os_tecnico_id_gravado_em_idx" ON "itens_de_os"("tecnico_id", "gravado_em");

CREATE INDEX "itens_de_os_patrimonio_id_idx" ON "itens_de_os"("patrimonio_id");

CREATE UNIQUE INDEX "materiais_de_os_produto_id_key" ON "materiais_de_os"("produto_id");

ALTER TABLE "itens_de_os" ADD CONSTRAINT "itens_de_os_registro_id_fkey" FOREIGN KEY ("registro_id") REFERENCES "registros_de_os"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "itens_de_os" ADD CONSTRAINT "itens_de_os_tecnico_id_fkey" FOREIGN KEY ("tecnico_id") REFERENCES "funcionarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "almox_do_tecnico" ADD CONSTRAINT "almox_do_tecnico_funcionario_id_fkey" FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nenhum login ganha a tela das OS aqui, de propósito: as escritas na OS do IXC
-- ainda não foram provadas nesta base (ver docs/ixc/README.md). A equipe entra
-- quando o administrador marca "Ordens de serviço" no login, na tela de
-- Usuários — depois da troca de teste.
