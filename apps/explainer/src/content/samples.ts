export interface SampleQuestion {
  q: string;
  a: string;
}

export interface Sample {
  /** ledger file id from data/latest.json */
  id: string;
  /** filename from the ledger */
  name: string;
  /** scene domain code from the closed D1-D11 list (taxonomy.ts) */
  domain: string;
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
 *  dataset; these examples live only on this page. Domain codes are a visual
 *  classification of these demo images. */
const gallery = (name: string) =>
  `https://agi-eval-data.pages.dev/gallery?q=${encodeURIComponent(name)}`;

export const SAMPLES: Sample[] = [
  {
    id: "1tS0yaqG-wTlcmVgOn5bDjsc6OViS5PNj",
    name: "black_clock_decor_0112.jpg",
    domain: "D8",
    sighted:
      "A round wall clock whose face is printed with an antique world map. Roman numerals mark the hours, small anchors circle the center, and the hands sit at ten past ten.",
    thumbUrl: "https://lh3.googleusercontent.com/d/1tS0yaqG-wTlcmVgOn5bDjsc6OViS5PNj=w512",
    sourceUrl: gallery("black_clock_decor_0112.jpg"),
    questions: [
      { q: "What time does the clock show?", a: "10:10, the hour hand just past the X and the minute hand on the II." },
      { q: "How many anchors are printed around the clock face?", a: "Twelve, one beneath each hour." },
      { q: "What is printed on the clock face behind the hands?", a: "An antique world map, with continent and ocean names." },
      { q: "In what style are the hour numerals?", a: "Roman numerals." },
      { q: "What small shapes circle the center of the face?", a: "Anchors; each hour sits above one." },
    ],
  },
  {
    id: "1yV7IsX1FQ7ZISiE_mUGa_YOouHFkFVWZ",
    name: "colorful_toy_train_0055.jpg",
    domain: "D6",
    sighted:
      "A large scale model of a black steam locomotive and its tender, with red-spoked wheels, displayed on a wooden base with a French information placard in front.",
    thumbUrl: "https://lh3.googleusercontent.com/d/1yV7IsX1FQ7ZISiE_mUGa_YOouHFkFVWZ=w512",
    sourceUrl: gallery("colorful_toy_train_0055.jpg"),
    questions: [
      { q: "In what language is the information placard in front of the model written?", a: "French." },
      { q: "How many large driving wheels are visible on this side of the locomotive?", a: "Three, with red spokes." },
      { q: "Where is the placard, relative to the locomotive?", a: "In front of it, between the model and the viewer." },
      { q: "What color are the spokes of the driving wheels?", a: "Red." },
      { q: "What is the model displayed on?", a: "A wooden base." },
    ],
  },
  {
    id: "1yqc-Bt8wJSqDgM2OxtD2f882ktvu-G1t",
    name: "colorful_educational_toy_0305.jpg",
    domain: "D6",
    sighted:
      "A museum display case, behind glass, of vintage mechanical calculators and educational toys, with white placards and small numbered tags beside the objects.",
    thumbUrl: "https://lh3.googleusercontent.com/d/1yqc-Bt8wJSqDgM2OxtD2f882ktvu-G1t=w512",
    sourceUrl: gallery("colorful_educational_toy_0305.jpg"),
    questions: [
      { q: "What does the label on the wooden calculating board read?", a: "\u201cBABY CALCULATOR\u201d, with ADD, SUBTRACT, MULTIPLY and DIVIDE listed beside it." },
      { q: "What brand is printed on the black pocket calculator?", a: "\u201cEXACTUS\u201d." },
      { q: "Is a modern digital computer part of the display?", a: "No. Everything in the case is mechanical or wooden." },
      { q: "Is the display behind glass?", a: "Yes; glass reflections show over the objects." },
      { q: "What kinds of objects does the display case contain?", a: "Vintage mechanical calculators and educational toys." },
    ],
  },
  {
    id: "1z6e6ZwHTyddx76RrISAsrFHpkALGsrz9",
    name: "large_passenger_bus_0050.jpg",
    domain: "D2",
    sighted:
      "A light green minibus covered in colorful graphics, parked on a dirt lot beside a blue truck, with multi-story buildings behind and an overcast sky.",
    thumbUrl: "https://lh3.googleusercontent.com/d/1z6e6ZwHTyddx76RrISAsrFHpkALGsrz9=w512",
    sourceUrl: gallery("large_passenger_bus_0050.jpg"),
    questions: [
      { q: "What brand name is on the front of the blue truck?", a: "\u201cISUZU\u201d." },
      { q: "How many large passenger windows does the green bus show on this side?", a: "Six." },
      { q: "In this photo, is the blue truck to the left or to the right of the green bus?", a: "To the right." },
      { q: "What is the green bus parked on?", a: "A dirt lot, beside the blue truck." },
      { q: "What is the sky like?", a: "Overcast." },
    ],
  },
  {
    id: "1yu8m8xeg4bRh-aR9KHW-sprulkKD08r_",
    name: "blue_mountain_bicycle_0391.jpg",
    domain: "D8",
    sighted:
      "A bare bicycle frame in glossy metallic red, with its rear suspension, resting on a wooden slatted surface indoors. The brand name is printed in large letters on the down tube.",
    thumbUrl: "https://lh3.googleusercontent.com/d/1yu8m8xeg4bRh-aR9KHW-sprulkKD08r_=w512",
    sourceUrl: gallery("blue_mountain_bicycle_0391.jpg"),
    questions: [
      { q: "What brand name is printed in large letters on the frame?", a: "\u201cGT\u201d." },
      { q: "Do the bicycle's wheels appear in the photograph?", a: "No. Only the frame and its rear suspension are shown." },
      { q: "What is the frame resting on?", a: "A wooden slatted surface, like a bench or table." },
      { q: "What color is the frame?", a: "Glossy metallic red." },
      { q: "What is attached to the frame besides the frame itself?", a: "Its rear suspension." },
    ],
  },
  {
    id: "1ypNERjZ9A6NTGE0EeoD287u2SGOvSkP3",
    name: "large_stadium_structure_1841.jpg",
    domain: "D3",
    sighted:
      "The brick and glass exterior of a sports stadium on a sunny day, its name in large letters over the main entrance, with trees framing the view and a road in the foreground.",
    thumbUrl: "https://lh3.googleusercontent.com/d/1ypNERjZ9A6NTGE0EeoD287u2SGOvSkP3=w512",
    sourceUrl: gallery("large_stadium_structure_1841.jpg"),
    questions: [
      { q: "What does the sign above the main entrance say?", a: "\u201cEAGLE STADIUM\u201d." },
      { q: "What material is the stadium's central tower built from?", a: "Brick." },
      { q: "Which city is Eagle Stadium in?", a: "The photograph does not say. Items like this are scored against world knowledge, separately from perception." },
      { q: "What is the weather like?", a: "Sunny." },
      { q: "What runs across the foreground?", a: "A road." },
    ],
  },
  {
    id: "1zE8yp_UQxpqk9RabJqxZ8eGbPbQtfFOs",
    name: "modern_school_building_1021.jpg",
    domain: "D3",
    sighted:
      "A beige multi-story school building behind a fence, its signage in Korean, with a yellow sign attached to the fence and a red-painted bus lane on the road in front.",
    thumbUrl: "https://lh3.googleusercontent.com/d/1zE8yp_UQxpqk9RabJqxZ8eGbPbQtfFOs=w512",
    sourceUrl: gallery("modern_school_building_1021.jpg"),
    questions: [
      { q: "In which script are the signs on the building written?", a: "Korean, Hangul." },
      { q: "What color is the sign attached to the fence?", a: "Yellow." },
      { q: "The signage is in Hangul. In which country is the school most likely located?", a: "South Korea." },
      { q: "What color is the bus lane on the road?", a: "Red." },
      { q: "What color is the building?", a: "Beige." },
    ],
  },
  {
    id: "1ygRKV_hQ_6mzu0TytvYO2lkv4OMjqPPy",
    name: "black_coffee_machine_0439.jpg",
    domain: "D8",
    sighted:
      "A black espresso machine brewing a single stream of coffee into a small clear glass cup, on a wooden kitchen counter, the background out of focus.",
    thumbUrl: "https://lh3.googleusercontent.com/d/1ygRKV_hQ_6mzu0TytvYO2lkv4OMjqPPy=w512",
    sourceUrl: gallery("black_coffee_machine_0439.jpg"),
    questions: [
      { q: "How many cups are visible?", a: "One." },
      { q: "Is the cup made of glass or ceramic?", a: "Glass; the coffee and drip tray show through it." },
      { q: "Where does the glass cup stand?", a: "On the machine's round drip tray." },
      { q: "What is the machine brewing into the cup?", a: "A stream of coffee." },
      { q: "Is the background in focus?", a: "No, it is out of focus." },
    ],
  },
  {
    id: "1z535AFjwX-o86EFq0npf5vdmC-pjLNzB",
    name: "multiple_monitor_setup_0118.jpg",
    domain: "D8",
    sighted:
      "A desk with two large monitors side by side showing long documents, with a keyboard, a mouse and a white mug carrying a film design.",
    thumbUrl: "https://lh3.googleusercontent.com/d/1z535AFjwX-o86EFq0npf5vdmC-pjLNzB=w512",
    sourceUrl: gallery("multiple_monitor_setup_0118.jpg"),
    questions: [
      { q: "What film does the mug reference?", a: "The Lord of the Rings; the mug reads \u201cFellowship of the Ring\u201d." },
      { q: "How many monitors are on the desk?", a: "Two, side by side." },
      { q: "Is a printer visible on the desk?", a: "No; the desk holds monitors, a keyboard, a mouse and the mug." },
      { q: "What are the monitors showing?", a: "Long documents." },
      { q: "What color is the mug?", a: "White." },
    ],
  },
  {
    id: "1zeo6vjQvhPyLGkuHyr7LDFY-MwIDY1fb",
    name: "3186_1787455721326_3341.jpg",
    domain: "D7",
    sighted:
      "A person seen from behind, in a plaid coat, carrying two bags beside a red mesh sack of produce that rests on the ground against a red wall. The face is out of frame.",
    thumbUrl: "https://lh3.googleusercontent.com/d/1zeo6vjQvhPyLGkuHyr7LDFY-MwIDY1fb=w512",
    sourceUrl: gallery("3186_1787455721326_3341.jpg"),
    questions: [
      { q: "How many bags is the person carrying?", a: "Two: a black handbag and a red plastic bag." },
      { q: "Where is the mesh sack, relative to the person, as seen from the camera?", a: "To the person's left, on the ground against the wall." },
      { q: "Is the person's face visible in the photograph?", a: "No; the photograph shows only the lower half of the person." },
      { q: "What pattern is the person's coat?", a: "Plaid." },
      { q: "What is in the red mesh sack?", a: "Produce." },
    ],
  },
  {
    id: "1nchrh-Nr_SyP_iV3k1uJNeixoXSwUPNH",
    name: "traditional_domed_mosque_1706.jpg",
    domain: "D4",
    sighted:
      "A single-domed mosque behind a metal gate, its entrance sign reading MASJID AL-QOSIM in yellow capitals on a dark fascia. The dome carries green, white and yellow mosaic and two small gold finials, and power lines cross the blue sky.",
    thumbUrl: "https://lh3.googleusercontent.com/d/1nchrh-Nr_SyP_iV3k1uJNeixoXSwUPNH=w512",
    sourceUrl: gallery("traditional_domed_mosque_1706.jpg"),
    questions: [
      { q: "What does the sign above the main entrance read?", a: "\u201cMASJID AL-QOSIM\u201d, in yellow capitals on a dark fascia." },
      { q: "How many minarets does the mosque have?", a: "None. The roofline carries one dome with two small gold finials, not minarets." },
      { q: "How many pointed arches are in the decorative screen in the foreground?", a: "Three, each filled with white openwork lattice." },
      { q: "What colors pattern the dome?", a: "Green, white and yellow, in a geometric mosaic." },
      { q: "What crosses the sky above the building?", a: "Black power lines." },
    ],
  },
  {
    id: "1tuKj_xzS-ddDV_8IdAqhLmdKtHrgnz2e",
    name: "large_hospital_building_1124.jpg",
    domain: "D5",
    sighted:
      "An indoor hospital corridor with wood-look flooring. A closed double door carries a blue sign reading Alu VIP Ward; a single door on the right carries a blue sign reading Emergency Unit over X-Ray Unit; three waiting chairs line the wall.",
    thumbUrl: "https://lh3.googleusercontent.com/d/1tuKj_xzS-ddDV_8IdAqhLmdKtHrgnz2e=w512",
    sourceUrl: gallery("large_hospital_building_1124.jpg"),
    questions: [
      { q: "What does the blue sign above the double door read?", a: "\u201cAlu VIP Ward\u201d." },
      { q: "What does the blue sign above the single door on the right read?", a: "\u201cEmergency Unit / X-Ray Unit\u201d." },
      { q: "How many waiting chairs line the wall?", a: "Three: two brown and one black." },
      { q: "Is the floor real wood?", a: "No; it is wood-look tile or laminate in staggered planks." },
      { q: "How many doorways are visible in the corridor?", a: "Three, one of them a double door." },
    ],
  },
  {
    id: "1wfaJCDu57jcxTrP9N2NbNNkEKRBrCmv5",
    name: "industrial_factory_building_1720.jpg",
    domain: "D11",
    sighted:
      "A circular access hatch on a polished stainless-steel tank, indoors. The hatch is secured by a clamp with a hinge on the left and a threaded tightening handle on the right; behind, out of focus, more tanks and a blue barrel with a green lid.",
    thumbUrl: "https://lh3.googleusercontent.com/d/1wfaJCDu57jcxTrP9N2NbNNkEKRBrCmv5=w512",
    sourceUrl: gallery("industrial_factory_building_1720.jpg"),
    questions: [
      { q: "What is the main object in focus?", a: "A circular access hatch on a polished stainless-steel tank." },
      { q: "On which side of the hatch is the hinge?", a: "The left; the threaded tightening handle is on the right." },
      { q: "What sits in the background at lower right?", a: "A blue barrel with a green lid." },
      { q: "Is any text visible on the tank or hatch?", a: "No; none is visible." },
      { q: "What kind of lighting is this?", a: "Indoor artificial light from an overhead fixture, with strong highlights on the steel." },
    ],
  },
  {
    id: "1yj1ld7HB8iaGexvyDGVMIIJhXLdlfi4C",
    name: "colorful_board_game_0405.jpg",
    domain: "D8",
    sighted:
      "A white cabinet with five shelf levels packed with board game boxes: DIXIT, CATAN, MYSTERIUM, TAKENOKO, EVERDELL and more. A white bag with a green kiwi graphic sits on top, and a single white die rests on the third shelf.",
    thumbUrl: "https://lh3.googleusercontent.com/d/1yj1ld7HB8iaGexvyDGVMIIJhXLdlfi4C=w512",
    sourceUrl: gallery("colorful_board_game_0405.jpg"),
    questions: [
      { q: "What web address appears on the bag on top of the cabinet?", a: "\u201ccarrefour.fr\u201d." },
      { q: "How many dice are visible?", a: "One, white with black pips, on the third shelf." },
      { q: "How many shelf levels are visible?", a: "Five." },
      { q: "Which game with a black box sits on the second shelf?", a: "DIXIT." },
      { q: "What does the bag's graphic show?", a: "A green kiwi." },
    ],
  },
  {
    id: "1zBFV0cF-RLqvUvf_Z2h6MFBLQO7Uq8rk",
    name: "black_planter_decor_0111.jpg",
    domain: "D8",
    sighted:
      "A single cylindrical planter with a dense white crosshatch pattern on charcoal, photographed against a plain white background with ruler-style dimension labels: 7.87 inches beside it and 8.85 inches beneath. The pot is empty.",
    thumbUrl: "https://lh3.googleusercontent.com/d/1zBFV0cF-RLqvUvf_Z2h6MFBLQO7Uq8rk=w512",
    sourceUrl: gallery("black_planter_decor_0111.jpg"),
    questions: [
      { q: "Does the pot contain a plant?", a: "No; the pot is empty." },
      { q: "What does the vertical dimension label read?", a: "7.87 inches." },
      { q: "What does the label beneath the pot read?", a: "8.85 inches." },
      { q: "What pattern covers the pot?", a: "A dense white crosshatch grid on charcoal." },
      { q: "What does the pot rest on?", a: "A plain white studio surface; no saucer or stand is visible." },
    ],
  },
];
