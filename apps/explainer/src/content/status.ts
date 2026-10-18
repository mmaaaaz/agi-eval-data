export const STATUS = [
  {
    label: "live",
    text: "Contribution site: image selection and question authoring, with two-person review before approval.",
  },
  {
    label: "built",
    text: "Measurement harness: runs locally and returns results to the site. Only model inference costs money.",
  },
  {
    label: "planned",
    text: "Question drafting across the whole dataset, with human review on every admitted item.",
  },
  {
    label: "target",
    text: "Results freeze: 1 November 2026.",
  },
] as const;
