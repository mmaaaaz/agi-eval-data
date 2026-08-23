import { a as RenderOptions, c as renderAnimation, i as RenderInput, l as renderSvg, n as ImagesInput, o as RenderSvgOptions, r as RenderAnimationOptions, s as render, t as AnimationScene } from "./render-CSv0fCuQ.mjs";
import { ContainerNode, FetchOptions, ImageNode, Node, NodeAttributes, NodeMetadata, ReactElementLike, RgbaImage, TextNode } from "@takumi-rs/helpers";
import { AnimationOutputFormat, DitheringAlgorithm, Font, FontDetails, FontLoader, ImageSource, Keyframes, KeyframesMap, KeyframesRuleList, MeasuredNode, MeasuredTextRun, OutputFormat } from "@takumi-rs/core";
//#region src/glyph-cache.d.ts
/**
 * Sets the byte budget shared by the resolved-glyph and glyph-mask caches; `0` stops
 * caching. Defaults to 8 MiB.
 *
 * The caches belong to the backend rather than to a renderer, so this budget covers
 * every render the process makes. The backend reads it when a cache is first used, so
 * call this before the first render; a later call does not resize a cache already in
 * use.
 *
 * Raise it for scripts with large glyph sets: a CJK outline runs a few kilobytes, so
 * the default holds around a thousand of them and a page of Chinese re-rasterizes
 * glyphs it evicted a moment earlier.
 */
declare function setGlyphCacheMaxBytes(bytes: number): void;
//#endregion
//#region src/index.d.ts
declare module "react" {
  interface DOMAttributes<T> {
    tw?: string;
  }
}
//#endregion
export { type AnimationOutputFormat, type AnimationScene, type ContainerNode, type DitheringAlgorithm, type FetchOptions, type Font, type FontDetails, type FontLoader, type ImageNode, type ImageSource, type ImagesInput, type Keyframes, type KeyframesMap, type KeyframesRuleList, type MeasuredNode, type MeasuredTextRun, type Node, type NodeAttributes, type NodeMetadata, type OutputFormat, type ReactElementLike, type RenderAnimationOptions, type RenderInput, type RenderOptions, type RenderSvgOptions, type RgbaImage, type TextNode, render, renderAnimation, renderSvg, setGlyphCacheMaxBytes };