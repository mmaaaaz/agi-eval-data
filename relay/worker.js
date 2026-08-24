import { handle } from "./relay.mjs";

export default {
  fetch: (request, env) => handle(request, env),
};
