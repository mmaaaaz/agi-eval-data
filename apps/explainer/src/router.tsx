import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Layout } from "./components/Layout";
import { HomePage } from "./routes/Home";
import { BenchmarkPage } from "./routes/Benchmark";
import { QuestionsPage } from "./routes/Questions";
import { TaxonomyPage } from "./routes/Taxonomy";
import { SamplesPage } from "./routes/Samples";
import { ExperimentsPage } from "./routes/Experiments";
import { ModelsPage } from "./routes/Models";
import { CostsPage } from "./routes/Costs";
import { RoadmapPage } from "./routes/Roadmap";
import { FaqPage } from "./routes/Faq";

export const ROUTE_PATHS = [
  "/", "/benchmark", "/questions", "/taxonomy", "/samples",
  "/experiments", "/models", "/costs", "/roadmap", "/faq",
] as const;

const rootRoute = createRootRoute({ component: Layout });

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomePage });
const benchmarkRoute = createRoute({ getParentRoute: () => rootRoute, path: "/benchmark", component: BenchmarkPage });
const questionsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/questions", component: QuestionsPage });
const taxonomyRoute = createRoute({ getParentRoute: () => rootRoute, path: "/taxonomy", component: TaxonomyPage });
const samplesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/samples", component: SamplesPage });
const experimentsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/experiments", component: ExperimentsPage });
const modelsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/models", component: ModelsPage });
const costsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/costs", component: CostsPage });
const roadmapRoute = createRoute({ getParentRoute: () => rootRoute, path: "/roadmap", component: RoadmapPage });
const faqRoute = createRoute({ getParentRoute: () => rootRoute, path: "/faq", component: FaqPage });

export const routeTree = rootRoute.addChildren([
  indexRoute,
  benchmarkRoute,
  questionsRoute,
  taxonomyRoute,
  samplesRoute,
  experimentsRoute,
  modelsRoute,
  costsRoute,
  roadmapRoute,
  faqRoute,
]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
