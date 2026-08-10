export const vedoraNavItems = [
  { href: "#how", label: "How it works" },
  { href: "#experiences", label: "Experiences" },
  { href: "#restaurants", label: "For Restaurants" },
  { href: "#faq", label: "FAQ" }
];

export const vedoraStats = [
  { value: "4", label: "Package levels" },
  { value: "3", label: "Surprise modes" },
  { value: "UK", label: "Selected cities" },
  { value: "Soon", label: "App launch" }
];

export const experiencePackages = [
  {
    name: "Bronze",
    price: "£20",
    suffix: "per person",
    summary: "Simple 2-course value experience",
    details: ["2-course experience", "Clear included price", "Designed for casual discovery"],
    tone: "bronze"
  },
  {
    name: "Silver",
    price: "£30",
    suffix: "per person",
    summary: "2 courses plus selected drink",
    details: ["2 courses", "Selected drink included", "Great for relaxed plans"],
    tone: "silver"
  },
  {
    name: "Gold",
    price: "£50",
    suffix: "per person",
    summary: "Premium 3-course experience plus selected drink",
    details: ["Premium 3-course experience", "Selected drink included", "Popular for date nights"],
    tone: "gold",
    featured: true
  },
  {
    name: "Platinum",
    price: "£75+",
    suffix: "per person",
    summary: "Luxury dining experience with a premium inclusion",
    details: ["Luxury dining experience", "Premium inclusion or perk", "Built for special occasions"],
    tone: "platinum"
  }
];

export const howItWorksSteps = [
  {
    title: "Set the mood",
    body: "Choose the occasion, mood, guests, location, dietary needs and how much mystery you want.",
    tags: ["Occasion", "Mood", "Dietary fit"]
  },
  {
    title: "Choose your budget",
    body: "Pick Bronze, Silver, Gold or Platinum. You know the package price before the night begins.",
    tags: ["Fixed price", "No bill shock"]
  },
  {
    title: "Vedora finds the fit",
    body: "The app checks participating restaurants against budget, availability, style, location and requirements.",
    tags: ["Curated match", "Availability"]
  },
  {
    title: "Restaurant confirms",
    body: "The restaurant sees the request and agrees the experience before the booking is locked in.",
    tags: ["Confirmed", "Controlled"]
  },
  {
    title: "Enjoy the reveal",
    body: "Receive clues, reveal timing and the restaurant details later depending on your surprise level.",
    tags: ["Clues", "Reveal"]
  }
];

export const surpriseLevels = [
  {
    name: "Gentle Hint",
    description: "You may know the cuisine, area and general atmosphere, while the restaurant stays hidden.",
    reveal: ["Cuisine", "Area", "Atmosphere"]
  },
  {
    name: "Mystery Venue",
    description: "You get the area, booking time, dress suggestion and experience style. The venue arrives later.",
    reveal: ["Area", "Time", "Dress suggestion"]
  },
  {
    name: "Full Surprise",
    description: "You see the booking time, clues and basic travel guidance. The restaurant and menu reveal later.",
    reveal: ["Clues", "Travel guidance", "Late reveal"]
  }
];

export const benefitCards = [
  {
    title: "Dinner without the endless search",
    body: "No scrolling through hundreds of menus. Tell Vedora how you want the evening to feel."
  },
  {
    title: "Know the price",
    body: "Your selected package has a fixed included price. Optional extras at the restaurant are separate."
  },
  {
    title: "Keep dietary needs serious",
    body: "Dietary requirements and allergies are used when matching your experience and are never treated as part of the surprise."
  },
  {
    title: "Discover premium moments",
    body: "Selected off-peak availability can bring higher-tier experiences into a different budget."
  },
  {
    title: "Less decision fatigue",
    body: "Date night, birthdays and just-because evenings become easier to plan without making them predictable."
  },
  {
    title: "Curated, not random",
    body: "Vedora matches around your budget, mood, location, occasion, party size and experience level."
  }
];

export const useCases = [
  "Date Night",
  "Anniversary",
  "Birthday",
  "Dinner with Friends",
  "Celebration",
  "First Date",
  "Just Because",
  "Surprise Evening"
];

export const restaurantControls = [
  "Packages they support",
  "Dishes and inclusions",
  "Days and times",
  "Guest limits",
  "Off-peak availability",
  "Minimum acceptable payout",
  "Dietary capabilities",
  "Premium promotions"
];

export const restaurantExamples = [
  { name: "Restaurant A", tiers: ["Bronze", "Silver"], disabled: ["Gold", "Platinum"] },
  { name: "Premium Restaurant B", tiers: ["Gold", "Platinum"], disabled: ["Bronze", "Silver"] },
  { name: "Luxury Restaurant C", tiers: ["Gold", "Platinum", "Off-peak Platinum"], disabled: [] }
];

export const appScreens = [
  {
    title: "What should tonight feel like?",
    eyebrow: "Mood",
    items: ["Romantic", "Relaxed", "Playful", "Celebratory", "Adventurous", "Cosy"]
  },
  {
    title: "How much would you like to know?",
    eyebrow: "Surprise",
    items: ["Gentle Hint", "Mystery Venue", "Full Surprise"]
  },
  {
    title: "Your mystery dinner is confirmed",
    eyebrow: "Reveal",
    items: ["Saturday", "7:30 PM", "London", "Gold Experience", "£50 pp", "First clue at 5:30 PM"]
  }
];

export const faqItems = [
  {
    q: "What is Vedora?",
    a: "Vedora is a surprise dining platform. You choose your budget, mood, location, occasion and requirements, then Vedora matches you with a participating restaurant."
  },
  {
    q: "How do I know how much I'll spend?",
    a: "You see the fixed Vedora package price before booking. The price shown covers the inclusions in your selected package."
  },
  {
    q: "What is included in a package?",
    a: "Each package has agreed inclusions set with the restaurant, such as courses, selected drinks or premium perks. Exact availability varies by restaurant, date and time."
  },
  {
    q: "Can I choose the restaurant?",
    a: "Vedora is built around discovery, so the restaurant can remain a surprise. You control the mood, budget, area and reveal level."
  },
  {
    q: "What if I have allergies?",
    a: "Allergies and dietary requirements are used during matching and confirmation. They are never treated as part of the surprise."
  },
  {
    q: "Can I choose a cuisine?",
    a: "You can share cuisine preferences or exclusions. Depending on your surprise level, Vedora may keep the final restaurant hidden until later."
  },
  {
    q: "When will I know the restaurant?",
    a: "That depends on your chosen surprise level. You may receive clues first, with full restaurant details revealed closer to the booking."
  },
  {
    q: "Are drinks included?",
    a: "Some packages include a selected drink, such as Silver and Gold examples. Extra food or drinks ordered at the restaurant are paid separately."
  },
  {
    q: "What happens if I order extra food or drinks?",
    a: "Anything outside the agreed Vedora package is optional and paid separately at the restaurant."
  },
  {
    q: "Where is Vedora launching?",
    a: "Vedora is launching soon in selected UK cities. Join the waitlist to hear when it becomes available near you."
  },
  {
    q: "How do restaurants join?",
    a: "Restaurants can register interest on this page. Vedora will review the details and follow up about package fit, availability and onboarding."
  },
  {
    q: "Do restaurants have to discount their normal menu?",
    a: "No. Restaurants choose the packages, inclusions, availability and commercially viable payout. They are not required to discount their full menu."
  }
];
