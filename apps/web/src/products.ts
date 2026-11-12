export type EventType = "WEDDING" | "VOTING" | "GENERAL";

export interface EventProduct {
  type: EventType;
  path: string;
  name: string;
  eventName: string;
  dashboardTitle: string;
  description: string;
  features: string[];
}

export const eventProducts: EventProduct[] = [
  {
    type: "WEDDING",
    path: "/weddings",
    name: "Wedding Planner",
    eventName: "wedding",
    dashboardTitle: "Wedding planning",
    description: "Keep the guest list, celebration details, and every thoughtful touch together.",
    features: ["Guest list & RSVPs", "Budget, vendors & registry", "Seating, dietary notes & updates"],
  },
  {
    type: "VOTING",
    path: "/voting",
    name: "Voting & Contests",
    eventName: "contest",
    dashboardTitle: "Voting & contests",
    description: "Build a contest, present your candidates, and follow results as votes arrive.",
    features: ["Categories & candidate profiles", "Voting and leaderboards", "Vote reports & updates"],
  },
  {
    type: "GENERAL",
    path: "/general-events",
    name: "General Events",
    eventName: "general event",
    dashboardTitle: "General events",
    description: "Organize registrations, ticket tiers, event programmes, and smooth check-in.",
    features: ["Guest registration & tickets", "Sessions & schedules", "Digital passes & check-in"],
  },
];

export function getEventProduct(type: EventType): EventProduct {
  return eventProducts.find((product) => product.type === type)!;
}

export function getProductReturnPath(search: string): string {
  const requestedPath = new URLSearchParams(search).get("next");
  return eventProducts.find((product) => product.path === requestedPath)?.path ?? "/dashboard";
}
