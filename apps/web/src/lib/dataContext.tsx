/**
 * App data context — re-exported from the shared @site/dataContext so routes
 * and the AppShell share ONE React context object. Keeping this thin file lets
 * existing `../lib/dataContext` imports keep working.
 */
export { DataProvider, useData } from "@site/dataContext";
