import { CATEGORIES } from "./categories";
import { FAMILIES } from "./families";

export interface SampleQuestion {
  family: (typeof FAMILIES)[number]["id"];
  q: string;
  a: string;
}

export interface Sample {
  /** ledger file id from data/latest.json (row[0]) */
  id: string;
  /** filename from the ledger (row[1]) */
  name: string;
  /** category id from CATEGORIES */
  category: string;
  /** what is actually visible in the photograph, written AFTER viewing it */
  sighted: string;
  /** hot-linked thumbnail, same CDN the dataset site uses */
  thumbUrl: string;
  /** deep link into the dataset gallery */
  sourceUrl: string;
  questions: SampleQuestion[];
}

/** Every example was written AFTER viewing the photograph, and its answers were
 *  re-checked on a second full-resolution pass. Nothing here is written into the
 *  dataset; these examples live only on this page. */
const gallery = (name: string) =>
  `https://agi-eval-data.pages.dev/gallery?q=${encodeURIComponent(name)}`;

export const SAMPLES: Sample[] = [
  {
    id: "1tS0yaqG-wTlcmVgOn5bDjsc6OViS5PNj",
    name: "black_clock_decor_0112.jpg",
    category: "everyday-objects",
    sighted:
      "A round wall clock whose face is printed with an antique world map. Roman numerals mark the hours, small anchors circle the center, and the hands sit at ten past ten.",
    thumbUrl: "https://lh3.googleusercontent.com/d/1tS0yaqG-wTlcmVgOn5bDjsc6OViS5PNj=w512",
    sourceUrl: gallery("black_clock_decor_0112.jpg"),
    questions: [
      { family: "scene-text", q: "What time does the clock show?", a: "10:10, the hour hand just past the X and the minute hand on the II." },
      { family: "counting", q: "How many anchors are printed around the clock face?", a: "Twelve, one beneath each hour." },
      { family: "attribute-binding", q: "What is printed on the clock face behind the hands?", a: "An antique world map, with continent and ocean names." },
    ],
  },
  {
    id: "1yV7IsX1FQ7ZISiE_mUGa_YOouHFkFVWZ",
    name: "colorful_toy_train_0055.jpg",
    category: "everyday-objects",
    sighted:
      "A large scale model of a black steam locomotive and its tender, with red-spoked wheels, displayed on a wooden base with a French information placard in front.",
    thumbUrl: "https://lh3.googleusercontent.com/d/1yV7IsX1FQ7ZISiE_mUGa_YOouHFkFVWZ=w512",
    sourceUrl: gallery("colorful_toy_train_0055.jpg"),
    questions: [
      { family: "scene-text", q: "In what language is the information placard in front of the model written?", a: "French." },
      { family: "counting", q: "How many large driving wheels are visible on this side of the locomotive?", a: "Three, with red spokes." },
      { family: "spatial", q: "Where is the placard, relative to the locomotive?", a: "In front of it, between the model and the viewer." },
    ],
  },
  {
    id: "1yqc-Bt8wJSqDgM2OxtD2f882ktvu-G1t",
    name: "colorful_educational_toy_0305.jpg",
    category: "documents-signs",
    sighted:
      "A museum display case, behind glass, of vintage mechanical calculators and educational toys, with white placards and small numbered tags beside the objects.",
    thumbUrl: "https://lh3.googleusercontent.com/d/1yqc-Bt8wJSqDgM2OxtD2f882ktvu-G1t=w512",
    sourceUrl: gallery("colorful_educational_toy_0305.jpg"),
    questions: [
      { family: "scene-text", q: "What does the label on the wooden calculating board read?", a: "\u201cBABY CALCULATOR\u201d, with ADD, SUBTRACT, MULTIPLY and DIVIDE listed beside it." },
      { family: "attribute-binding", q: "What brand is printed on the black pocket calculator?", a: "\u201cEXACTUS\u201d." },
      { family: "absent-entity", q: "Is a modern digital computer part of the display?", a: "No. Everything in the case is mechanical or wooden." },
      { family: "attribute-binding", q: "Is the display behind glass?", a: "Yes; glass reflections show over the objects." },
    ],
  },
  {
    id: "1z6e6ZwHTyddx76RrISAsrFHpkALGsrz9",
    name: "large_passenger_bus_0050.jpg",
    category: "vehicles",
    sighted:
      "A light green minibus covered in colorful graphics, parked on a dirt lot beside a blue truck, with multi-story buildings behind and an overcast sky.",
    thumbUrl: "https://lh3.googleusercontent.com/d/1z6e6ZwHTyddx76RrISAsrFHpkALGsrz9=w512",
    sourceUrl: gallery("large_passenger_bus_0050.jpg"),
    questions: [
      { family: "scene-text", q: "What brand name is on the front of the blue truck?", a: "\u201cISUZU\u201d." },
      { family: "counting", q: "How many large passenger windows does the green bus show on this side?", a: "Six." },
      { family: "spatial", q: "In this photo, is the blue truck to the left or to the right of the green bus?", a: "To the right." },
    ],
  },
  {
    id: "1yu8m8xeg4bRh-aR9KHW-sprulkKD08r_",
    name: "blue_mountain_bicycle_0391.jpg",
    category: "vehicles",
    sighted:
      "A bare bicycle frame in glossy metallic red, with its rear suspension, resting on a wooden slatted surface indoors. The brand name is printed in large letters on the down tube.",
    thumbUrl: "https://lh3.googleusercontent.com/d/1yu8m8xeg4bRh-aR9KHW-sprulkKD08r_=w512",
    sourceUrl: gallery("blue_mountain_bicycle_0391.jpg"),
    questions: [
      { family: "scene-text", q: "What brand name is printed in large letters on the frame?", a: "\u201cGT\u201d." },
      { family: "absent-entity", q: "Do the bicycle's wheels appear in the photograph?", a: "No. Only the frame and its rear suspension are shown." },
      { family: "attribute-binding", q: "What is the frame resting on?", a: "A wooden slatted surface, like a bench or table." },
    ],
  },
  {
    id: "1ypNERjZ9A6NTGE0EeoD287u2SGOvSkP3",
    name: "large_stadium_structure_1841.jpg",
    category: "sports",
    sighted:
      "The brick and glass exterior of a sports stadium on a sunny day, its name in large letters over the main entrance, with trees framing the view and a road in the foreground.",
    thumbUrl: "https://lh3.googleusercontent.com/d/1ypNERjZ9A6NTGE0EeoD287u2SGOvSkP3=w512",
    sourceUrl: gallery("large_stadium_structure_1841.jpg"),
    questions: [
      { family: "scene-text", q: "What does the sign above the main entrance say?", a: "\u201cEAGLE STADIUM\u201d." },
      { family: "attribute-binding", q: "What material is the stadium's central tower built from?", a: "Brick." },
      { family: "knowledge-boundary", q: "Which city is Eagle Stadium in?", a: "The photograph does not say. Items in this family are scored against world knowledge, separately from perception." },
    ],
  },
  {
    id: "1zE8yp_UQxpqk9RabJqxZ8eGbPbQtfFOs",
    name: "modern_school_building_1021.jpg",
    category: "city-architecture",
    sighted:
      "A beige multi-story school building behind a fence, its signage in Korean, with a yellow sign attached to the fence and a red-painted bus lane on the road in front.",
    thumbUrl: "https://lh3.googleusercontent.com/d/1zE8yp_UQxpqk9RabJqxZ8eGbPbQtfFOs=w512",
    sourceUrl: gallery("modern_school_building_1021.jpg"),
    questions: [
      { family: "scene-text", q: "In which script are the signs on the building written?", a: "Korean, Hangul." },
      { family: "attribute-binding", q: "What color is the sign attached to the fence?", a: "Yellow." },
      { family: "knowledge-boundary", q: "The signage is in Hangul. In which country is the school most likely located?", a: "South Korea." },
    ],
  },
  {
    id: "1ygRKV_hQ_6mzu0TytvYO2lkv4OMjqPPy",
    name: "black_coffee_machine_0439.jpg",
    category: "food",
    sighted:
      "A black espresso machine brewing a single stream of coffee into a small clear glass cup, on a wooden kitchen counter, the background out of focus.",
    thumbUrl: "https://lh3.googleusercontent.com/d/1ygRKV_hQ_6mzu0TytvYO2lkv4OMjqPPy=w512",
    sourceUrl: gallery("black_coffee_machine_0439.jpg"),
    questions: [
      { family: "counting", q: "How many cups are visible?", a: "One." },
      { family: "attribute-binding", q: "Is the cup made of glass or ceramic?", a: "Glass; the coffee and drip tray show through it." },
      { family: "spatial", q: "Where does the glass cup stand?", a: "On the machine's round drip tray." },
    ],
  },
  {
    id: "1z535AFjwX-o86EFq0npf5vdmC-pjLNzB",
    name: "multiple_monitor_setup_0118.jpg",
    category: "indoor",
    sighted:
      "A desk with two large monitors side by side showing long documents, with a keyboard, a mouse and a white mug carrying a film design.",
    thumbUrl: "https://lh3.googleusercontent.com/d/1z535AFjwX-o86EFq0npf5vdmC-pjLNzB=w512",
    sourceUrl: gallery("multiple_monitor_setup_0118.jpg"),
    questions: [
      { family: "scene-text", q: "What film does the mug reference?", a: "The Lord of the Rings; the mug reads \u201cFellowship of the Ring\u201d." },
      { family: "counting", q: "How many monitors are on the desk?", a: "Two, side by side." },
      { family: "absent-entity", q: "Is a printer visible on the desk?", a: "No; the desk holds monitors, a keyboard, a mouse and the mug." },
    ],
  },
  {
    id: "1zeo6vjQvhPyLGkuHyr7LDFY-MwIDY1fb",
    name: "3186_1787455721326_3341.jpg",
    category: "outdoors",
    sighted:
      "A person seen from behind, in a plaid coat, carrying two bags beside a red mesh sack of produce that rests on the ground against a red wall. The face is out of frame.",
    thumbUrl: "https://lh3.googleusercontent.com/d/1zeo6vjQvhPyLGkuHyr7LDFY-MwIDY1fb=w512",
    sourceUrl: gallery("3186_1787455721326_3341.jpg"),
    questions: [
      { family: "counting", q: "How many bags is the person carrying?", a: "Two: a black handbag and a red plastic bag." },
      { family: "spatial", q: "Where is the mesh sack, relative to the person, as seen from the camera?", a: "To the person's left, on the ground against the wall." },
      { family: "absent-entity", q: "Is the person's face visible in the photograph?", a: "No; the photograph shows only the lower half of the person." },
    ],
  },
];
