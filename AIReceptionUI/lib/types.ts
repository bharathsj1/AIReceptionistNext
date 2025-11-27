export type PlanKey = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface DemoRequest {
  name: string;
  email: string;
  team_size: string;
  goals: string;
}

export interface TrialRequest {
  email: string;
}

export interface ScrapeResponse {
  pages?: number;
}
