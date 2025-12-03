const DEFAULT_CRAWL_KB = 'http://localhost:7071/api/crawl-kb';

export const API_ENDPOINTS = {
  crawlKb: process.env.NEXT_PUBLIC_CRAWL_API || DEFAULT_CRAWL_KB,
  demoRequest: 'http://localhost:8000/api/demo-requests',
  trial: 'http://localhost:5001/api/trial',
};

export const UI_TEXT = {
  websitePlaceholder: 'https://yourwebsite.com',
};

export const ONBOARDING_STEPS = [
  'Reading your website',
  'Training your AI receptionist',
  'Generating scripts',
  'Setting up routing',
];
