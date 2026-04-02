export interface GoldenQuery {
  query: string;
  expectedIntent: string;
  expectedDomain: string | null;
}

export const GOLDEN_QUERIES: GoldenQuery[] = [
  { query: 'show project dashboard', expectedIntent: 'dashboard', expectedDomain: 'projects' },
  { query: 'how many employees do we have', expectedIntent: 'quick_answer', expectedDomain: 'employees' },
  { query: 'highest deal in 2024', expectedIntent: 'quick_answer', expectedDomain: 'deals' },
  { query: 'compare revenue by year', expectedIntent: 'comparison', expectedDomain: 'deals' },
  { query: 'list all active projects', expectedIntent: 'list', expectedDomain: 'projects' },
  { query: 'hi good morning', expectedIntent: 'conversational', expectedDomain: null },
  { query: 'show org chart', expectedIntent: 'dashboard', expectedDomain: 'employees' },
  { query: 'what is the FFC project status', expectedIntent: 'detailed_analysis', expectedDomain: 'projects' },
  { query: 'sales pipeline overview', expectedIntent: 'dashboard', expectedDomain: 'pipeline' },
  { query: 'who reports to the CEO', expectedIntent: 'quick_answer', expectedDomain: 'employees' },
  { query: 'show me deals for Shan Foods', expectedIntent: 'detailed_analysis', expectedDomain: 'deals' },
  { query: 'employee competency matrix', expectedIntent: 'dashboard', expectedDomain: 'competency' },
  { query: 'export all deals as CSV', expectedIntent: 'export', expectedDomain: 'deals' },
  { query: 'tell me about SECMC project risks', expectedIntent: 'detailed_analysis', expectedDomain: 'projects' },
  { query: 'what can you do', expectedIntent: 'conversational', expectedDomain: null },
  { query: 'project risk dashboard', expectedIntent: 'dashboard', expectedDomain: 'projects' },
  { query: 'top 5 accounts by revenue', expectedIntent: 'quick_answer', expectedDomain: 'deals' },
  { query: 'how is the pipeline looking', expectedIntent: 'detailed_analysis', expectedDomain: 'pipeline' },
  { query: 'thanks that was helpful', expectedIntent: 'conversational', expectedDomain: null },
  { query: 'suggest a sales target for next quarter', expectedIntent: 'detailed_analysis', expectedDomain: 'deals' },
];
