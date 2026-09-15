-- Contas a pagar: títulos em aberto que alguém tirou da lista.
--
-- Só a tela deixa de mostrá-los; a conta continua devida no IXC e nos totais.

CREATE TABLE "contas_ocultas" (
    "id_fn_apagar" INTEGER NOT NULL,
    "ocultado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contas_ocultas_pkey" PRIMARY KEY ("id_fn_apagar")
);
