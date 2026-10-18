export interface DocRef {
  id: string;
  label: string;
  href: string;
  kind: "download" | "reference" | "code";
  blurb: string;
}

export const RESOURCES: DocRef[] = [
  {
    id: "briefing-docx",
    label: "Project briefing (Word)",
    kind: "download",
    href: "/docs/seen-but-not-grasped-briefing.docx",
    blurb: "The full project briefing as a shareable Word document.",
  },
  {
    id: "bbq-v",
    label: "BBQ-V: Benchmarking Visual Stereotype Bias in Large Multimodal Models",
    kind: "reference",
    href: "https://arxiv.org/abs/2502.08779",
    blurb:
      "The current state of the art in visual stereotype-bias benchmarking: 14,144 image-question pairs over 9 categories with real, multi-actor images, and a finding that reasoning models can amplify bias in their chains. Our forced-choice probes are designed next to this work.",
  },
  {
    id: "grip",
    label: "GRIP, prior work",
    kind: "reference",
    href: "https://arxiv.org/abs/2610.16170",
    blurb: "The group's geometric-reasoning benchmark.",
  },
  {
    id: "realworld",
    label: "They See It, They Don't Get It",
    kind: "reference",
    href: "https://realworld-ebon.vercel.app",
    blurb: "The group's earlier real-world stress test of vision-language models.",
  },
  // VERIFY (open question): confirm this is the paper Bilal meant before wide sharing.
  {
    id: "facebench",
    label: "FaceBench, related work",
    kind: "reference",
    href: "https://arxiv.org/abs/2503.21457",
    blurb: "Hierarchical facial-attribute VQA at scale.",
  },
  {
    id: "physbench",
    label: "PhysBench, related work",
    kind: "reference",
    href: "https://arxiv.org/abs/2501.16411",
    blurb: "Physical-world understanding for VLMs.",
  },
  {
    id: "repo",
    label: "Project repository",
    kind: "code",
    href: "https://github.com/mmaaaaz/agi-eval-data",
    blurb: "The pipeline, the harness and this site.",
  },
];
