import { configureStore } from "@reduxjs/toolkit";
import authSliceReducer from './authSlice'
import notificationSliceReducer from './NotificationSlice'
import leadsSliceReducer from './crm/leadsSlice'
import companiesSliceReducer from './crm/companiesSlice'
import contactsSliceReducer from './crm/contactsSlice'
import dealsSliceReducer from './crm/dealsSlice'
import activitiesSliceReducer from './crm/activitiesSlice'
import duplicatesSliceReducer from './crm/duplicatesSlice'
import productsSliceReducer from './sales/productsSlice'
import priceBooksSliceReducer from './sales/priceBooksSlice'
import quotesSliceReducer from './sales/quotesSlice'
import ordersSliceReducer from './sales/ordersSlice'
import contractsSliceReducer from './sales/contractsSlice'
import ticketsSliceReducer from './support/ticketsSlice'
import projectsSliceReducer from './projects/projectsSlice'
import tasksSliceReducer from './projects/tasksSlice'
import campaignsSliceReducer from './marketing/campaignsSlice'
import segmentsSliceReducer from './marketing/segmentsSlice'
import formsSliceReducer from './marketing/formsSlice'
import templatesSliceReducer from './marketing/templatesSlice'
import invoicesSliceReducer from './finance/invoicesSlice'
import creditNotesSliceReducer from './finance/creditNotesSlice'
import expensesSliceReducer from './finance/expensesSlice'
import recurringInvoicesSliceReducer from './finance/recurringInvoicesSlice'
import adminRolesSliceReducer from './admin/rolesSlice'
import accessManagementSliceReducer from './admin/accessManagementSlice'
import integrationsSliceReducer from './admin/integrationsSlice'
import aiSliceReducer from './ai/aiSlice'
import aiCopilotSliceReducer from './ai/aiCopilotSlice'
import aiExploreSliceReducer from './ai/aiExploreSlice'

const store = configureStore({
    reducer: {
        auth: authSliceReducer,
        notifications: notificationSliceReducer,
        leads: leadsSliceReducer,
        companies: companiesSliceReducer,
        contacts: contactsSliceReducer,
        deals: dealsSliceReducer,
        activities: activitiesSliceReducer,
        duplicates: duplicatesSliceReducer,
        products: productsSliceReducer,
        priceBooks: priceBooksSliceReducer,
        quotes: quotesSliceReducer,
        orders: ordersSliceReducer,
        contracts: contractsSliceReducer,
        tickets: ticketsSliceReducer,
        projects: projectsSliceReducer,
        tasks: tasksSliceReducer,
        campaigns: campaignsSliceReducer,
        segments: segmentsSliceReducer,
        forms: formsSliceReducer,
        templates: templatesSliceReducer,
        invoices: invoicesSliceReducer,
        creditNotes: creditNotesSliceReducer,
        expenses: expensesSliceReducer,
        recurringInvoices: recurringInvoicesSliceReducer,
        adminRoles: adminRolesSliceReducer,
        accessManagement: accessManagementSliceReducer,
        integrations: integrationsSliceReducer,
        ai: aiSliceReducer,
        aiCopilot: aiCopilotSliceReducer,
        aiExplore: aiExploreSliceReducer,
    },
    devtools: true
})

export default store; 