export interface EventData {
  id: string;
  slug: string;
  title: string;
  type: "WEDDING" | "VOTING" | "GENERAL";
  startDate: string;
  endDate: string;
  durationDays: number;
  totalCost: string;
  dailyRate: string;
  currency: string;
  location: string;
  description?: string | null;
  isPublished: boolean;
  _count: { guests: number; categories: number; orders: number };
}

export interface Guest {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  status: string;
  plusOnes: number;
  dietary?: string | null;
  checkedInAt?: string | null;
}

export interface Category {
  id: string;
  name: string;
  candidates: { id: string; name: string; description?: string | null; votesCount: number }[];
}

export interface WorkspaceData {
  guests: Guest[];
  categories: Category[];
  budget: { id: string; category: string; estimatedCost: string; actualCost?: string | null; paid: boolean }[];
  vendors: { id: string; name: string; service: string; phone?: string | null; email?: string | null; agreedCost?: string | null }[];
  registry: { id: string; title: string; url?: string | null; price?: string | null; claimed: boolean }[];
  sessions: { id: string; title: string; startsAt: string; endsAt: string; location?: string | null; speaker?: string | null }[];
  tiers: { id: string; name: string; price: string; quantity: number; sold: number }[];
}

export interface AnalyticsData {
  guests: number;
  checkedIn: number;
  paidOrders: number;
  ticketRevenue: string;
  voteRevenue: string;
  totalRevenue: string;
  smsSent: number;
}
