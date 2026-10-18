export interface Family {
  id: string;
  name: string;
  tests: string;
  example: string;
}

export const FAMILIES: Family[] = [
  {
    id: "counting",
    name: "counting",
    tests: "exact count of objects, often under clutter",
    example: "How many people are sitting at the table?",
  },
  {
    id: "scene-text",
    name: "scene text",
    tests: "reading a sign, plate, receipt or label",
    example: "What does the red sign above the door say?",
  },
  {
    id: "spatial",
    name: "spatial",
    tests: "relative position of two things in the same photo",
    example: "Which cup is closer to the window?",
  },
  {
    id: "attribute-binding",
    name: "attribute binding",
    tests: "which object carries the property",
    example: "Which of the two dogs is wearing the red collar?",
  },
  {
    id: "absent-entity",
    name: "absent entity",
    tests: "asks about something not in the photo",
    example: "Is there a bicycle leaning against the wall?",
  },
  {
    id: "knowledge-boundary",
    name: "knowledge boundary",
    tests: "needs knowledge beyond the photo; kept in its own scored group",
    example: "What year was this car model first released?",
  },
];
