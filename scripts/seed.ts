import { getStore } from "../src/lib/db";
import { logger } from "../src/lib/logger";
import { recordInputSchema } from "../src/lib/records";

const examples = [
  {
    title: "Design engineer",
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
];

const store = getStore();
try {
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
