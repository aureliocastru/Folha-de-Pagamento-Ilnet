-- "Ja conferi": a ressalva de um pagamento que alguem olhou e deu por boa.
--
-- A ressalva nasce da leitura do IXC a cada abertura da tela, entao ela
-- voltava todo dia mesmo depois de conferida. Guardando o que foi conferido --
-- o texto das ressalvas daquele momento --, o aviso so volta se o IXC passar a
-- apontar outra coisa.

CREATE TABLE "pagamentos_conferidos" (
    "id" TEXT NOT NULL,
    "id_fn_apagar" INTEGER NOT NULL,
    "impressao" TEXT NOT NULL,
    "conferido_por" TEXT NOT NULL,
    "conferido_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagamentos_conferidos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pagamentos_conferidos_id_fn_apagar_key"
  ON "pagamentos_conferidos"("id_fn_apagar");
