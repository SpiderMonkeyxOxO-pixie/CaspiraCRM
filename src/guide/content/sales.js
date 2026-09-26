// Sales page guides. Plain language for everyday staff; tour targets are
// data-tour="…" attributes on the pages.
const sales = [
  {
    path: "/sales/dashboard",
    title: "Sales Dashboard",
    purpose: "A quick look at your selling: how many quotes are out, which ones are waiting for the customer, the value of your orders and how many contracts are signed.",
    sections: [
      { heading: "Key figures", body: "Quotes counts every quote. Awaiting Response counts quotes you have sent that the customer hasn't answered yet. Order Value adds up your orders. Signed Contracts counts contracts both sides have signed." },
      { heading: "Quotes and orders by status", body: "The two charts show how many quotes and orders are at each step. Click a bar to open the list filtered to that status." },
      { heading: "Quotes to follow up", body: "Sent quotes still waiting for an answer, so you know whom to call." },
      { heading: "Recent orders", body: "The latest orders. Click one to open it." },
    ],
    tips: ["Start your day with Quotes to Follow Up: a quick call often turns a waiting quote into an order."],
    tour: [
      { target: "sales-kpis", title: "Your sales at a glance", body: "Quotes, quotes waiting for the customer, order value and signed contracts. Click a card to see the records behind it." },
      { target: "sales-status", title: "Where things stand", body: "How many quotes and orders are at each step. Click a bar to open that list." },
    ],
  },
  {
    path: "/sales/products",
    title: "Products & Services",
    purpose: "Your catalog: everything you sell, with its price. Quotes, orders and contracts pick their items from here, so keep it accurate.",
    sections: [
      { heading: "Types of item", body: "Product is a physical or software item. Service is work you do. Package is a bundle of other items sold together. Add-on is an extra that is sold with another item." },
      { heading: "How it is billed", body: "One Time is paid once. Recurring repeats every week, month, quarter or year. Usage Based depends on how much the customer uses. Custom Quote has no fixed price; you set it on each quote." },
      { heading: "Summary cards", body: "Counts of active items by type and billing. Needs Attention lists items with something missing, such as a price. Click a card to filter the list." },
      { heading: "Search and filters", body: "Search by name or SKU and filter by type, status or category. Tick Archived to see items that are no longer sold." },
      { heading: "Status", body: "Draft items can't be added to quotes yet. Active items can be sold. Inactive items are paused. Archived items are put away but kept for history." },
    ],
    tips: ["Changing a price doesn't change quotes or orders already made. They keep the price they were made with."],
    tour: [
      { target: "products-add", title: "Add an item", body: "Create a new product, service, package or add-on with its price." },
      { target: "products-summary", title: "Your catalog at a glance", body: "Active items by type and billing. Needs Attention shows items with missing details. Click a card to filter." },
      { target: "products-filters", title: "Find an item", body: "Search by name or SKU, and filter by type, status or category." },
      { target: "products-table", title: "The catalog", body: "Click an item to open it and see its pricing, the deals and quotes that use it, and its history." },
    ],
  },
  {
    path: "/sales/products/:productId",
    title: "Product or service",
    purpose: "Everything about one catalog item: its details, its price, and where it is being sold.",
    sections: [
      { heading: "Actions", body: "Edit changes the details and price. Change Status makes it Active, Inactive or Draft. Add to Deal puts the item on a deal's line items. Duplicate makes a copy to start a similar item. Archive stops it being sold without losing its history." },
      { heading: "Tabs", body: "Overview is the description and settings. Pricing shows the list price and the price in each price book. Package Contents (packages only) lists what is inside. Compatible Add-ons lists extras that go with it. Related Deals and Related Quotes show where it is used. Activity shows what changed." },
    ],
    tour: [
      { target: "product-actions", title: "What you can do", body: "Edit the item, change its status, add it to a deal, duplicate it or archive it." },
      { target: "product-tabs", title: "Details, prices and use", body: "Switch between the description, pricing, bundle contents, add-ons and the deals and quotes that use this item." },
    ],
  },
  {
    path: "/sales/price-books",
    title: "Price Books",
    purpose: "A price book is a price list. The Standard price book holds your normal prices; other price books give different prices for a market, a currency or a group of customers.",
    sections: [
      { heading: "Kinds of price book", body: "Standard is your normal price list. Market is for a region, currency or customer group. Blank starts empty so you can add prices one by one." },
      { heading: "Status", body: "Draft is being prepared. Scheduled starts on a future date. Active is in use. Expired has passed its end date. Inactive is paused." },
      { heading: "Summary cards", body: "Pricing Conflicts means two price books could apply to the same quote with equal priority, so the system can't choose; fix these first. Items Missing Prices lists active catalog items with no price in a price book." },
      { heading: "Which price book a quote uses", body: "When you make a quote, the most specific active price book that fits the customer, currency and date is used. If none fits, the Standard price book is used." },
    ],
    tips: ["Give a new price list an end date if it is a promotion, so it stops by itself."],
    tour: [
      { target: "pricebooks-add", title: "Create a price book", body: "Start from Standard, Market or a blank price book." },
      { target: "pricebooks-summary", title: "Things to check", body: "Active, scheduled and expiring price books, plus conflicts and items missing prices. Click a card to filter." },
      { target: "pricebooks-filters", title: "Find a price book", body: "Search by name and filter by status, currency, market, customer group, company, sales channel or category." },
      { target: "pricebooks-table", title: "Your price books", body: "Click a price book to see and change its prices." },
    ],
  },
  {
    path: "/sales/price-books/:priceBookId",
    title: "Price Book",
    purpose: "One price list: which items it prices, at what price, for whom and when.",
    sections: [
      { heading: "Catalog Pricing", body: "The price of each item in this price book. Add, change or remove prices here." },
      { heading: "Applicability", body: "Who and when this price book is for: dates, currency, companies, categories and deal or contract types. Priority decides which one wins when several could apply." },
      { heading: "Quantity Tiers", body: "Lower unit prices for larger quantities, for example 10% off from 50 units." },
      { heading: "Price Preview", body: "Try a customer, item and quantity to see which price would be used. This is an estimate; the final price is set on the quote." },
      { heading: "Related Deals and Quotes", body: "Deals and quotes that use this price book." },
    ],
    tour: [
      { target: "pricebook-actions", title: "Manage this price book", body: "Edit the details, add catalog items, try a price, duplicate or compare it, or change its status." },
      { target: "pricebook-tabs", title: "Prices, rules and use", body: "Set prices, choose who the price book applies to, add quantity discounts and try out a price." },
    ],
  },
  {
    path: "/sales/quotes",
    title: "Quotes",
    purpose: "A quote is a priced offer to a customer. Make it here, get it approved if needed, send it, and record the customer's answer. An accepted quote becomes an order or a contract.",
    sections: [
      { heading: "How a quote moves", body: "Draft → Submit for Review → Mark as Sent → the customer's answer (Accepted, Rejected or changes requested). After you submit, a quote is in Internal Review and can be sent. If it needs a manager's approval it is Approval Pending first, and can be sent once Approved." },
      { heading: "When approval is needed", body: "A manager must approve a quote when a line has a discount above 20%, a price was typed over by hand, or the total is above 50,000. You can't approve your own quote." },
      { heading: "Sending", body: "Mark as Sent records who the quote went to. Nothing is emailed by the system: download the PDF and send it to the customer yourself." },
      { heading: "Summary cards", body: "Counts of draft, waiting-for-approval, approved and sent quotes, quotes expiring soon, and the value of accepted quotes. Click a card to filter." },
      { heading: "Search, filters and views", body: "Search by number, title or customer. Filter by status, approval, company, deal, owner, currency or price book. Views saves a filter setup to reopen it later." },
    ],
    tips: [
      "A quote stops being valid after its Valid Until date. Make a new version to offer it again.",
      "To change a sent quote, make a new version; the old one is kept as Superseded.",
    ],
    tour: [
      { target: "quotes-add", title: "Create a quote", body: "Choose the customer, add items from the catalog and set discounts. It is saved as a Draft." },
      { target: "quotes-summary", title: "Your quotes at a glance", body: "Drafts, quotes waiting for approval, approved and sent quotes, and ones about to expire. Click a card to filter." },
      { target: "quotes-filters", title: "Find a quote", body: "Search and filter by status, approval, company or deal." },
      { target: "quotes-table", title: "The quote list", body: "Click a quote to open it. The menu at the end of each row has the next steps, such as Mark as Sent." },
    ],
  },
  {
    path: "/sales/quotes/:id",
    title: "Quote",
    purpose: "One quote: its items and total, its approval, the document the customer sees, and what happened to it.",
    sections: [
      { heading: "Actions", body: "Edit changes a draft. Document shows the customer version. New Version makes a changed copy and keeps this one. Submit for Review sends it for approval. The More menu has Mark as Sent, Record Customer Response, Duplicate, Compare and Cancel." },
      { heading: "Recording the customer's answer", body: "Record Customer Response saves what the customer said: accepted (with the name they signed with), rejected (with the reason), or asked for changes (the quote goes back to Draft)." },
      { heading: "After acceptance", body: "Use Create Order to deliver it, or Prepare Contract for a signed agreement. Both copy the quote's items and prices." },
      { heading: "Tabs", body: "Overview is the summary. Line Items lists what is being sold. Document is the customer version with Download PDF and Print. Approvals shows the review and comments. Activity and Versions show the history." },
    ],
    tour: [
      { target: "quote-actions", title: "Move the quote forward", body: "Edit, view the document, make a new version, or submit it for review." },
      { target: "quote-more", title: "More steps", body: "Mark as Sent after you send the PDF, record the customer's answer, compare versions, duplicate or cancel." },
      { target: "quote-tabs", title: "Details and history", body: "Items, the customer document, approvals, activity and earlier versions." },
    ],
  },
  {
    path: "/sales/orders",
    title: "Orders",
    purpose: "An order is what the customer has agreed to buy. Use it to deliver the items and to hand the order to Finance for invoicing.",
    sections: [
      { heading: "Creating an order", body: "Create from Accepted Quote copies the items and prices of an accepted quote. Create Manual Order starts from scratch." },
      { heading: "How an order moves", body: "Draft → Pending Review → Confirmed → Processing → Partially Fulfilled → Fulfilled → Completed. On Hold pauses an order; Cancelled stops it." },
      { heading: "Summary cards", body: "Open orders, the value of confirmed orders, orders being processed, partly delivered or on hold, and orders waiting to be invoiced. Click a card to filter." },
      { heading: "Search and filters", body: "Search by order number or customer and filter by status, order type, company, deal, owner or currency." },
    ],
    tips: ["Check Awaiting Billing Handoff regularly: these orders are delivered but not invoiced yet."],
    tour: [
      { target: "orders-add", title: "Create an order", body: "From an accepted quote, or by hand." },
      { target: "orders-summary", title: "Your orders at a glance", body: "Open, processing, on-hold and ready-to-invoice orders. Click a card to filter." },
      { target: "orders-filters", title: "Find an order", body: "Search and filter the list." },
      { target: "orders-table", title: "The order list", body: "Click an order to open it and record delivery." },
    ],
  },
  {
    path: "/sales/orders/:id",
    title: "Order",
    purpose: "One order: what is being delivered, how far delivery has come, and whether it has been invoiced.",
    sections: [
      { heading: "Actions", body: "The buttons follow the order's step: Submit for Review, Confirm, Start Processing, Put On Hold or Resume, Mark Fulfilled, Mark Completed and Cancel." },
      { heading: "Fulfillment", body: "Record how much of each line has been delivered or done. The order becomes Partially Fulfilled or Fulfilled by itself." },
      { heading: "Billing", body: "Once the order is confirmed, Request Invoice creates a draft invoice in Finance from the order's lines. Finance then checks and sends it. An order can have one open invoice." },
      { heading: "Other tabs", body: "Line Items lists what was ordered. Related Records links the quote, deal and contract. Document is the order confirmation with Download PDF and Print. Activity is the history." },
      { heading: "Cancelling", body: "Cancel asks for a reason. The customer isn't told automatically, so let them know yourself." },
    ],
    tour: [
      { target: "order-actions", title: "Move the order forward", body: "Confirm, process, pause, complete or cancel the order. Only the next sensible steps are shown." },
      { target: "order-fulfil", title: "Record delivery", body: "Opens the Fulfillment tab, where you record what has been delivered." },
      { target: "order-tabs", title: "Delivery, billing and history", body: "Items, delivery progress, invoicing, linked records, the order document and activity." },
    ],
  },
  {
    path: "/sales/contracts",
    title: "Contracts",
    purpose: "A contract is the signed agreement with a customer: what you provide, for how long and at what price. Keep contracts here to track signatures, renewals and end dates.",
    sections: [
      { heading: "Creating a contract", body: "Prepare from Quote (an accepted quote), Generate from Order, Generate from Won Deal, or Create Manual Contract. The items and prices are copied in." },
      { heading: "How a contract moves", body: "Draft → Pending Internal Review → Sent for Signature → Signed. Later it can be renewed, or it ends as Expired, Terminated or Cancelled." },
      { heading: "Signatures", body: "Signatures are recorded here, not collected electronically. Get the contract signed on paper or with your own e-signature tool, then record who signed and when." },
      { heading: "Summary cards", body: "Contracts by stage, with ones needing renewal or about to expire. Click a card to filter." },
    ],
    tips: ["Watch for Renewal due and Expiring soon badges, so a contract never ends by surprise."],
    tour: [
      { target: "contracts-add", title: "Create a contract", body: "From an accepted quote, an order, a won deal, or by hand." },
      { target: "contracts-summary", title: "Your contracts at a glance", body: "Contracts by stage. Click a card to filter the list." },
      { target: "contracts-table", title: "The contract list", body: "Click a contract to open it. The row menu has View, Edit Draft, Duplicate and Archive." },
    ],
  },
  {
    path: "/sales/contracts/:id",
    title: "Contract",
    purpose: "One contract: its terms, who must sign it, renewal dates and the full history.",
    sections: [
      { heading: "Actions", body: "Submit for Review sends a draft for internal checking. Send for Signature marks it as out for signing. Record Internal Signature and Record Customer Signature save each signature. Renew starts the next period. Cancel stops a contract before it starts; Terminate ends a signed one early. Each asks for a reason." },
      { heading: "Signatories", body: "Who has to sign on each side, and who already has. A badge warns while a signature is missing." },
      { heading: "Renewal & Amendments", body: "Start and end dates, the renewal type and notice period, and any renewals or changes made." },
      { heading: "Other tabs", body: "Line Items is what the contract covers. Related Records links the quote, order and deal. Document is the contract text with Download PDF and Print. Activity is the history." },
    ],
    tips: ["A contract is binding only after both sides have signed it."],
    tour: [
      { target: "contract-actions", title: "Move the contract forward", body: "Edit a draft, duplicate it, send it for signature, record signatures, renew, cancel or terminate." },
      { target: "contract-tabs", title: "Terms, signatures and renewal", body: "Items, signatories, renewal dates, linked records, the contract document and activity." },
    ],
  },
];

export default sales;
