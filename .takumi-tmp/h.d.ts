import { a as NodeMetadata, c as TextFit, i as NodeAttributes, l as TextNode, n as ImageNode, o as ReactElementLike, r as Node, s as RgbaImage, t as ContainerNode } from "./types-Bfi8SERZ.mjs";
import { _ as fetchOk, a as GoogleFontsOptions, c as fontFromUrl, d as FetchLike, f as FetchOptions, g as defaultMaxFetchBytes, h as PrepareImagesOptions, i as GoogleFontFamily, l as googleFonts, m as ImageFetchCache, n as FontSubset, o as LIST_MARKER_CHARACTERS, p as FetchedImage, r as GenericFontFamily, s as collectCodepoints, t as CodepointSource, u as subsetFonts, v as prepareImages, y as readBodyLimited } from "./fonts-BAsrZEM-.mjs";
import { CSSProperties } from "react";
//#region src/helpers.d.ts
declare function container(props: Omit<ContainerNode, "type">): ContainerNode;
declare function text(text: string, style?: CSSProperties): TextNode;
declare function text(props: Omit<TextNode, "type">): TextNode;
declare function image(props: Omit<ImageNode, "type">): ImageNode;
declare function style(style: CSSProperties): CSSProperties;
declare function percentage(percentage: number): `${number}%`;
declare function vw(vw: number): `${number}vw`;
declare function vh(vh: number): `${number}vh`;
declare function em(em: number): `${number}em`;
declare function rem(rem: number): `${number}rem`;
declare function fr(fr: number): `${number}fr`;
declare function rgba(r: number, g: number, b: number, a?: number): `rgb(${number} ${number} ${number} / ${number})`;
//#endregion
export { CodepointSource, ContainerNode, FetchLike, FetchOptions, FetchedImage, FontSubset, GenericFontFamily, GoogleFontFamily, GoogleFontsOptions, ImageFetchCache, ImageNode, LIST_MARKER_CHARACTERS, Node, NodeAttributes, NodeMetadata, PrepareImagesOptions, ReactElementLike, RgbaImage, TextFit, TextNode, collectCodepoints, container, defaultMaxFetchBytes, em, fetchOk, fontFromUrl, fr, googleFonts, image, percentage, prepareImages, readBodyLimited, rem, rgba, style, subsetFonts, text, vh, vw };