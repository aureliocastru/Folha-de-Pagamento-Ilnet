-- A assinatura do cliente na finalização pelo celular. A imagem vai direto para
-- os arquivos da OS no IXC; aqui fica só quem assinou, ou por que não assinou,
-- que entram na mensagem do fechamento.
ALTER TABLE "finalizacoes_de_os" ADD COLUMN "assinada_por" TEXT,
ADD COLUMN "sem_assinatura" TEXT;
