-- Category of each template, so the Templates page can group them in tabs.
-- Existing rows get "outros" and the ready-made ones are classified below (only rows still on "outros").
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "category" text DEFAULT 'outros' NOT NULL;
--> statement-breakpoint
UPDATE "templates" SET "category" = 'picking' WHERE "category" = 'outros' AND "name" IN ('Picking - UC', 'Picking - Compacta (100x75)');
--> statement-breakpoint
UPDATE "templates" SET "category" = 'recebimento' WHERE "category" = 'outros' AND "name" IN ('Entrada - Recebimento', 'Devolucao - Nao Conformidade');
--> statement-breakpoint
UPDATE "templates" SET "category" = 'expedicao' WHERE "category" = 'outros' AND "name" IN ('Logistica - Expedicao', 'Expedicao - Compacta (100x100)', 'Volume - Embarque', 'Palete - SSCC');
--> statement-breakpoint
UPDATE "templates" SET "category" = 'materiais' WHERE "category" = 'outros' AND "name" IN ('Material - Identificacao Simples', 'Material (76x51)', 'Material (60x40)', 'Item Mini (40x25)', 'Lote e Validade (50x30)');
--> statement-breakpoint
UPDATE "templates" SET "category" = 'estoque' WHERE "category" = 'outros' AND "name" IN ('Endereco de Estoque', 'Endereco (60x40)', 'Transferencia entre Depositos');
--> statement-breakpoint
UPDATE "templates" SET "category" = 'producao' WHERE "category" = 'outros' AND "name" IN ('Produto Acabado', 'Producao - Apontamento', 'Qualidade - Status do Lote');
--> statement-breakpoint
UPDATE "templates" SET "category" = 'patrimonio' WHERE "category" = 'outros' AND "name" IN ('Patrimonio - Ativo');
