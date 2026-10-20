-- O comprovante do banco anexado ao título no IXC (Já pagos e Contabilidade).
ALTER TABLE "pagamentos_no_banco" ADD COLUMN "comprovante_em" TIMESTAMP(3);
ALTER TABLE "pagamentos_no_banco" ADD COLUMN "comprovante_erro" TEXT;
