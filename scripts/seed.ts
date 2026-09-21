import { getStore } from "../src/lib/db";
import { logger } from "../src/lib/logger";
import { organizationInputSchema } from "../src/lib/organizations";
import { recordInputSchema } from "../src/lib/records";

const examples = [
  {
    title: "Design engineer",
    priority: "high",
    department: "Product & design",
    seniority: "senior",
    employmentType: "full_time",
    salary: { min: 75000, max: 95000, currency: "GBP", period: "year" },
    requirements: [
      "Strong React and TypeScript experience",
      "A portfolio of thoughtful interfaces",
      "Comfort collaborating directly with designers",
    ],
    benefits: ["Flexible hours", "Learning budget", "Equity"],
    visaSponsorship: "available",
    source: "Company website",
    postedAt: "2026-09-16",
    nextAction: "Choose two portfolio projects and tailor the introduction.",
    followUpAt: "2026-09-24",
    contact: { name: "Alex Morgan", email: "alex@example.com", url: null },
    organization: "Forma",
    location: "London, UK",
    arrangement: "hybrid",
    compensation: "£75,000 – £95,000",
    tags: ["TypeScript", "React", "Design systems"],
    status: "saved",
    kind: "role",
    description:
      "Build thoughtful interfaces and the tools behind them. Work across design and engineering on a small product team.\n\nThe work includes prototyping interactions, maintaining a shared component library, and bringing new product ideas into production.",
    notes:
      "Strong overlap with interface work. Take a closer look at the component library before reaching out.",
  },
  {
    title: "PhD in human-computer interaction",
    priority: "high",
    department: "Computer science",
    employmentType: "fixed_term",
    academic: {
      supervisor: "Dr. Elise Holm",
      group: "Interaction research group",
      funding: "funded",
      durationMonths: 36,
      researchAreas: ["Human-AI collaboration", "Participatory design"],
    },
    requirements: [
      "Master's degree in a related field",
      "Two-page research proposal",
      "Two academic references",
    ],
    benefits: ["Conference travel support", "Teaching opportunities"],
    contact: { name: "Dr. Elise Holm", email: "elise@example.com", url: null },
    source: "Department website",
    startDate: "2027-02-01",
    nextAction: "Email the supervisor with a short proposal outline.",
    followUpAt: "2026-09-25",
    organization: "Northfield University",
    location: "Copenhagen, Denmark",
    arrangement: "onsite",
    compensation: "Fully funded · 3 years",
    tags: ["HCI", "Research", "Interaction"],
    status: "saved",
    kind: "phd",
    description:
      "Investigate how people collaborate with interactive systems. The project combines qualitative research, interface prototyping, and longitudinal evaluation.\n\nThe position sits within the interaction research group, with opportunities to collaborate across computer science and design.",
    notes: "Read the group's recent papers. Prepare a short research proposal.",
    deadline: "2026-10-15",
  },
  {
    title: "Frontend engineer",
    department: "Core product",
    seniority: "mid",
    employmentType: "full_time",
    salary: { min: 80000, max: 110000, currency: "EUR", period: "year" },
    requirements: [
      "Production React experience",
      "Accessibility and performance testing",
    ],
    benefits: ["Remote equipment budget", "30 days of leave"],
    source: "Referral",
    nextAction: "Follow up with the hiring team.",
    followUpAt: "2026-10-02",
    organization: "Parallel",
    location: "Remote, Europe",
    arrangement: "remote",
    compensation: "€80,000 – €110,000",
    tags: ["React", "TypeScript"],
    status: "applied",
    kind: "role",
    description:
      "Build a collaborative workspace for distributed teams. Focus on responsive interfaces, accessibility, and performance.",
    appliedAt: "2026-09-18",
    notes: "Submitted portfolio and CV. Follow up in two weeks.",
  },
  {
    title: "Research engineer",
    priority: "high",
    department: "Applied research",
    seniority: "mid",
    employmentType: "full_time",
    requirements: [
      "Python and experiment design",
      "Experience building research prototypes",
    ],
    nextAction: "Prepare the project walkthrough for the technical interview.",
    followUpAt: "2026-09-23",
    contact: { name: "Sam Becker", email: "sam@example.com", url: null },
    organization: "Common Ground",
    location: "Berlin, Germany",
    arrangement: "hybrid",
    tags: ["Python", "Prototyping", "ML"],
    status: "interview",
    kind: "research",
    description:
      "Turn research ideas into working prototypes. Partner with researchers to design experiments and evaluate new interaction patterns.",
    appliedAt: "2026-09-10",
    notes:
      "Prepare to discuss a recent project and tradeoffs in the implementation.",
  },
  {
    title: "Product engineer",
    organization: "Orbit",
    location: "Remote, worldwide",
    arrangement: "remote",
    compensation: "$120,000 – $155,000",
    tags: ["Full stack", "React"],
    status: "saved",
    kind: "role",
    description:
      "Own small product features from the initial conversation through deployment. Work closely with customers and a compact engineering team.",
  },
  {
    title: "PhD in computational design",
    department: "Design computing",
    employmentType: "fixed_term",
    academic: {
      supervisor: "Prof. Mara Weiss",
      group: "Creative tools lab",
      funding: "funded",
      durationMonths: 48,
      researchAreas: ["Computational design", "Creative tools"],
    },
    nextAction: "Confirm that both references have been received.",
    followUpAt: "2026-09-28",
    organization: "Westbridge Institute",
    location: "Zurich, Switzerland",
    arrangement: "onsite",
    compensation: "Funded · 4 years",
    tags: ["Design", "Computation"],
    status: "applied",
    kind: "phd",
    description:
      "Explore computational methods for creative work, with an emphasis on usable tools and reproducible research.",
    appliedAt: "2026-09-14",
    deadline: "2026-10-01",
  },
  {
    title: "Software engineer, interfaces",
    organization: "Fieldwork",
    location: "Amsterdam, Netherlands",
    arrangement: "hybrid",
    tags: ["TypeScript", "Accessibility"],
    status: "saved",
    kind: "role",
    description:
      "Help create practical tools for teams working on environmental research. Build accessible data views and robust everyday workflows.",
  },
  {
    title: "Creative technologist",
    organization: "Outline",
    location: "London, UK",
    arrangement: "hybrid",
    tags: ["WebGL", "Creative coding"],
    status: "saved",
    kind: "other",
    description:
      "Prototype digital experiences with a multidisciplinary studio. Work on interactive installations, web experiences, and experimental interfaces.",
  },
  {
    title: "Research assistant",
    employmentType: "fixed_term",
    closedReason: "expired",
    organization: "Northfield University",
    location: "Copenhagen, Denmark",
    arrangement: "onsite",
    tags: ["Research", "HCI"],
    status: "closed",
    kind: "research",
    description:
      "Support a study of collaborative interfaces through participant sessions, data analysis, and prototype development.",
    notes: "Position filled. Keep an eye on future openings.",
  },
  {
    title: "Senior frontend engineer",
    organization: "Daybreak",
    location: "Remote, Europe",
    arrangement: "remote",
    compensation: "€95,000 – €125,000",
    tags: ["React", "Performance"],
    status: "applied",
    kind: "role",
    description:
      "Improve the speed and clarity of a planning tool used by small teams. Work on the core interface, shared components, and rendering performance.",
    appliedAt: "2026-09-20",
  },
  {
    title: "PhD in interactive systems",
    academic: {
      supervisor: "Dr. Nora Lind",
      group: "Personal computing lab",
      funding: "funded",
      durationMonths: 48,
      researchAreas: ["Interactive systems", "Field studies"],
    },
    employmentType: "fixed_term",
    organization: "Alder Technical University",
    location: "Stockholm, Sweden",
    arrangement: "onsite",
    tags: ["Interaction", "Research"],
    status: "saved",
    kind: "phd",
    description:
      "Study new ways of interacting with personal computing systems through iterative design and field studies.",
    deadline: "2026-11-02",
    compensation: "Salaried · 4 years",
  },
  {
    title: "UI engineer",
    organization: "Monograph",
    location: "Paris, France",
    arrangement: "hybrid",
    tags: ["CSS", "Design systems"],
    status: "saved",
    kind: "role",
    description:
      "Build and maintain the interface foundations for a digital publishing product. Focus on typography, accessibility, and reusable components.",
  },
  {
    title: "Frontend engineer, design systems",
    organization: "Forma",
    location: "London, UK",
    arrangement: "hybrid",
    status: "saved",
    kind: "role",
    seniority: "mid",
    employmentType: "full_time",
    department: "Platform",
    tags: ["React", "Accessibility", "Design systems"],
    salary: { min: 65000, max: 85000, currency: "GBP", period: "year" },
    description:
      "Build the components, documentation, and accessibility tooling used across Forma's product teams.",
    nextAction: "Compare the platform role with the design engineer opening.",
  },
  {
    title: "Applied research engineer",
    organization: "Common Ground",
    location: "Berlin, Germany",
    arrangement: "hybrid",
    status: "offer",
    kind: "research",
    priority: "high",
    salary: { min: 85000, max: 100000, currency: "EUR", period: "year" },
    employmentType: "full_time",
    tags: ["Python", "ML", "Prototyping"],
    description:
      "Bring research prototypes into production with the applied research team.",
    appliedAt: "2026-09-01",
    nextAction: "Review the offer and clarify the research time allocation.",
    followUpAt: "2026-09-26",
  },
];

