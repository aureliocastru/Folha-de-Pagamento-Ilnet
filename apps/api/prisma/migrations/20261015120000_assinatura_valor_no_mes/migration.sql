-- A assinatura que cobra uns centavos a mais ou a menos num mês guarda o
-- valor daquela fatura, sem mexer no de todo mês.
ALTER TABLE "compras_no_cartao" ADD COLUMN "valores_no_mes" JSONB;
