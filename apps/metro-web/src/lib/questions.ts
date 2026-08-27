/**
 * Re-export of the shared questions/evaluations API client, plus the
 * app-specific text normalization from @agi-eval/shared (the relay's dedupe
 * enforcement MUST stay identical to the metro app's live checks).
 */
export {
  familyOf,
  craftedPrompt,
  OR_MODELS_URL,
  OR_CHAT_URL,
  fetchOpenRouterModels,
  runOpenRouter,
  questionsApi,
} from "@site/questions";
export type {
  QRow,
  EvalRow,
  Insights,
  ORModel,
  SiteMeta,
} from "@site/questions";

import { normQ, normTags as parseTags } from "@agi-eval/shared";
export { normQ, parseTags };
