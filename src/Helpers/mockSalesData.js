// In-memory mock Sales "database" — same pattern as mockCrmData.js.
// Every Sales sub-module now has its own dedicated fixture file; this file
// is purely a re-export surface so existing imports of "mockSalesData"
// keep working.

// Products & Services now live in mockCatalogData.js — the single shared
// catalog used by Deals, Quotes, Price Books, and the /sales/products
// directory. No separate product fixture lives here.
// Quotes now live in mockQuoteData.js — the single shared Quote workspace
// used by /sales/quotes, and referenced from Deals/Companies/Products/Price
// Books detail pages. No separate Quote fixture collection lives here.
export { quotes, findQuoteRecord as findQuote } from "./mockQuoteData";
// Orders now live in mockOrderData.js — the single shared Order workspace
// used by /sales/orders, and referenced from Quotes/Deals/Companies detail
// pages. No separate Order fixture collection lives here.
export { orders, findOrderRecord as findOrder } from "./mockOrderData";

// Contracts now live in mockContractData.js — the single shared Contract
// workspace used by /sales/contracts, and referenced from Quotes/Orders/
// Deals detail pages. No separate Contract fixture collection lives here.
export { contracts, findContractRecord as findContract } from "./mockContractData";
