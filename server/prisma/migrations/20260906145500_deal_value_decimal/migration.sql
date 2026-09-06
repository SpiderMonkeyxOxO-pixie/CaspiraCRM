-- AlterTable
ALTER TABLE "contract_line_items" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "deal_line_items" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "deals" ALTER COLUMN "value" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "order_line_items" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "price_book_entries" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "quote_line_items" ALTER COLUMN "updatedAt" DROP DEFAULT;

