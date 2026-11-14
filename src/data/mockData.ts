export type SubmissionType = 'file' | 'photo' | 'scan';

export type Assignment = {
  recipientIds?: string[];
  gradeLabel?: string | null;
  resources?: {id: string; name: string; mimeType: string}[];
  dueAt?: string;
  allowLate?: boolean;
  allowResubmission?: boolean;
  submissionStatus?: string;
  submittedAt?: string;
  id: string;
  title: string;
  subject: string;
  teacher: string;
  due: string;
  completed: boolean;
  tone: 'math' | 'history' | 'science';
  classId: string;
  description: string;
  dueDate: string;
  submissionTypes: SubmissionType[];
  grade: number | null;
  feedback: string | null;
};

export const assignments: Assignment[] = [
  { id: 'algebra-1', title: 'Quadratic equations practice', subject: 'Mathematics', teacher: 'Ms. Rivera', due: 'Due tomorrow, 11:59 PM', dueDate: '2026-11-14', completed: false, tone: 'math', classId: 'class-1', description: 'Practice solving quadratic equations using factoring and the quadratic formula.', submissionTypes: ['file', 'photo'], grade: null, feedback: null },
  { id: 'history-1', title: 'Industrial Revolution essay', subject: 'World History', teacher: 'Mr. Adams', due: 'Due Nov 17, 2026', dueDate: '2026-11-17', completed: false, tone: 'history', classId: 'class-2', description: 'Explain how the Industrial Revolution changed daily life.', submissionTypes: ['file'], grade: null, feedback: null },
  { id: 'biology-1', title: 'Cell observation lab report', subject: 'Biology', teacher: 'Dr. Chen', due: 'Due Nov 20, 2026', dueDate: '2026-11-20', completed: false, tone: 'science', classId: 'class-3', description: 'Document your observations from the cell lab.', submissionTypes: ['photo', 'scan'], grade: null, feedback: null },
  { id: 'algebra-past-1', title: 'Linear functions quiz', subject: 'Mathematics', teacher: 'Ms. Rivera', due: 'Due Nov 7, 2026', dueDate: '2026-11-07', completed: true, tone: 'math', classId: 'class-1', description: 'Quiz covering slope, intercepts, and graphing.', submissionTypes: ['file'], grade: 95, feedback: 'Strong work showing each step clearly.' },
];

export const classes = [
  ['Algebra II', 'Ms. Rivera · Room 204', '89%', 'purple'],
  ['World History', 'Mr. Adams · Room 116', '94%', 'blue'],
  ['Biology', 'Dr. Chen · Lab 2', '93%', 'green'],
  ['English Literature', 'Ms. Patel · Room 301', '96%', 'orange'],
] as const;