const profiles = [
  {
    name: "Forma",
    kind: "company",
    location: "London, UK",
    description: "A small product company building collaborative design tools.",
    website: "https://example.com/forma",
    careersUrl: "https://example.com/forma/careers",
  },
  {
    name: "Northfield University",
    kind: "university",
    location: "Copenhagen, Denmark",
    description:
      "Research and teaching across computer science, design, and social science.",
    website: "https://example.com/northfield",
    careersUrl: "https://example.com/northfield/positions",
  },
  {
    name: "Common Ground",
    kind: "institute",
    location: "Berlin, Germany",
    description:
      "An independent research group studying how people work with intelligent systems.",
    website: "https://example.com/common-ground",
  },
  {
    name: "Westbridge Institute",
    kind: "institute",
    location: "Zurich, Switzerland",
    description:
      "A research institute focused on computation and creative practice.",
    website: "https://example.com/westbridge",
  },
  {
    name: "Alder Technical University",
    kind: "university",
    location: "Stockholm, Sweden",
    description:
      "Engineering and interaction research with a focus on everyday computing.",
    website: "https://example.com/alder",
  },
];

const store = getStore();
try {
  for (const profile of profiles)
    store.organizations.upsert(organizationInputSchema.parse(profile));
  for (const [index, example] of examples.entries()) {
    store.upsert(
      recordInputSchema.parse({
        ...example,
        url: `https://example.com/listings/${index + 1}`,
      }),
    );
  }
  logger.info({ count: examples.length }, "Example records seeded");
} finally {
  store.close();
}
