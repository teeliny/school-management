/**
 * Placeholder copy for the public marketing site (Home/About/Academics/
 * Admissions/Careers & Contact) — the school's real logo, vision, mission,
 * and contact details replace everything here in one place once supplied.
 * `crestLetter` stands in for the real logo file until one exists at
 * public/logo.* and CrestBadge callers are swapped for an <Image>.
 */
export const siteContent = {
  schoolName: "Mercylag Schools",
  crestLetter: "/assets/logo.png",
  crestLetterDark: "/assets/logo-light.png",
  tagline:
    "Mercy Leading All to Glory (MERCYLAG) is an educational institution for elementary and high school students.",
  foundedYear: 1998,
  studentCount: "1,200+",
  staffCount: "140+",
  classLevels: "Reception – SS3",

  vision:
    "To be a leading centre of academic excellence and character formation, raising graduates who thrive anywhere in the world.",
  mission:
    "We provide a safe, richly resourced environment where every child is guided by qualified educators to discover their potential, master a rigorous curriculum, and grow into disciplined, compassionate leaders.",

  history:
    "Founded in 1998 by a small group of educators who believed Nigerian children deserved a school built around both rigor and warmth, [School Name] has grown from a single classroom block into a full Reception-through-Senior-Secondary campus. Replace this paragraph with the school's real founding story.",

  coreValues: [
    {
      name: "Excellence",
      description:
        "We hold every learner to a high standard and support them in reaching it.",
    },
    {
      name: "Integrity",
      description:
        "We say what we mean and do what we say, in the classroom and beyond it.",
    },
    {
      name: "Community",
      description:
        "We treat every family as a partner in the work of raising this child.",
    },
    {
      name: "Curiosity",
      description: "We reward questions as much as answers.",
    },
  ],

  leadership: {
    name: "Dr. [Proprietor Name]",
    title: "Proprietor",
    message:
      "Welcome to [School Name]. Every decision we make — from who we hire to how we build a timetable — starts with one question: is this good for the child in front of us? Replace this welcome note with the Proprietor's or Principal's own words.",
  },

  contact: {
    address: "3 Salami Olaleye Street, Isashi, Ibeshe, Ikorodu, Lagos, Nigeria",
    emails: [
      { label: "General", value: "info@mercylag.sch-portals.com" },
      { label: "Admissions", value: "admissions@mercylag.sch-portals.com" },
      { label: "Careers", value: "careers@mercylag.sch-portals.com" },
    ],
    phones: ["+234 803 551 7032", "+234 703 318 5714"],
    officeHours: "Mon–Fri, 8:00am – 4:00pm",
  },

  academicLevels: [
    {
      name: "Reception & Nursery",
      ageRange: "Ages 1 – 4",
      description:
        "Play-based early learning that builds language, motor skills, and social confidence.",
    },
    {
      name: "Primary",
      ageRange: "Ages 5 – 10",
      description:
        "A structured foundation in literacy, numeracy, and the sciences, alongside creative and physical development.",
    },
    {
      name: "Junior Secondary",
      ageRange: "Ages 11 – 13",
      description:
        "Broad subject exposure preparing students for the Basic Education Certificate Examination (BECE).",
    },
    {
      name: "Senior Secondary",
      ageRange: "Ages 14 – 17",
      description:
        "Science, Arts, and Commercial tracks preparing students for WASSCE/NECO and university admission.",
    },
  ],

  admissionsSteps: [
    {
      name: "Inquiry",
      description:
        "Submit the form below or contact our admissions office to request a prospectus.",
    },
    {
      name: "Assessment",
      description:
        "The prospective student sits a short entrance assessment appropriate to their class level.",
    },
    {
      name: "Offer",
      description:
        "Families of successful candidates receive an admission offer and fee schedule.",
    },
    {
      name: "Enrollment",
      description:
        "Complete registration, submit documentation, and resume on the assigned date.",
    },
  ],

  admissionRequirements: [
    "Completed admission inquiry or application form",
    "Birth certificate or age declaration",
    "Passport photographs",
    "Previous school's most recent report card (where applicable)",
    "Transfer/testimonial letter from previous school (for transfer students)",
  ],

  keyDates: [
    { label: "Registration opens", value: "January" },
    { label: "Entrance assessments", value: "February – March" },
    { label: "Offers released", value: "April" },
    { label: "New session resumption", value: "September" },
  ],

  openRoles: [
    { title: "Mathematics Teacher (Secondary)", type: "Full-time" },
    { title: "Class Teacher (Primary)", type: "Full-time" },
    { title: "School Nurse", type: "Part-time" },
  ],
} as const;
