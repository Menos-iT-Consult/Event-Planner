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
  plusOnesAllowed?: number;
  dietary?: string | null;
  householdId?: string | null;
  household?: { name: string } | null;
  invitationSentAt?: string | null;
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
  budget: { id: string; category: string; estimatedCost: string; actualCost?: string | null; paid: boolean; dueAt?: string | null; vendorId?: string | null }[];
  vendors: { id: string; name: string; service: string; phone?: string | null; email?: string | null; status?: "SHORTLISTED" | "CONTACTED" | "QUOTED" | "BOOKED" | "COMPLETED" | "CANCELLED"; quotedCost?: string | null; agreedCost?: string | null; paidAmount?: string | null; paymentDueAt?: string | null; notes?: string | null }[];
  registry: { id: string; title: string; category?: string | null; url?: string | null; price?: string | null; quantity?: number; claimedCount?: number; claimed: boolean }[];
  sessions: { id: string; title: string; startsAt: string; endsAt: string; location?: string | null; speaker?: string | null; weddingDayId?: string | null }[];
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
