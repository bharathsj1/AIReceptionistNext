export const businessTypeGroups = [
  {
    category: "Healthcare & Wellness",
    subTypes: [
      "Dental Clinic",
      "Medical Clinic / GP",
      "Physiotherapy / Chiropractic",
      "Mental Health / Therapy",
      "Diagnostic / Scan Centre",
      "Pharmacy",
      "Spa & Wellness Centre",
      "Veterinary Clinic",
      "Other (Custom)"
    ]
  },
  {
    category: "Hospitality & Food",
    subTypes: [
      "Hotel / Serviced Apartment",
      "Restaurant",
      "Cafe / Coffee Shop",
      "Cloud Kitchen / Takeaway",
      "Catering Service",
      "Other (Custom)"
    ]
  },
  {
    category: "Automotive",
    subTypes: [
      "Car Service Centre",
      "Auto Repair / Garage",
      "Car Dealership",
      "Bike / Two-Wheeler Service",
      "Vehicle Rental",
      "Other (Custom)"
    ]
  },
  {
    category: "Real Estate & Property",
    subTypes: [
      "Real Estate Agency",
      "Property Management",
      "Letting Agency",
      "Construction / Builder",
      "Interior Design",
      "Other (Custom)"
    ]
  },
  {
    category: "Professional Services",
    subTypes: [
      "Law Firm",
      "Accounting / CA Firm",
      "Tax Consultant",
      "Financial Advisor",
      "Business Consultant",
      "IT Services / Software Company",
      "Other (Custom)"
    ]
  },
  {
    category: "Home & Local Services",
    subTypes: [
      "Plumbing Service",
      "Electrical Service",
      "Cleaning Service",
      "Pest Control",
      "HVAC / Air Conditioning",
      "Handyman Service",
      "Other (Custom)"
    ]
  },
  {
    category: "Fitness, Coaching & Education",
    subTypes: [
      "Gym / Fitness Studio",
      "Yoga / Pilates Studio",
      "Coaching / Tuition Centre",
      "Training Institute",
      "Music / Dance School",
      "Other (Custom)"
    ]
  },
  {
    category: "Retail & E-Commerce",
    subTypes: [
      "Retail Store",
      "Electronics Store",
      "Furniture Store",
      "Fashion / Boutique",
      "Online Store",
      "Other (Custom)"
    ]
  },
  {
    category: "SMB & General",
    subTypes: [
      "Small Business",
      "Startup",
      "Call-Based Business",
      "Franchise",
      "Other (Custom)"
    ]
  },
  {
    category: "Other (Custom)",
    subTypes: ["Other (Custom)"]
  }
];

export const businessCategories = businessTypeGroups.map((group) => group.category);

export const getSubTypesForCategory = (category) => {
  if (!category) return [];
  return businessTypeGroups.find((group) => group.category === category)?.subTypes || [];
};

const previewBulletsByCategory = {
  "Healthcare & Wellness": [
    "Appointment scheduling and rescheduling",
    "Clinic FAQs and service pricing",
    "Call routing to clinicians and departments",
    "After-hours intake and follow-ups"
  ],
  "Hospitality & Food": [
    "Reservation and booking flows",
    "Menu, amenities, and policy FAQs",
    "Call routing to front desk or hosts",
    "After-hours voicemail capture"
  ],
  Automotive: [
    "Service appointment booking",
    "Pricing and warranty FAQs",
    "Call routing to parts or service teams",
    "After-hours drop-off instructions"
  ],
  "Real Estate & Property": [
    "Viewing and inspection scheduling",
    "Listing and policy FAQs",
    "Call routing to agents and offices",
    "After-hours lead capture"
  ],
  "Professional Services": [
    "Consultation scheduling",
    "Service and compliance FAQs",
    "Call routing to specialists",
    "After-hours inquiry handling"
  ],
  "Home & Local Services": [
    "Job booking and dispatch",
    "Service coverage FAQs",
    "Call routing to on-call staff",
    "After-hours emergency triage"
  ],
  "Fitness, Coaching & Education": [
    "Class and session bookings",
    "Membership and program FAQs",
    "Call routing to coaches or staff",
    "After-hours intake and reminders"
  ],
  "Retail & E-Commerce": [
    "Order and pickup coordination",
    "Product and policy FAQs",
    "Call routing to store teams",
    "After-hours customer messages"
  ],
  "SMB & General": [
    "Lead capture and qualification",
    "General FAQs and pricing",
    "Call routing to the right owner",
    "After-hours voicemail handling"
  ],
  "Other (Custom)": [
    "Custom call flows and FAQs",
    "Tailored booking or lead capture",
    "Smart routing to your team",
    "After-hours message handling"
  ]
};

export const getPreviewBullets = (category) => {
  if (!category) {
    return [
      "Appointment booking and scheduling",
      "Frequently asked questions",
      "Call routing and transfers",
      "After-hours handling"
    ];
  }

  return previewBulletsByCategory[category] || previewBulletsByCategory["Other (Custom)"];
};
