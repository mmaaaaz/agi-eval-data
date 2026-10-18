import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Layout } from "./components/Layout";
import { HomePage } from "./routes/Home";
import { BenchmarkPage } from "./routes/Benchmark";
import { QuestionsPage } from "./routes/Questions";
import { CategoriesPage } from "./routes/Categories";
import { SamplesPage } from "./routes/Samples";
import { EvaluationPage } from "./routes/Evaluation";
import { ModelsPage } from "./routes/Models";
import { RoadmapPage } from "./routes/Roadmap";
import { FaqPage } from "./routes/Faq";

export const ROUTE_PATHS = [
  "/", "/benchmark", "/questions", "/categories", "/samples",
  "/evaluation", "/models", "/roadmap", "/faq",
] as const;

const rootRoute = createRootRoute({ component: Layout });

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomePage });
const benchmarkRoute = createRoute({ getParentRoute: () => rootRoute, path: "/benchmark", component: BenchmarkPage });
const questionsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/questions", component: QuestionsPage });
const categoriesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/categories", component: CategoriesPage });
const samplesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/samples", component: SamplesPage });
const evaluationRoute = createRoute({ getParentRoute: () => rootRoute, path: "/evaluation", component: EvaluationPage });
const modelsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/models", component: ModelsPage });
const roadmapRoute = createRoute({ getParentRoute: () => rootRoute, path: "/roadmap", component: RoadmapPage });
const faqRoute = createRoute({ getParentRoute: () => rootRoute, path: "/faq", component: FaqPage });

export const routeTree = rootRoute.addChildren([
  indexRoute,
  benchmarkRoute,
  questionsRoute,
  categoriesRoute,
  samplesRoute,
  evaluationRoute,
  modelsRoute,
  roadmapRoute,
  faqRoute,
]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
