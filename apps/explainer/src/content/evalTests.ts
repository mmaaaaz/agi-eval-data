export interface EvalTest {
  lead: string;
  detail: string;
}

export const EVAL_TESTS: EvalTest[] = [
  {
    lead: "Paired accuracy with confidence intervals.",
    detail:
      "Every model answers the same items, and the interval is computed across those items. Spotting a 2-point gap in a paired design takes about 1,440 items. The benchmark holds 5,000 so every question family and every category clears its own reporting floor.",
  },
  {
    lead: "The no-image baseline.",
    detail:
      "We ask every question a second time with the photograph removed. Anything a model answers correctly without the image was never a vision question.",
  },
  {
    lead: "The constant-answer baseline.",
    detail:
      "We record what a model scores by always answering the same thing. Below that line, it has learned nothing about the task.",
  },
  {
    lead: "Calibration (ECE and Brier).",
    detail: "Does the model know when it is unsure? Almost no VQA benchmark checks.",
  },
  {
    lead: "Abstention, on one defined subset.",
    detail:
      "Some photographs genuinely cannot settle a question, through occlusion or a missing scale reference. There, and only there, we offer an explicit “cannot be determined” option.",
  },
  {
    lead: "Option-order robustness.",
    detail: "We rotate the answer options. A correct pick that does not survive rotation was position bias.",
  },
  {
    lead: "Option leakage.",
    detail: "Can the right answer be found from the image and the options alone, with the question removed?",
  },
  {
    lead: "Per-capability floors.",
    detail: "No category score gets reported from too few items.",
  },
  {
    lead: "A documented human baseline.",
    detail: "Two tiers of human performance, with the protocol declared before anyone starts.",
  },
];
