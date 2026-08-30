import { describe, expect, it } from "vitest";
import { gripImageUrl, upstreamBlobUrl, upstreamJsonUrl } from "./gripImage";

describe("gripImageUrl", () => {
  it("uses the media host (raw serves LFS pointer text)", () => {
    expect(gripImageUrl("Dataset/route_dataset_3000/images/route_puzzle_0001.png")).toBe(
      "https://media.githubusercontent.com/media/bilaljawaid980/Geomatric-Reasoning-Benchmark-Dataset/main/Dataset/route_dataset_3000/images/route_puzzle_0001.png",
    );
  });
  it("tolerates a leading slash", () => {
    expect(gripImageUrl("/Dataset/x/images/y.png")).toContain("/main/Dataset/x/images/y.png");
  });
});

describe("upstreamJsonUrl", () => {
  it("uses the raw host for JSON/text docs", () => {
    expect(upstreamJsonUrl("Dataset/route_dataset_3000/annotations.jsonl")).toBe(
      "https://raw.githubusercontent.com/bilaljawaid980/Geomatric-Reasoning-Benchmark-Dataset/main/Dataset/route_dataset_3000/annotations.jsonl",
    );
  });
});

describe("upstreamBlobUrl", () => {
  it("builds a github.com blob page", () => {
    expect(upstreamBlobUrl("README.md")).toBe(
      "https://github.com/bilaljawaid980/Geomatric-Reasoning-Benchmark-Dataset/blob/main/README.md",
    );
  });
});
