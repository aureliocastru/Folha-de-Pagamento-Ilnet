-- A parcela do parcelamento na SEFAZ tambem se paga todo mes, enquanto o acordo
-- durar, e vem num DARE igual ao do ICMS -- so que a relacao de pagamentos traz
-- o numero da parcela onde o ICMS traz o mes. E divida estadual, entao entra
-- inteira como tributo sobre faturamento.
--
-- Como o DARE_ICMS, o valor novo vai antes de OUTRA para o enum seguir a ordem
-- de leitura das guias.

-- AlterEnum
ALTER TYPE "TipoGuia" ADD VALUE IF NOT EXISTS 'PARCELAMENTO_SEFAZ' BEFORE 'OUTRA';
